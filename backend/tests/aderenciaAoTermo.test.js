const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const { apagarChamados } = require('./apoio/limpeza');
const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);

/**
 * Três pontos em que o sistema divergia do Termo de Abertura v1.2 e foi alinhado:
 *
 *  - RN06 e RF05: chamado atribuído só a uma EQUIPE (sem técnico). A API aceitava, mas a fila do
 *    técnico só listava chamados com técnico designado: o chamado ficava sem ninguém que o visse.
 *  - RN08: a espera por material suspende o prazo; a suspensão registra início, fim e
 *    justificativa. A justificativa era opcional.
 *  - RN05: "somente gestores poderão [...] reabrir chamados fora da janela do solicitante". Depois
 *    de 48 horas ninguém reabria, nem a gestão.
 */

const MARCA = `termo${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const MOTIVO = 'Falta a vedação do registro; pedido feito ao almoxarifado.';

let gestor;
let tecnicoA; // da equipe
let tecnicoB; // da mesma equipe
let tecnicoInativo; // da mesma equipe, desativado
let tecnicoDeFora; // de outra equipe
let solicitante;
let localId;
let categoriaId;
let equipeId;
const chamados = [];
const equipes = [];

async function conta(perfil, { ativo = true } = {}) {
  const email = `${MARCA}_${perfil}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Termo ${perfil}`, email, senha: 'senha-teste-123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app)
    .post('/auth/login')
    .set('X-Real-IP', `${IP}-${Math.random()}`)
    .send({ email, senha: 'senha-teste-123' });
  const dados = { ...login.body.usuario, token: login.body.token };
  if (!ativo) await pool.query('UPDATE usuario SET ativo = FALSE WHERE id = $1', [dados.id]);
  return dados;
}

const como = (quem) => ({ Authorization: `Bearer ${quem.token}` });
const estado = (id, quem, corpo) => request(app).patch(`/chamados/${id}/estado`).set(como(quem)).send(corpo);

async function chamadoEmTriagem() {
  const aberto = await request(app)
    .post('/chamados')
    .set(como(solicitante))
    .send({ titulo: `${MARCA} chamado`, descricao: 'Lâmpada queimada no corredor.', categoria_id: categoriaId, local_id: localId });
  chamados.push(aberto.body.chamado.id);
  await estado(aberto.body.chamado.id, gestor, { estado: 'em_triagem' });
  return aberto.body.chamado.id;
}

/** Atribuído só à equipe: sem técnico. */
async function chamadoDaEquipe() {
  const id = await chamadoEmTriagem();
  const resp = await request(app).patch(`/chamados/${id}/atribuir`).set(como(gestor)).send({ equipe_id: equipeId });
  expect(resp.status).toBe(200);
  return id;
}

async function chamadoEmAndamento(tecnico = tecnicoA) {
  const id = await chamadoEmTriagem();
  await request(app).patch(`/chamados/${id}/atribuir`).set(como(gestor)).send({ tecnico_id: tecnico.id });
  const inicio = await estado(id, tecnico, { estado: 'em_andamento' });
  expect(inicio.status).toBe(200);
  return id;
}

async function linha(id) {
  return (await pool.query('SELECT * FROM chamado WHERE id = $1', [id])).rows[0];
}

const fila = async (quem) =>
  (await request(app).get('/chamados').set(como(quem)).query({ limite: 100 })).body.chamados.map((c) => c.id);

beforeAll(async () => {
  gestor = await conta('gestor');
  tecnicoA = await conta('tecnico');
  tecnicoB = await conta('tecnico');
  tecnicoInativo = await conta('tecnico', { ativo: false });
  tecnicoDeFora = await conta('tecnico');
  solicitante = await conta('solicitante');
  localId = await garantirLocal({ unidade: `Unidade ${MARCA}` });
  categoriaId = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;

  const criar = async (tecnicos) => {
    const { rows } = await pool.query('INSERT INTO equipe (nome, ativo) VALUES ($1, TRUE) RETURNING id', [`${MARCA} equipe ${equipes.length}`]);
    equipes.push(rows[0].id);
    for (const t of tecnicos) {
      await pool.query('INSERT INTO equipe_tecnico (equipe_id, usuario_id) VALUES ($1, $2)', [rows[0].id, t.id]);
    }
    return rows[0].id;
  };
  equipeId = await criar([tecnicoA, tecnicoB, tecnicoInativo]);
  await criar([tecnicoDeFora]);
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    await apagarChamados(client, chamados);
    await client.query('DELETE FROM equipe_tecnico WHERE equipe_id = ANY($1::int[])', [equipes]);
    await client.query('DELETE FROM equipe WHERE id = ANY($1::int[])', [equipes]);
  } finally {
    client.release();
  }
  await pool.end();
});

describe('RN06 e RF05: chamado atribuído só à equipe', () => {
  it('avisa os técnicos ativos da equipe, e só eles', async () => {
    const id = await chamadoDaEquipe();

    const { rows } = await pool.query('SELECT usuario_id, mensagem FROM notificacao WHERE chamado_id = $1 AND tipo = \'atribuicao\'', [id]);
    const avisados = rows.map((r) => r.usuario_id).sort();

    expect(avisados).toEqual([tecnicoA.id, tecnicoB.id].sort());
    expect(rows[0].mensagem).toMatch(/sua equipe/);
  });

  it('o chamado aparece na fila de quem é da equipe e não na de quem é de fora', async () => {
    const id = await chamadoDaEquipe();

    expect(await fila(tecnicoA)).toContain(id);
    expect(await fila(tecnicoB)).toContain(id);
    expect(await fila(tecnicoDeFora)).not.toContain(id);
  });

  it('quem é da equipe abre o chamado e a tela fica sabendo que pode assumi-lo; quem é de fora recebe 403', async () => {
    const id = await chamadoDaEquipe();

    const dentro = await request(app).get(`/chamados/${id}`).set(como(tecnicoA));
    expect(dentro.status).toBe(200);
    expect(dentro.body.chamado.pode_assumir).toBe(true);

    const fora = await request(app).get(`/chamados/${id}`).set(como(tecnicoDeFora));
    expect(fora.status).toBe(403);
  });

  it('iniciar o atendimento assume o chamado: o técnico fica designado e o histórico diz', async () => {
    const id = await chamadoDaEquipe();

    const resp = await estado(id, tecnicoA, { estado: 'em_andamento' });

    expect(resp.status).toBe(200);
    expect(await linha(id)).toMatchObject({ estado: 'em_andamento', tecnico_id: tecnicoA.id, equipe_id: equipeId });
    const historico = (await request(app).get(`/chamados/${id}`).set(como(tecnicoA))).body.chamado.historico;
    expect(historico.at(-1).observacao).toMatch(/assumido por técnico da equipe/);
  });

  it('depois de assumido, o chamado sai da fila do colega e a tela deixa de oferecer o botão', async () => {
    const id = await chamadoDaEquipe();
    await estado(id, tecnicoA, { estado: 'em_andamento' });

    expect(await fila(tecnicoB)).not.toContain(id);
    expect((await request(app).get(`/chamados/${id}`).set(como(tecnicoB))).status).toBe(403);
    expect((await request(app).get(`/chamados/${id}`).set(como(tecnicoA))).body.chamado.pode_assumir).toBe(false);
  });

  it('quem é da equipe só pode iniciar: esperar material, concluir ou cancelar sem assumir é recusado', async () => {
    const id = await chamadoDaEquipe();

    for (const corpo of [
      { estado: 'aguardando_material', observacao: MOTIVO },
      { estado: 'concluido', servico_realizado: 'Serviço concluído e testado.', epi_confirmado: true },
      { estado: 'cancelado', observacao: 'Não é mais necessário, cancelado por engano.' },
    ]) {
      const resp = await estado(id, tecnicoA, corpo);
      expect(resp.status).toBe(403);
    }
    expect(await linha(id)).toMatchObject({ estado: 'atribuido', tecnico_id: null });
  });

  it('dois técnicos iniciando ao mesmo tempo: um assume, o outro é recusado', async () => {
    const id = await chamadoDaEquipe();

    const [a, b] = await Promise.all([
      estado(id, tecnicoA, { estado: 'em_andamento' }),
      estado(id, tecnicoB, { estado: 'em_andamento' }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 403]);
    const dono = (await linha(id)).tecnico_id;
    expect([tecnicoA.id, tecnicoB.id]).toContain(dono);
  });

  it('chamado designado a um técnico da equipe continua sendo só dele', async () => {
    const id = await chamadoEmTriagem();
    await request(app).patch(`/chamados/${id}/atribuir`).set(como(gestor)).send({ tecnico_id: tecnicoA.id, equipe_id: equipeId });

    expect(await fila(tecnicoA)).toContain(id);
    expect(await fila(tecnicoB)).not.toContain(id);
    expect((await estado(id, tecnicoB, { estado: 'em_andamento' })).status).toBe(403);
  });

  it('a gestão continua vendo e movendo o chamado da equipe', async () => {
    const id = await chamadoDaEquipe();

    expect(await fila(gestor)).toContain(id);
    expect((await estado(id, gestor, { estado: 'em_andamento' })).status).toBe(200);
  });
});

describe('RN08: a espera por material exige o motivo', () => {
  it('sem motivo, recusa e o prazo não é suspenso', async () => {
    const id = await chamadoEmAndamento();

    const resp = await estado(id, tecnicoA, { estado: 'aguardando_material' });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('JUSTIFICATIVA_OBRIGATORIA');
    expect(await linha(id)).toMatchObject({ estado: 'em_andamento', aguardando_material_desde: null });
  });

  it('motivo curto demais também é recusado', async () => {
    const id = await chamadoEmAndamento();

    const resp = await estado(id, tecnicoA, { estado: 'aguardando_material', observacao: 'sem peça' });

    expect(resp.status).toBe(422);
    expect((await linha(id)).estado).toBe('em_andamento');
  });

  it('com o motivo, suspende o prazo e o histórico guarda o motivo', async () => {
    const id = await chamadoEmAndamento();

    const resp = await estado(id, tecnicoA, { estado: 'aguardando_material', observacao: MOTIVO });

    expect(resp.status).toBe(200);
    expect((await linha(id)).aguardando_material_desde).not.toBeNull();
    const historico = (await request(app).get(`/chamados/${id}`).set(como(tecnicoA))).body.chamado.historico;
    expect(historico.at(-1)).toMatchObject({ estado_novo: 'aguardando_material', observacao: MOTIVO });
  });

  it('retomar o atendimento não exige motivo: o fim da suspensão fica no histórico', async () => {
    const id = await chamadoEmAndamento();
    await estado(id, tecnicoA, { estado: 'aguardando_material', observacao: MOTIVO });

    const resp = await estado(id, tecnicoA, { estado: 'em_andamento' });

    expect(resp.status).toBe(200);
    expect((await linha(id)).aguardando_material_desde).toBeNull();
  });
});

describe('RN05: a gestão reabre também fora da janela de 48 horas', () => {
  async function concluidoHaHoras(horas) {
    const id = await chamadoEmAndamento();
    const concluir = await estado(id, tecnicoA, { estado: 'concluido', servico_realizado: 'Troca do vedante e teste.', epi_confirmado: true });
    expect(concluir.status).toBe(200);
    // Recua abertura e conclusão juntas, para não criar um chamado concluído antes de existir.
    await pool.query(
      `UPDATE chamado
          SET data_abertura = now() - make_interval(hours => $2 + 1),
              inicio_execucao = now() - make_interval(hours => $2) - interval '30 minutes',
              data_conclusao = now() - make_interval(hours => $2),
              epi_confirmado_em = now() - make_interval(hours => $2)
        WHERE id = $1`,
      [id, horas]
    );
    return id;
  }
  const reabrir = (id, quem, justificativa = 'O defeito voltou depois da entrega do serviço.') =>
    request(app).post(`/chamados/${id}/reabertura`).set(como(quem)).send({ justificativa });

  it('depois de 48 horas a gestão reabre, e o histórico diz que foi fora da janela', async () => {
    const id = await concluidoHaHoras(60);

    const resp = await reabrir(id, gestor);

    expect(resp.status).toBe(200);
    expect((await linha(id)).estado).toBe('em_triagem');
    const historico = (await request(app).get(`/chamados/${id}`).set(como(gestor))).body.chamado.historico;
    expect(historico.at(-1).observacao).toMatch(/fora da janela de 48 horas, por decisão da gestão/);
  });

  it('o solicitante continua sem poder, e a mensagem manda procurar a gestão', async () => {
    const id = await concluidoHaHoras(60);

    const resp = await reabrir(id, solicitante);

    expect(resp.status).toBe(409);
    expect(resp.body.erro.codigo).toBe('JANELA_EXPIRADA');
    expect(resp.body.erro.mensagem).toMatch(/gestão/);
    expect(resp.body.erro.mensagem).toMatch(/SMP-/);
    expect((await linha(id)).estado).toBe('concluido');
  });

  it('fora da janela a gestão também precisa de justificativa', async () => {
    const id = await concluidoHaHoras(60);

    const resp = await reabrir(id, gestor, 'curta');

    expect(resp.status).toBe(422);
    expect((await linha(id)).estado).toBe('concluido');
  });

  it('dentro da janela nada muda: o histórico não fala em exceção', async () => {
    const id = await concluidoHaHoras(2);

    const resp = await reabrir(id, gestor);

    expect(resp.status).toBe(200);
    const historico = (await request(app).get(`/chamados/${id}`).set(como(gestor))).body.chamado.historico;
    expect(historico.at(-1).observacao).not.toMatch(/fora da janela/);
  });
});

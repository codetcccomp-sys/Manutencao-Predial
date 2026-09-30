const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');

const { ipDaSuite } = require('./apoio/ip');

// Ver tests/apoio/ip.js: cada suíte se apresenta ao login como um cliente
// distinto, para não dividir a cota por IP com as suítes que rodam em paralelo.
const IP = ipDaSuite(__filename);

let gestor;
let tecnico;
let outroTecnico;
let solicitante;
let estranho;
let localId;
let categoriaId;

const SERVICO = 'Servico executado e registrado conforme o combinado.';

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_rea_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Rea ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

const auth = (quem) => ({ Authorization: `Bearer ${quem.token}` });

async function abrir() {
  const resp = await request(app)
    .post('/chamados')
    .set(auth(solicitante))
    .send({
      titulo: 'Chamado para reabrir',
      descricao: 'Descrição do problema relatado',
      categoria_id: categoriaId,
      local_id: localId,
    });
  return resp.body.chamado.id;
}

async function concluir(id) {
  await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor)).send({ estado: 'em_triagem' });
  await request(app)
    .patch(`/chamados/${id}/atribuir`)
    .set(auth(gestor))
    .send({ tecnico_id: tecnico.usuario.id });
  await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor)).send({ estado: 'em_andamento' });
  await request(app)
    .patch(`/chamados/${id}/estado`)
    .set(auth(gestor))
    .send({ estado: 'concluido', servico_realizado: SERVICO });
  return id;
}

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor');
  tecnico = await criarUsuarioELogar('tecnico');
  outroTecnico = await criarUsuarioELogar('tecnico');
  solicitante = await criarUsuarioELogar('solicitante');
  estranho = await criarUsuarioELogar('solicitante');

  const categoria = await pool.query('SELECT id FROM categoria LIMIT 1');
  localId = await garantirLocal({ unidade: 'Unidade Rea' });
  categoriaId = categoria.rows[0].id;
});

afterAll(async () => {
  await pool.end();
});

describe('Reabertura (RN09)', () => {
  it('solicitante reabre o próprio chamado dentro da janela', async () => {
    const id = await concluir(await abrir());

    const resp = await request(app)
      .post(`/chamados/${id}/reabertura`)
      .set(auth(solicitante))
      .send({ justificativa: 'O ar voltou a falhar no dia seguinte ao atendimento.' });

    expect(resp.status).toBe(200);
    expect(resp.body.chamado.estado).toBe('em_triagem');
    expect(resp.body.chamado.total_reaberturas).toBe(1);
    expect(resp.body.chamado.data_conclusao).toBeNull();
  });

  it('limpa a descrição do serviço e a joga no histórico', async () => {
    const id = await concluir(await abrir());
    await request(app)
      .post(`/chamados/${id}/reabertura`)
      .set(auth(solicitante))
      .send({ justificativa: 'Problema reapareceu na mesma semana do atendimento.' });

    const { rows } = await pool.query('SELECT servico_realizado FROM chamado WHERE id = $1', [id]);
    // Sem limpar, a conclusão do novo ciclo passaria pela RN07 com o texto do
    // ciclo anterior.
    expect(rows[0].servico_realizado).toBeNull();

    const detalhe = await request(app).get(`/chamados/${id}`).set(auth(solicitante));
    const entrada = detalhe.body.chamado.historico.find((h) => /reaberto/i.test(h.observacao || ''));
    expect(entrada.observacao).toContain(SERVICO);
  });

  it('dá prazo novo ao ciclo reaberto', async () => {
    const id = await concluir(await abrir());
    await pool.query("UPDATE chamado SET prazo_estimado = now() - interval '5 days' WHERE id = $1", [id]);

    const resp = await request(app)
      .post(`/chamados/${id}/reabertura`)
      .set(auth(gestor))
      .send({ justificativa: 'Serviço não resolveu o problema relatado pelo solicitante.' });

    // O prazo do ciclo anterior já foi gasto; o que sinaliza a falha é a
    // contagem de reaberturas, não um prazo vencido herdado.
    expect(new Date(resp.body.chamado.prazo_estimado).getTime()).toBeGreaterThan(Date.now());
    expect(resp.body.chamado.em_atraso).toBe(false);
  });

  it('zera o início da execução para o novo ciclo', async () => {
    const id = await concluir(await abrir());
    const antes = await pool.query('SELECT inicio_execucao FROM chamado WHERE id = $1', [id]);
    expect(antes.rows[0].inicio_execucao).not.toBeNull();

    await request(app)
      .post(`/chamados/${id}/reabertura`)
      .set(auth(gestor))
      .send({ justificativa: 'Reincidência do mesmo defeito em menos de 24 horas.' });

    const depois = await pool.query('SELECT inicio_execucao FROM chamado WHERE id = $1', [id]);
    expect(depois.rows[0].inicio_execucao).toBeNull();
  });

  it('recusa depois da janela de 48 horas', async () => {
    const id = await concluir(await abrir());
    // Recua abertura e conclusão juntas: mover só a conclusão criaria um
    // chamado concluído antes de existir, e esse estado impossível
    // contaminaria as médias dos relatórios, que agregam o banco inteiro.
    await pool.query(
      `UPDATE chamado
          SET data_abertura = now() - interval '50 hours',
              inicio_execucao = now() - interval '49 hours 30 minutes',
              data_conclusao = now() - interval '49 hours'
        WHERE id = $1`,
      [id]
    );

    const resp = await request(app)
      .post(`/chamados/${id}/reabertura`)
      .set(auth(solicitante))
      .send({ justificativa: 'Tentativa de reabertura fora do prazo previsto.' });

    expect(resp.status).toBe(409);
    expect(resp.body.erro.codigo).toBe('JANELA_EXPIRADA');
    // A mensagem tem de dizer o que fazer, não só que não deu.
    expect(resp.body.erro.mensagem).toMatch(/SMP-/);
  });

  it('exige justificativa', async () => {
    const id = await concluir(await abrir());
    for (const corpo of [{}, { justificativa: 'curta' }]) {
      const resp = await request(app).post(`/chamados/${id}/reabertura`).set(auth(solicitante)).send(corpo);
      expect(resp.status).toBe(422);
    }
  });

  it('técnico e terceiros não reabrem', async () => {
    const id = await concluir(await abrir());
    for (const quem of [tecnico, estranho]) {
      const resp = await request(app)
        .post(`/chamados/${id}/reabertura`)
        .set(auth(quem))
        .send({ justificativa: 'Tentativa de reabertura por quem não pode.' });
      expect(resp.status).toBe(403);
    }
  });

  it('não reabre chamado que não está concluído', async () => {
    const id = await abrir();
    const resp = await request(app)
      .post(`/chamados/${id}/reabertura`)
      .set(auth(solicitante))
      .send({ justificativa: 'Chamado sequer foi concluído ainda.' });

    expect(resp.status).toBe(409);
  });

  it('conta ciclos sucessivos', async () => {
    const id = await concluir(await abrir());
    await request(app)
      .post(`/chamados/${id}/reabertura`)
      .set(auth(gestor))
      .send({ justificativa: 'Primeira reincidência registrada pelo solicitante.' });

    await request(app)
      .patch(`/chamados/${id}/atribuir`)
      .set(auth(gestor))
      .send({ tecnico_id: tecnico.usuario.id });
    await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor)).send({ estado: 'em_andamento' });
    await request(app)
      .patch(`/chamados/${id}/estado`)
      .set(auth(gestor))
      .send({ estado: 'concluido', servico_realizado: 'Segunda tentativa de correcao do defeito.' });

    const resp = await request(app)
      .post(`/chamados/${id}/reabertura`)
      .set(auth(gestor))
      .send({ justificativa: 'Segunda reincidência do mesmo defeito no local.' });

    expect(resp.body.chamado.total_reaberturas).toBe(2);
  });
});

describe('Reatribuição (RF05)', () => {
  async function atribuido() {
    const id = await abrir();
    await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor)).send({ estado: 'em_triagem' });
    await request(app)
      .patch(`/chamados/${id}/atribuir`)
      .set(auth(gestor))
      .send({ tecnico_id: tecnico.usuario.id });
    return id;
  }

  it('troca o técnico mantendo o estado', async () => {
    const id = await atribuido();
    await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor)).send({ estado: 'em_andamento' });

    const resp = await request(app)
      .patch(`/chamados/${id}/atribuir`)
      .set(auth(gestor))
      .send({
        tecnico_id: outroTecnico.usuario.id,
        justificativa: 'Técnico original afastado; serviço redistribuído.',
      });

    expect(resp.status).toBe(200);
    expect(resp.body.chamado.tecnico_id).toBe(outroTecnico.usuario.id);
    // Reatribuir não joga o chamado de volta para "atribuido": o serviço
    // continua em andamento, só mudou quem o executa.
    expect(resp.body.chamado.estado).toBe('em_andamento');
  });

  it('exige justificativa na reatribuição, mas não na primeira atribuição', async () => {
    const id = await atribuido();

    const semJustificativa = await request(app)
      .patch(`/chamados/${id}/atribuir`)
      .set(auth(gestor))
      .send({ tecnico_id: outroTecnico.usuario.id });

    expect(semJustificativa.status).toBe(422);
    expect(semJustificativa.body.erro.codigo).toBe('JUSTIFICATIVA_OBRIGATORIA');
  });

  it('recusa reatribuir ao mesmo técnico', async () => {
    const id = await atribuido();
    const resp = await request(app)
      .patch(`/chamados/${id}/atribuir`)
      .set(auth(gestor))
      .send({ tecnico_id: tecnico.usuario.id, justificativa: 'Tentativa sem mudança real.' });

    expect(resp.status).toBe(409);
    expect(resp.body.erro.codigo).toBe('SEM_MUDANCA');
  });

  it('registra a reatribuição no histórico', async () => {
    const id = await atribuido();
    await request(app)
      .patch(`/chamados/${id}/atribuir`)
      .set(auth(gestor))
      .send({
        tecnico_id: outroTecnico.usuario.id,
        justificativa: 'Carga do técnico original acima do limite da semana.',
      });

    const detalhe = await request(app).get(`/chamados/${id}`).set(auth(gestor));
    const entrada = detalhe.body.chamado.historico.find((h) => /reatribuído/i.test(h.observacao || ''));
    expect(entrada.observacao).toMatch(/Carga do técnico original/);
  });
});

describe('Cancelamento como exceção administrativa (§2.4)', () => {
  it('cancela livremente a partir dos estados autorizados', async () => {
    const id = await abrir();
    const resp = await request(app)
      .patch(`/chamados/${id}/estado`)
      .set(auth(gestor))
      .send({ estado: 'cancelado' });

    expect(resp.status).toBe(200);
  });

  it('o técnico designado não cancela, nem com justificativa (RN05)', async () => {
    const id = await abrir();
    await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor)).send({ estado: 'em_triagem' });
    await request(app)
      .patch(`/chamados/${id}/atribuir`)
      .set(auth(gestor))
      .send({ tecnico_id: tecnico.usuario.id });

    // Em "atribuído" a transição existe no fluxo e não pede justificativa:
    // só a regra de perfil impede.
    const atribuido = await request(app)
      .patch(`/chamados/${id}/estado`)
      .set(auth(tecnico))
      .send({ estado: 'cancelado' });
    expect(atribuido.status).toBe(403);

    await request(app).patch(`/chamados/${id}/estado`).set(auth(tecnico)).send({ estado: 'em_andamento' });
    const emExecucao = await request(app)
      .patch(`/chamados/${id}/estado`)
      .set(auth(tecnico))
      .send({ estado: 'cancelado', observacao: 'Não consigo fazer este serviço agora.' });
    expect(emExecucao.status).toBe(403);

    const detalhe = await request(app).get(`/chamados/${id}`).set(auth(gestor));
    expect(detalhe.body.chamado.estado).toBe('em_andamento');
  });

  it('exige justificativa para cancelar serviço já em execução', async () => {
    const id = await abrir();
    await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor)).send({ estado: 'em_triagem' });
    await request(app)
      .patch(`/chamados/${id}/atribuir`)
      .set(auth(gestor))
      .send({ tecnico_id: tecnico.usuario.id });
    await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor)).send({ estado: 'em_andamento' });

    const sem = await request(app)
      .patch(`/chamados/${id}/estado`)
      .set(auth(gestor))
      .send({ estado: 'cancelado' });
    expect(sem.status).toBe(422);

    const com = await request(app)
      .patch(`/chamados/${id}/estado`)
      .set(auth(gestor))
      .send({ estado: 'cancelado', observacao: 'Obra do bloco antecipada; serviço absorvido pela reforma.' });
    expect(com.status).toBe(200);
  });
});

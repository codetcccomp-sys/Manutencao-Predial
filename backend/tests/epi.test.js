const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const { ipDaSuite } = require('./apoio/ip');
const { apagarChamados } = require('./apoio/limpeza');

/**
 * Confirmação do uso de EPI na conclusão (migração 027).
 *
 * Concluir passa a exigir que quem conclui declare que os EPIs foram usados, e
 * o sistema guarda quem declarou e quando. O sistema não tem como saber se o
 * EPI foi vestido: o que ele garante é que ninguém conclui sem ter afirmado, e
 * que a afirmação tem autor e hora.
 */

const IP = ipDaSuite(__filename);
const SERVICO = 'Substituído o disjuntor e reapertado o barramento do quadro B.';

let gestor;
let tecnico;
let solicitante;
let localId;
let categoriaId;

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_epi_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Epi ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

const auth = (quem) => ({ Authorization: `Bearer ${quem.token}` });
const estado = (id, quem, corpo) => request(app).patch(`/chamados/${id}/estado`).set(auth(quem)).send(corpo);

async function levarAteAndamento() {
  const abertura = await request(app)
    .post('/chamados')
    .set(auth(solicitante))
    .send({ titulo: 'Chamado de EPI', descricao: 'Descrição do problema relatado', categoria_id: categoriaId, local_id: localId });
  const id = abertura.body.chamado.id;

  await estado(id, gestor, { estado: 'em_triagem' });
  await request(app).patch(`/chamados/${id}/atribuir`).set(auth(gestor)).send({ tecnico_id: tecnico.usuario.id });
  await estado(id, tecnico, { estado: 'em_andamento' });
  return id;
}

const lerChamado = async (id) =>
  (await pool.query('SELECT estado, epi_confirmado_em, epi_confirmado_por FROM chamado WHERE id = $1', [id])).rows[0];

// Um chamado "concluído antes de a regra existir". As datas voltam juntas: só a
// conclusão no passado deixaria um tempo de execução negativo, e os relatórios
// das outras suítes, que fazem média sobre o banco inteiro, falhariam por
// causa deste teste. E o chamado é apagado no fim, pelo mesmo motivo.
async function tornarLegado(id) {
  await pool.query(
    `UPDATE chamado SET estado = 'concluido', servico_realizado = $2,
            data_abertura = now() - interval '10 years 2 days',
            inicio_execucao = now() - interval '10 years 1 day',
            data_conclusao = now() - interval '10 years'
      WHERE id = $1`,
    [id, SERVICO]
  );
}

async function apagar(id) {
  const client = await pool.connect();
  try {
    await apagarChamados(client, [id]);
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor');
  tecnico = await criarUsuarioELogar('tecnico');
  solicitante = await criarUsuarioELogar('solicitante');

  const categoria = await pool.query('SELECT id FROM categoria LIMIT 1');
  localId = await garantirLocal({ unidade: 'Unidade EPI' });
  categoriaId = categoria.rows[0].id;
});

afterAll(async () => {
  await pool.end();
});

describe('Conclusão pela API', () => {
  it('recusa concluir sem a confirmação, e o chamado segue em andamento', async () => {
    const id = await levarAteAndamento();
    const resp = await estado(id, tecnico, { estado: 'concluido', servico_realizado: SERVICO });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('EPI_OBRIGATORIO');

    const c = await lerChamado(id);
    expect(c.estado).toBe('em_andamento');
    expect(c.epi_confirmado_em).toBeNull();
    expect(c.epi_confirmado_por).toBeNull();
  });

  // Estritamente `true`: um cliente antigo ou um script não conclui por
  // omissão nem por um valor que "parece" verdadeiro.
  it.each([
    [false, 'EPI_OBRIGATORIO'],
    ['true', 'VALIDACAO'],
    [1, 'VALIDACAO'],
    [null, 'EPI_OBRIGATORIO'],
  ])('recusa %j como confirmação (%s)', async (valor, codigo) => {
    const id = await levarAteAndamento();
    const resp = await estado(id, tecnico, { estado: 'concluido', servico_realizado: SERVICO, epi_confirmado: valor });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe(codigo);
    expect((await lerChamado(id)).estado).toBe('em_andamento');
  });

  it('a falta da descrição do serviço continua sendo apontada primeiro', async () => {
    const id = await levarAteAndamento();
    const resp = await estado(id, tecnico, { estado: 'concluido' });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('SERVICO_OBRIGATORIO');
  });

  it('conclui com a confirmação e guarda quem confirmou e quando', async () => {
    const id = await levarAteAndamento();
    const resp = await estado(id, tecnico, { estado: 'concluido', servico_realizado: SERVICO, epi_confirmado: true });

    expect(resp.status).toBe(200);
    expect(resp.body.chamado.estado).toBe('concluido');
    expect(resp.body.chamado.epi_confirmado_em).not.toBeNull();
    expect(resp.body.chamado.epi_confirmado_por).toBe(tecnico.usuario.id);

    // A tela de detalhe lê o mesmo registro.
    const detalhe = await request(app).get(`/chamados/${id}`).set(auth(solicitante));
    expect(detalhe.body.chamado.epi_confirmado_em).toBe(resp.body.chamado.epi_confirmado_em);
  });

  it('quando a gestão conclui, o autor da confirmação é a gestão — quem marcou', async () => {
    const id = await levarAteAndamento();
    const resp = await estado(id, gestor, { estado: 'concluido', servico_realizado: SERVICO, epi_confirmado: true });

    expect(resp.status).toBe(200);
    expect(resp.body.chamado.epi_confirmado_por).toBe(gestor.usuario.id);
  });

  it('a confirmação entra na linha do tempo, depois do que a pessoa escreveu', async () => {
    const id = await levarAteAndamento();
    await estado(id, tecnico, {
      estado: 'concluido',
      servico_realizado: SERVICO,
      epi_confirmado: true,
      observacao: 'Peça trocada sem intercorrência.',
    });

    const { rows } = await pool.query(
      "SELECT observacao FROM historico_chamado WHERE chamado_id = $1 AND estado_novo = 'concluido'",
      [id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].observacao).toBe('Peça trocada sem intercorrência. Uso de EPI confirmado.');
  });

  it('não cobra EPI de quem muda para outro estado', async () => {
    const id = await levarAteAndamento();

    const espera = await estado(id, tecnico, { estado: 'aguardando_material' });
    expect(espera.status).toBe(200);

    const cancela = await estado(id, gestor, { estado: 'cancelado', observacao: 'Serviço deixou de ser necessário.' });
    expect(cancela.status).toBe(200);
    expect((await lerChamado(id)).epi_confirmado_em).toBeNull();
  });
});

describe('Reabertura', () => {
  it('zera a confirmação do chamado, mantém a do ciclo anterior na linha do tempo e cobra a do novo', async () => {
    const id = await levarAteAndamento();
    await estado(id, tecnico, { estado: 'concluido', servico_realizado: SERVICO, epi_confirmado: true });

    const reabre = await request(app)
      .post(`/chamados/${id}/reabertura`)
      .set(auth(solicitante))
      .send({ justificativa: 'O defeito voltou no mesmo dia.' });
    expect(reabre.status).toBe(200);

    const c = await lerChamado(id);
    expect(c.epi_confirmado_em).toBeNull();
    expect(c.epi_confirmado_por).toBeNull();

    const { rows } = await pool.query(
      "SELECT observacao FROM historico_chamado WHERE chamado_id = $1 AND estado_novo = 'concluido'",
      [id]
    );
    expect(rows[0].observacao).toMatch(/Uso de EPI confirmado\./);

    // No segundo ciclo a declaração é de novo: a do primeiro não vale.
    await request(app).patch(`/chamados/${id}/atribuir`).set(auth(gestor)).send({ tecnico_id: tecnico.usuario.id });
    await estado(id, tecnico, { estado: 'em_andamento' });
    const segundo = await estado(id, tecnico, { estado: 'concluido', servico_realizado: 'Segunda tentativa de correção.' });
    expect(segundo.status).toBe(422);
    expect(segundo.body.erro.codigo).toBe('EPI_OBRIGATORIO');
  });
});

describe('O banco também exige, por escrita direta', () => {
  it('recusa chamado concluído agora sem confirmação', async () => {
    const id = await levarAteAndamento();
    await expect(
      pool.query(
        "UPDATE chamado SET estado = 'concluido', servico_realizado = $2, data_conclusao = now() WHERE id = $1",
        [id, SERVICO]
      )
    ).rejects.toThrow(/chamado_conclusao_exige_epi/);
  });

  // O NULL de uma comparação não reprova um CHECK. Sem o COALESCE, concluir
  // sem data de conclusão furaria a regra.
  it('recusa chamado concluído sem data de conclusão e sem confirmação', async () => {
    const id = await levarAteAndamento();
    await expect(
      pool.query("UPDATE chamado SET estado = 'concluido', servico_realizado = $2 WHERE id = $1", [id, SERVICO])
    ).rejects.toThrow(/chamado_conclusao_exige_epi/);
  });

  it('aceita o que foi concluído antes de a regra existir (sem inventar confirmação)', async () => {
    const id = await levarAteAndamento();
    try {
      await tornarLegado(id);
      expect((await lerChamado(id)).estado).toBe('concluido');
    } finally {
      await apagar(id);
    }
  });

  it('e o legado continua alterável: a restrição não trava a linha antiga', async () => {
    const id = await levarAteAndamento();
    try {
      await tornarLegado(id);
      await expect(
        pool.query("UPDATE chamado SET diagnostico = 'ajuste tardio' WHERE id = $1", [id])
      ).resolves.toBeDefined();
    } finally {
      await apagar(id);
    }
  });

  it('a confirmação tem autor e hora, os dois ou nenhum', async () => {
    const id = await levarAteAndamento();
    await expect(pool.query('UPDATE chamado SET epi_confirmado_em = now() WHERE id = $1', [id])).rejects.toThrow(
      /chamado_epi_autor_e_hora/
    );
    await expect(
      pool.query('UPDATE chamado SET epi_confirmado_por = $2 WHERE id = $1', [id, tecnico.usuario.id])
    ).rejects.toThrow(/chamado_epi_autor_e_hora/);
  });
});

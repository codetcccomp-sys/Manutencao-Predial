const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const atrasosService = require('../src/services/atrasos.service');
const execucoes = require('../src/services/execucoes.service');
const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);
const SEGREDO = 'segredo-do-agendador-saude';
process.env.CRON_SECRET = SEGREDO;

let gestor;
let tecnico;

async function pessoa(perfil) {
  const email = `${perfil}_agenda_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Agenda ${perfil}`, email, senha: 'senha-teste-123' });
  await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha-teste-123' });
  return login.body.token;
}

const situacaoDe = (lista, tarefa) => lista.find((t) => t.tarefa === tarefa);

beforeAll(async () => {
  [gestor, tecnico] = await Promise.all([pessoa('gestor'), pessoa('tecnico')]);
});

afterAll(async () => {
  await pool.end();
});

describe('Registro das passagens do agendador', () => {
  it('cada chamada da tarefa fica registrada, com o que ela respondeu', async () => {
    const antes = await pool.query("SELECT max(id) AS id FROM execucao_tarefa WHERE tarefa = 'notificar-atrasos'");

    const resp = await request(app)
      .post('/tarefas/notificar-atrasos')
      .set('Authorization', `Bearer ${SEGREDO}`);
    expect(resp.status).toBe(200);

    const { rows } = await pool.query(
      "SELECT * FROM execucao_tarefa WHERE tarefa = 'notificar-atrasos' AND id > COALESCE($1, 0) ORDER BY id",
      [antes.rows[0].id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sucesso: true, erro: null });
    expect(rows[0].terminada_em).not.toBeNull();
    expect(rows[0].resumo).toEqual(resp.body);
  });

  it('a falha também fica registrada, e a saúde passa a dizer "falhando"', async () => {
    const falha = jest
      .spyOn(atrasosService, 'notificarAtrasados')
      .mockRejectedValueOnce(new Error('banco caiu no meio'));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const resp = await request(app)
        .post('/tarefas/notificar-atrasos')
        .set('Authorization', `Bearer ${SEGREDO}`);
      expect(resp.status).toBe(500);
    } finally {
      falha.mockRestore();
      log.mockRestore();
    }

    const situacao = situacaoDe(await execucoes.saude(), 'notificar-atrasos');
    expect(situacao.situacao).toBe('falhando');
    expect(situacao.ultimo_erro).toBe('banco caiu no meio');

    // A passagem seguinte, bem-sucedida, devolve a tarefa ao normal.
    await request(app).post('/tarefas/notificar-atrasos').set('Authorization', `Bearer ${SEGREDO}`);
    expect(situacaoDe(await execucoes.saude(), 'notificar-atrasos').situacao).toBe('ok');
  });

  it('sem passagem dentro da tolerância, a tarefa aparece como parada', async () => {
    await request(app).post('/tarefas/notificar-atrasos').set('Authorization', `Bearer ${SEGREDO}`);

    const daquiDuasHoras = new Date(Date.now() + 2 * 3_600_000);
    expect(situacaoDe(await execucoes.saude(daquiDuasHoras), 'notificar-atrasos').situacao).toBe('parada');

    // A preventiva roda uma vez por dia: duas horas sem ela é normal.
    await request(app).post('/tarefas/gerar-preventivas').set('Authorization', `Bearer ${SEGREDO}`);
    expect(situacaoDe(await execucoes.saude(daquiDuasHoras), 'gerar-preventivas').situacao).toBe('ok');
  });

  it('passagem que começou e nunca terminou (função morta no meio) conta como falha', async () => {
    await pool.query(
      "INSERT INTO execucao_tarefa (tarefa, iniciada_em) VALUES ('gerar-preventivas', now() - interval '20 minutes')"
    );
    // Garante que ela é a mais recente da tarefa.
    await pool.query(
      "UPDATE execucao_tarefa SET iniciada_em = now() - interval '30 minutes' WHERE tarefa = 'gerar-preventivas' AND terminada_em IS NOT NULL AND iniciada_em > now() - interval '20 minutes'"
    );
    expect(situacaoDe(await execucoes.saude(), 'gerar-preventivas').situacao).toBe('falhando');
    await pool.query("DELETE FROM execucao_tarefa WHERE tarefa = 'gerar-preventivas' AND terminada_em IS NULL");
  });

  it('tarefa que nunca rodou aparece como "nunca", não como saudável', async () => {
    await pool.query("DELETE FROM execucao_tarefa WHERE tarefa = 'gerar-preventivas'");
    expect(situacaoDe(await execucoes.saude(), 'gerar-preventivas').situacao).toBe('nunca');
  });
});

describe('GET /operacao/agendador', () => {
  it('a gestão vê a situação das tarefas', async () => {
    const resp = await request(app).get('/operacao/agendador').set('Authorization', `Bearer ${gestor}`);
    expect(resp.status).toBe(200);
    expect(resp.body.tarefas.map((t) => t.tarefa).sort()).toEqual(['conferir-email', 'gerar-preventivas', 'notificar-atrasos']);
  });

  it('não é do técnico, e não abre com o segredo do agendador', async () => {
    expect((await request(app).get('/operacao/agendador').set('Authorization', `Bearer ${tecnico}`)).status).toBe(403);
    expect((await request(app).get('/operacao/agendador').set('Authorization', `Bearer ${SEGREDO}`)).status).toBe(401);
  });
});

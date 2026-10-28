const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const { ipDaSuite } = require('./apoio/ip');

/**
 * Prazo em horas úteis.
 *
 * A conta é testada com datas fixas (sexta, sábado, feriado), e não com o
 * relógio de quando a suíte roda: um teste que só passa em horário comercial
 * é um teste que falha à noite no CI.
 */

const IP = ipDaSuite(__filename);
const FUSO = 'America/Sao_Paulo';
let gestor;
let tecnico;
let tecnicoId;
let local;
let categoria;
let slaOriginal;
let expedienteOriginal;
const feriadosCriados = [];

async function pessoa(perfil) {
  const email = `${perfil}_uteis_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Úteis ${perfil}`, email, senha: 'senha-teste-123' });
  await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha-teste-123' });
  return { token: login.body.token, id: login.body.usuario.id };
}

const como = (quem) => ({ Authorization: `Bearer ${quem.token}` });

async function somar(inicio, horas) {
  const { rows } = await pool.query(
    `SELECT to_char(somar_horas_uteis($1::timestamptz, make_interval(hours => $2), $3) AT TIME ZONE $3,
                    'YYYY-MM-DD HH24:MI') AS r`,
    [inicio, horas, FUSO]
  );
  return rows[0].r;
}

beforeAll(async () => {
  [gestor, tecnico] = await Promise.all([pessoa('gestor'), pessoa('tecnico')]);
  tecnicoId = tecnico.id;
  local = await garantirLocal({ unidade: 'Unidade Horas Úteis' });
  categoria = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
  slaOriginal = (await pool.query('SELECT prioridade, prazo_horas, contagem FROM sla')).rows;
  expedienteOriginal = (await pool.query('SELECT * FROM expediente')).rows;
});

afterAll(async () => {
  // A configuração é global: as suítes seguintes contam com horas corridas.
  for (const s of slaOriginal) {
    await pool.query('UPDATE sla SET prazo_horas = $1, contagem = $2 WHERE prioridade = $3', [
      s.prazo_horas,
      s.contagem,
      s.prioridade,
    ]);
  }
  await pool.query('DELETE FROM expediente');
  for (const e of expedienteOriginal) {
    await pool.query('INSERT INTO expediente VALUES ($1, $2, $3)', [e.dia_semana, e.inicio, e.fim]);
  }
  if (feriadosCriados.length) await pool.query('DELETE FROM feriado WHERE data = ANY($1::date[])', [feriadosCriados]);
  await pool.end();
});

describe('A conta das horas úteis (seg a sex, 8h às 18h)', () => {
  it.each([
    ['sexta 17h + 3h: 1h na sexta e 2h na segunda', '2026-10-09 17:00-03', 3, '2026-10-12 10:00'],
    ['sábado 10h + 1h: começa na segunda', '2026-10-10 10:00-03', 1, '2026-10-12 09:00'],
    ['antes do expediente: começa às 8h', '2026-10-07 06:30-03', 2, '2026-10-07 10:00'],
    ['dentro do expediente', '2026-10-07 09:00-03', 2, '2026-10-07 11:00'],
    ['72h desde segunda 8h: sete dias e duas horas de trabalho', '2026-10-05 08:00-03', 72, '2026-10-14 10:00'],
    ['termina exatamente no fim do expediente', '2026-10-07 18:00-03', 10, '2026-10-08 18:00'],
  ])('%s', async (_caso, inicio, horas, esperado) => {
    expect(await somar(inicio, horas)).toBe(esperado);
  });

  it('feriado não conta', async () => {
    await pool.query("INSERT INTO feriado VALUES ('2026-10-12', 'Teste: N. Sra. Aparecida') ON CONFLICT DO NOTHING");
    feriadosCriados.push('2026-10-12');
    expect(await somar('2026-10-09 17:00-03', 3)).toBe('2026-10-13 10:00');
  });

  it('horas úteis entre sexta 17h e segunda 10h são 3', async () => {
    const { rows } = await pool.query(
      "SELECT extract(epoch FROM horas_uteis_entre('2026-10-02 17:00-03', '2026-10-05 10:00-03', $1)) / 3600 AS h",
      [FUSO]
    );
    expect(Number(rows[0].h)).toBe(3);
  });
});

describe('O prazo do chamado segue a régua da prioridade', () => {
  it('com "úteis", o chamado novo vence pelo expediente, e não pelo relógio', async () => {
    await request(app).patch('/sla/media').set(como(gestor)).send({ prazo_horas: 20, contagem: 'uteis' });

    const resp = await request(app)
      .post('/chamados')
      .set(como(gestor))
      .send({ titulo: 'Tomada solta', descricao: 'Tomada solta na parede.', categoria_id: categoria, local_id: local, prioridade: 'media' });

    const { rows } = await pool.query(
      `SELECT prazo_estimado = somar_horas_uteis(data_abertura, interval '20 hours', $2) AS confere,
              prazo_estimado > data_abertura + interval '20 hours' AS passa_das_corridas
         FROM chamado WHERE id = $1`,
      [resp.body.chamado.id, FUSO]
    );
    expect(rows[0].confere).toBe(true);
    // 20h úteis são dois dias de expediente: sempre mais que 20h de relógio.
    expect(rows[0].passa_das_corridas).toBe(true);
  });

  it('com "corridas", continua como antes', async () => {
    await request(app).patch('/sla/baixa').set(como(gestor)).send({ contagem: 'corridas' });
    const resp = await request(app)
      .post('/chamados')
      .set(como(gestor))
      .send({ titulo: 'Pintura descascando', descricao: 'Parede do corredor.', categoria_id: categoria, local_id: local, prioridade: 'baixa' });
    const { rows } = await pool.query(
      'SELECT prazo_estimado = data_abertura + make_interval(hours => (SELECT prazo_horas FROM sla WHERE prioridade = $2)) AS confere FROM chamado WHERE id = $1',
      [resp.body.chamado.id, 'baixa']
    );
    expect(rows[0].confere).toBe(true);
  });

  it('a espera por material devolve ao prazo o expediente que consumiu', async () => {
    await request(app).patch('/sla/media').set(como(gestor)).send({ prazo_horas: 20, contagem: 'uteis' });
    const { body } = await request(app)
      .post('/chamados')
      .set(como(gestor))
      .send({ titulo: 'Bomba parada', descricao: 'Bomba não liga.', categoria_id: categoria, local_id: local, prioridade: 'media' });
    const id = body.chamado.id;

    await request(app).patch(`/chamados/${id}/estado`).set(como(gestor)).send({ estado: 'em_triagem' });
    await request(app).patch(`/chamados/${id}/atribuir`).set(como(gestor)).send({ tecnico_id: tecnicoId });
    await request(app).patch(`/chamados/${id}/estado`).set(como(tecnico)).send({ estado: 'em_andamento' });
    await request(app).patch(`/chamados/${id}/estado`).set(como(tecnico)).send({ estado: 'aguardando_material', observacao: 'Falta a vedação do registro; pedido feito ao almoxarifado.' });

    // A espera começou numa segunda às 9h (fixo, para a conta não depender de
    // quando a suíte roda) e termina agora.
    await pool.query(
      "UPDATE chamado SET aguardando_material_desde = '2026-09-28 09:00-03' WHERE id = $1",
      [id]
    );
    // Como texto: o Date do JavaScript corta os microssegundos do Postgres, e a
    // comparação exata abaixo falharia por um arredondamento, não pela conta.
    const antes = (await pool.query('SELECT prazo_estimado::text FROM chamado WHERE id = $1', [id])).rows[0];

    await request(app).patch(`/chamados/${id}/estado`).set(como(tecnico)).send({ estado: 'em_andamento' });

    const { rows } = await pool.query(
      `SELECT prazo_estimado = somar_horas_uteis($2::timestamptz, tempo_suspenso_util, $3) AS confere,
              tempo_suspenso_util > interval '0' AS contou
         FROM chamado WHERE id = $1`,
      [id, antes.prazo_estimado, FUSO]
    );
    expect(rows[0]).toEqual({ confere: true, contou: true });
  });

  it('a reabertura dá o prazo do ciclo novo na mesma régua, em horas úteis, e começa sem a espera do ciclo anterior', async () => {
    await request(app).patch('/sla/media').set(como(gestor)).send({ prazo_horas: 20, contagem: 'uteis' });
    const { body } = await request(app)
      .post('/chamados')
      .set(como(gestor))
      .send({ titulo: 'Bebedouro vazando', descricao: 'Vazamento no bebedouro.', categoria_id: categoria, local_id: local, prioridade: 'media' });
    const id = body.chamado.id;

    await request(app).patch(`/chamados/${id}/estado`).set(como(gestor)).send({ estado: 'em_triagem' });
    await request(app).patch(`/chamados/${id}/atribuir`).set(como(gestor)).send({ tecnico_id: tecnicoId });
    await request(app).patch(`/chamados/${id}/estado`).set(como(tecnico)).send({ estado: 'em_andamento' });
    const conclusao = await request(app)
      .patch(`/chamados/${id}/estado`)
      .set(como(tecnico))
      .send({ estado: 'concluido', servico_realizado: 'Troca do registro e teste de vazamento sem ocorrência.', epi_confirmado: true });
    expect(conclusao.status).toBe(200);

    // O ciclo anterior deixou uma espera por material contada em expediente. O
    // prazo do ciclo novo não pode herdá-la: a reabertura recomeça do zero.
    await pool.query("UPDATE chamado SET tempo_suspenso_util = interval '3 hours' WHERE id = $1", [id]);

    const reabertura = await request(app)
      .post(`/chamados/${id}/reabertura`)
      .set(como(gestor))
      .send({ justificativa: 'O vazamento voltou no mesmo dia da conclusão.' });
    expect(reabertura.status).toBe(200);

    const { rows } = await pool.query(
      `SELECT prazo_estimado = prazo_sla(prioridade, reaberto_em, interval '0', interval '0', $2) AS confere,
              prazo_estimado > reaberto_em + interval '20 hours' AS passa_das_corridas,
              tempo_suspenso_util = interval '0' AS zerada
         FROM chamado WHERE id = $1`,
      [id, FUSO]
    );
    // 20h úteis são dois dias de expediente: sempre mais que 20h de relógio.
    expect(rows[0]).toEqual({ confere: true, passa_das_corridas: true, zerada: true });
  });

  it('repriorizar recalcula desde a abertura, na régua nova, com a espera útil devolvida', async () => {
    await request(app).patch('/sla/alta').set(como(gestor)).send({ prazo_horas: 8, contagem: 'uteis' });
    const { body } = await request(app)
      .post('/chamados')
      .set(como(gestor))
      .send({ titulo: 'Quadro desarmando', descricao: 'Disjuntor geral cai.', categoria_id: categoria, local_id: local, prioridade: 'baixa' });
    const id = body.chamado.id;
    await pool.query("UPDATE chamado SET tempo_suspenso_util = interval '2 hours' WHERE id = $1", [id]);

    await request(app).patch(`/chamados/${id}/estado`).set(como(gestor)).send({ estado: 'em_triagem' });
    const resp = await request(app)
      .patch(`/chamados/${id}/priorizacao`)
      .set(como(gestor))
      .send({ urgencia: 3, impacto: 3, risco: 2, prioridade: 'alta', justificativa: 'Afeta o bloco inteiro.' });
    expect(resp.status).toBe(200);

    const { rows } = await pool.query(
      `SELECT prazo_estimado = somar_horas_uteis(data_abertura, interval '10 hours', $2) AS confere
         FROM chamado WHERE id = $1`,
      [id, FUSO]
    );
    expect(rows[0].confere).toBe(true);
  });
});

describe('Configuração do expediente e dos feriados', () => {
  it('a gestão troca a semana inteira de uma vez', async () => {
    const resp = await request(app)
      .put('/sla/expediente')
      .set(como(gestor))
      .send({
        dias: [
          { dia_semana: 1, inicio: '07:00', fim: '16:00' },
          { dia_semana: 2, inicio: '07:00', fim: '16:00' },
          { dia_semana: 6, inicio: '08:00', fim: '12:00' },
        ],
      });
    expect(resp.status).toBe(200);
    expect(resp.body.expediente).toEqual([
      { dia_semana: 1, inicio: '07:00', fim: '16:00' },
      { dia_semana: 2, inicio: '07:00', fim: '16:00' },
      { dia_semana: 6, inicio: '08:00', fim: '12:00' },
    ]);
    // Sábado agora tem expediente: sábado 10h + 1h = 11h.
    expect(await somar('2026-10-10 10:00-03', 1)).toBe('2026-10-10 11:00');
  });

  it.each([
    ['fim antes do início', [{ dia_semana: 1, inicio: '18:00', fim: '08:00' }]],
    ['hora malformada', [{ dia_semana: 1, inicio: '8h', fim: '18:00' }]],
    ['dia repetido', [{ dia_semana: 1, inicio: '08:00', fim: '12:00' }, { dia_semana: 1, inicio: '13:00', fim: '18:00' }]],
    ['dia fora da semana', [{ dia_semana: 7, inicio: '08:00', fim: '18:00' }]],
  ])('recusa expediente com %s, sem apagar o que havia', async (_caso, dias) => {
    const antes = (await request(app).get('/sla/expediente').set(como(gestor))).body.expediente;
    const resp = await request(app).put('/sla/expediente').set(como(gestor)).send({ dias });
    expect(resp.status).toBe(422);
    expect((await request(app).get('/sla/expediente').set(como(gestor))).body.expediente).toEqual(antes);
  });

  it('feriados: cadastra, lista por ano e remove', async () => {
    const criado = await request(app)
      .post('/sla/feriados')
      .set(como(gestor))
      .send({ data: '2031-11-20', descricao: 'Teste: Consciência Negra' });
    expect(criado.status).toBe(201);
    feriadosCriados.push('2031-11-20');

    const lista = await request(app).get('/sla/feriados').query({ ano: 2031 }).set(como(tecnico));
    expect(lista.body.feriados).toContainEqual({ data: '2031-11-20', descricao: 'Teste: Consciência Negra' });

    expect((await request(app).delete('/sla/feriados/2031-11-20').set(como(gestor))).status).toBe(204);
    expect((await request(app).delete('/sla/feriados/2031-11-20').set(como(gestor))).status).toBe(404);
  });

  it('o técnico lê, mas não muda a régua', async () => {
    expect((await request(app).get('/sla/expediente').set(como(tecnico))).status).toBe(200);
    expect((await request(app).put('/sla/expediente').set(como(tecnico)).send({ dias: [] })).status).toBe(403);
    expect((await request(app).patch('/sla/media').set(como(tecnico)).send({ contagem: 'uteis' })).status).toBe(403);
  });

  it('a contagem só aceita os dois valores', async () => {
    const resp = await request(app).patch('/sla/media').set(como(gestor)).send({ contagem: 'comerciais' });
    expect(resp.status).toBe(422);
  });
});

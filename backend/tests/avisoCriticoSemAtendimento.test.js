const request = require('supertest');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const email = require('../src/services/email.service');
const criticos = require('../src/services/criticos.service');
const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);

const SEGREDO = 'segredo-de-teste-do-agendador';
process.env.CRON_SECRET = SEGREDO;
const app = require('../src/app');

/**
 * O aviso de "crítico sem atendimento" fora da tela (achado 3, RF08).
 *
 * A condição existia só como cálculo da consulta, desenhado numa faixa do aplicativo: um crítico
 * aberto às 22h só era visto quando alguém abrisse o aplicativo. A passagem de 15 minutos do
 * agendador agora procura esses chamados e avisa a gestão, no sino e por e-mail, uma vez por chamado.
 */

const MARCA = `crit${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
let gestorA;
let gestorB;
let administrador;
let gestorInativo;
let tecnico;
let solicitante;
let localId;
let categoriaId;
const chamados = [];
const planos = [];

/** A preventiva exige plano e data prevista (chamado_preventiva_coerente). */
async function criarPlano() {
  const { rows } = await pool.query(
    // Desligado e com a próxima execução longe: ativo, o agendador geraria chamado dele em outra suíte.
    `INSERT INTO plano_preventivo
       (titulo, descricao, local_id, categoria_id, prioridade, repetir_a_cada, unidade_repeticao,
        data_inicio, proxima_execucao, ativo, criado_por)
     VALUES ($1, 'Plano de teste do aviso', $2, $3, 'critica', 1, 'ano',
             current_date + 365, current_date + 365, FALSE, $4)
     RETURNING id`,
    [`Plano ${MARCA}`, localId, categoriaId, gestorA.id]
  );
  planos.push(rows[0].id);
  return rows[0].id;
}

async function conta(perfil, { ativo = true } = {}) {
  const emailDaConta = `${MARCA}_${perfil}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  const registro = await request(app).post('/auth/registrar').send({ nome: `Crit ${perfil}`, email: emailDaConta, senha: 'senha-teste-123' });
  expect(registro.status).toBe(202);
  if (perfil !== 'solicitante' || !ativo) {
    await pool.query('UPDATE usuario SET perfil = $1, ativo = $2 WHERE email = $3', [perfil, ativo, emailDaConta]);
  }
  const login = await request(app).post('/auth/login').set('X-Real-IP', `${IP}-${Math.random()}`).send({ email: emailDaConta, senha: 'senha-teste-123' });
  const { rows } = await pool.query('SELECT id FROM usuario WHERE email = $1', [emailDaConta]);
  return { id: rows[0].id, email: emailDaConta, token: login.body.token };
}

const comoAgendador = () => ({ Authorization: `Bearer ${SEGREDO}` });
const varrer = () => request(app).post('/tarefas/notificar-atrasos').set(comoAgendador());

/**
 * Abre um crítico pela API (urgência, impacto e risco máximos) e o envelhece.
 *
 * A abertura é ancorada em 2002 com um deslocamento próprio: a varredura leva os mais antigos primeiro,
 * e o banco de teste acumula críticos abertos das outras suítes. Assim os desta suíte ficam sempre à
 * frente na fila, e o teste não depende de quantos críticos alheios existem agora.
 */
let deslocamento = 0;
async function critico({ minutos = null, abertoEm = null, prioridade = 'critica', estado = 'aberto', origem = 'corretiva' } = {}) {
  const resp = await request(app)
    .post('/chamados')
    .set({ Authorization: `Bearer ${solicitante.token}` })
    .send({ titulo: `${MARCA} crítico`, descricao: 'Parada elétrica no bloco A.', categoria_id: categoriaId, local_id: localId, urgencia: 4, impacto: 4, risco: 4 });
  expect(resp.status).toBe(201);
  const id = resp.body.chamado.id;
  chamados.push(id);
  deslocamento += 1;
  const abertura = abertoEm ?? `2002-01-01T00:00:00Z`;
  await pool.query(
    `UPDATE chamado SET data_abertura = CASE WHEN $2::int IS NULL THEN $1::timestamptz + ($3 * interval '1 second') ELSE now() - ($2 * interval '1 minute') END,
                        prioridade = $4::prioridade_chamado, prioridade_sugerida = NULL, estado = $5::estado_chamado, origem = $6::origem_chamado,
                        plano_id = $8, data_prevista = CASE WHEN $8::int IS NULL THEN NULL ELSE current_date END
      WHERE id = $7`,
    [abertura, minutos, deslocamento, prioridade, estado, origem, id, origem === 'preventiva' ? await criarPlano() : null]
  );
  return id;
}

const avisosDe = async (id) =>
  (await pool.query("SELECT usuario_id, mensagem FROM notificacao WHERE chamado_id = $1 AND tipo = 'critico_sem_atendimento' ORDER BY usuario_id", [id])).rows;
const marcado = async (id) => (await pool.query('SELECT critico_notificado_em FROM chamado WHERE id = $1', [id])).rows[0].critico_notificado_em;

let envios;
beforeAll(async () => {
  // O teto de e-mails por varredura (LIMITE_ENVIOS) vale para o banco todo: gestor e administrador
  // de suíte que já terminou seguem ativos até o teardown global e disputam os envios. Quanto mais
  // suítes antes desta, mais contas, até os três destinatários daqui ficarem fora do teto (a suíte
  // passava no CI por pouco, e falhou ao entrar mais uma antes dela). A suíte roda em série, então
  // desativar as dos outros é seguro.
  await pool.query(
    `UPDATE usuario SET ativo = FALSE
      WHERE perfil IN ('gestor', 'administrador') AND email LIKE '%@exemplo.com' AND email NOT LIKE $1`,
    [`${MARCA}%`]
  );
  gestorA = await conta('gestor');
  gestorB = await conta('gestor');
  administrador = await conta('administrador');
  gestorInativo = await conta('gestor', { ativo: false });
  tecnico = await conta('tecnico');
  solicitante = await conta('solicitante');
  localId = await garantirLocal({ unidade: `Unidade ${MARCA}` });
  categoriaId = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
});

beforeEach(() => {
  envios = jest.spyOn(email, 'enviar').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await pool.query('DELETE FROM notificacao WHERE chamado_id = ANY($1::int[])', [chamados]);
  await pool.query('DELETE FROM historico_chamado WHERE chamado_id = ANY($1::int[])', [chamados]);
  await pool.query('DELETE FROM chamado WHERE id = ANY($1::int[])', [chamados]);
  await pool.query('DELETE FROM plano_preventivo WHERE id = ANY($1::int[])', [planos]);
  await pool.end();
});

describe('Crítico que ninguém atendeu', () => {
  it('avisa a gestão ativa, no sino e por e-mail, e só a gestão', async () => {
    const id = await critico({});

    const resp = await varrer();

    expect(resp.status).toBe(200);
    expect(resp.body.criticos_avisados).toBeGreaterThanOrEqual(1);
    const { protocolo } = (await pool.query('SELECT protocolo FROM chamado WHERE id = $1', [id])).rows[0];
    expect(resp.body.protocolos_criticos).toContain(protocolo);

    const avisos = await avisosDe(id);
    const recebem = avisos.map((a) => a.usuario_id);
    expect(recebem).toEqual(expect.arrayContaining([gestorA.id, gestorB.id, administrador.id]));
    // Conta desativada, técnico e solicitante não são avisados.
    for (const fora of [gestorInativo, tecnico, solicitante]) expect(recebem).not.toContain(fora.id);

    const enviadosPara = envios.mock.calls.map(([m]) => m.para);
    expect(enviadosPara).toEqual(expect.arrayContaining([gestorA.email, gestorB.email, administrador.email]));
    expect(enviadosPara).not.toContain(gestorInativo.email);
    const doChamado = envios.mock.calls.map(([m]) => m).find((m) => m.assunto.includes(protocolo));
    expect(doChamado.assunto).toBe(`[${protocolo}] CRÍTICO sem atendimento`);
    expect(doChamado.texto).toMatch(/ninguém o pegou/);
  });

  it('a mensagem diz o protocolo, o título e há quanto tempo está parado', async () => {
    const id = await critico({ minutos: 40 });

    await varrer();

    const [aviso] = await avisosDe(id);
    expect(aviso.mensagem).toMatch(/Chamado CRÍTICO sem atendimento: .* \(".*crítico"\) está aberto há 40 minutos/);
  });

  it('avisa uma vez só: a passagem seguinte não repete', async () => {
    const id = await critico({});
    await varrer();
    const primeiro = (await avisosDe(id)).length;
    expect(primeiro).toBeGreaterThanOrEqual(3);
    expect(await marcado(id)).not.toBeNull();

    envios.mockClear();
    await varrer();

    expect((await avisosDe(id)).length).toBe(primeiro);
    expect(envios.mock.calls.filter(([m]) => m.assunto.includes('CRÍTICO sem atendimento')).length).toBe(0);
  });

  it('crítico de sábado à noite também avisa: o relógio é corrido, sem expediente', async () => {
    // 5/1/2002, às 19h de Brasília (22h UTC): sábado nos dois relógios.
    const sabado = '2002-01-05T22:00:00Z';
    expect(new Date(sabado).getUTCDay()).toBe(6);
    expect(new Date(sabado).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Sao_Paulo' })).toBe('Saturday');
    const id = await critico({ abertoEm: sabado });

    await varrer();

    expect((await avisosDe(id)).length).toBeGreaterThanOrEqual(3);
  });

  it('antes dos 15 minutos não avisa, e avisa quando passam', async () => {
    const id = await critico({ minutos: 10 });
    await varrer();
    expect(await avisosDe(id)).toHaveLength(0);
    expect(await marcado(id)).toBeNull();

    await pool.query("UPDATE chamado SET data_abertura = now() - interval '16 minutes' WHERE id = $1", [id]);
    await varrer();
    expect((await avisosDe(id)).length).toBeGreaterThanOrEqual(3);
  });

  it('chamado que já saiu de "aberto" (alguém o pegou) não gera aviso', async () => {
    for (const estado of ['em_triagem', 'atribuido', 'em_andamento', 'cancelado']) {
      const id = await critico({ estado });
      await varrer();
      expect(await avisosDe(id)).toHaveLength(0);
    }
  });

  it('só o crítico corretivo: alta, e a preventiva, não são este aviso', async () => {
    const alta = await critico({ prioridade: 'alta' });
    const preventiva = await critico({ origem: 'preventiva' });

    await varrer();

    expect(await avisosDe(alta)).toHaveLength(0);
    expect(await avisosDe(preventiva)).toHaveLength(0);
  });

  it('a mesma passagem do agendador devolve o aviso de atraso e o de crítico', async () => {
    const resp = await varrer();

    expect(resp.body).toEqual(
      expect.objectContaining({
        chamados_notificados: expect.any(Number),
        criticos_avisados: expect.any(Number),
        avisos_criticos: expect.any(Number),
        protocolos_criticos: expect.any(Array),
      })
    );
  });

  it('se o aviso de crítico falhar, a tarefa aparece como falha em vez de passar calada', async () => {
    jest.spyOn(criticos, 'notificarCriticosSemAtendimento').mockRejectedValue(new Error('banco caiu'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const resp = await varrer();

    expect(resp.status).toBe(500);
    const { rows } = await pool.query("SELECT sucesso, erro FROM execucao_tarefa WHERE tarefa = 'notificar-atrasos' ORDER BY id DESC LIMIT 1");
    expect(rows[0]).toMatchObject({ sucesso: false, erro: 'banco caiu' });
  });

  it('o e-mail que não sai não desfaz o aviso em tela nem repete o aviso', async () => {
    envios.mockResolvedValue(false);
    const id = await critico({});

    await varrer();
    const avisos = (await avisosDe(id)).length;
    await varrer();

    expect(avisos).toBeGreaterThanOrEqual(3);
    expect((await avisosDe(id)).length).toBe(avisos);
  });
});

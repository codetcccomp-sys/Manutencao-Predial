const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const { ipDaSuite } = require('./apoio/ip');
const { apagarChamados } = require('./apoio/limpeza');
const { MINUTOS_ATE_ATENDER_CRITICO } = require('../src/config/atendimento');

/**
 * Alerta de primeiro atendimento da ordem de serviço crítica.
 *
 * O relógio é à parte do prazo de resolução: um chamado crítico que ninguém
 * pegou em 15 minutos precisa aparecer para a gestão, mesmo que o prazo de
 * resolução esteja longe de estourar. "Atendido" é o chamado sair de `aberto`.
 *
 * Os chamados daqui são criados pela API e só então têm prioridade, origem e
 * data de abertura ajustadas no banco: a regra lê esses três campos, e esperar
 * 15 minutos de verdade não é opção. Todos são apagados no fim, porque um
 * chamado aberto "há horas" em outra suíte mudaria o que ela conta.
 */

const IP = ipDaSuite(__filename);
const MARCA = `crit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

let gestor;
let tecnico;
let solicitante;
let localId;
let categoriaId;
const criados = [];
const planos = [];

// A preventiva exige plano e data prevista (chamado_preventiva_coerente). O
// plano nasce desligado e com a próxima execução longe: ativo, o agendador
// geraria chamado dele em outra suíte.
async function criarPlano() {
  const { rows } = await pool.query(
    `INSERT INTO plano_preventivo
       (titulo, descricao, local_id, categoria_id, prioridade, repetir_a_cada, unidade_repeticao,
        data_inicio, proxima_execucao, ativo, criado_por)
     VALUES ($1, 'Plano de teste do alerta', $2, $3, 'critica', 1, 'ano',
             current_date + 365, current_date + 365, FALSE, $4)
     RETURNING id`,
    [`Plano ${MARCA}`, localId, categoriaId, gestor.usuario.id]
  );
  planos.push(rows[0].id);
  return rows[0].id;
}

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_crit_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Crit ${perfil}`, email, senha: 'senha-teste-123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha-teste-123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

const auth = (quem) => ({ Authorization: `Bearer ${quem.token}` });

/**
 * Abre um chamado e o deixa como pedido: prioridade, origem, estado e há quantos
 * minutos foi aberto. O título leva a marca da suíte, para os filtros da lista
 * enxergarem só o que este arquivo criou.
 */
async function abrir({ prioridade = 'critica', origem = 'corretiva', minutos = 20, estado = 'aberto', rotulo = '' } = {}) {
  const resposta = await request(app)
    .post('/chamados')
    .set(auth(solicitante))
    .send({
      titulo: `Painel em curto ${MARCA} ${rotulo}`.trim(),
      descricao: 'Descrição do problema relatado para o teste',
      categoria_id: categoriaId,
      local_id: localId,
    });
  const id = resposta.body.chamado.id;
  criados.push(id);
  const planoId = origem === 'preventiva' ? await criarPlano() : null;
  await pool.query(
    `UPDATE chamado
        SET prioridade = $2, origem = $3, estado = $4, tecnico_id = NULL,
            plano_id = $6, data_prevista = CASE WHEN $6::int IS NULL THEN NULL ELSE current_date END,
            data_abertura = now() - make_interval(mins => $5)
      WHERE id = $1`,
    [id, prioridade, origem, estado, minutos, planoId]
  );
  return id;
}

const detalhe = async (id) => (await request(app).get(`/chamados/${id}`).set(auth(gestor))).body.chamado;
const listaSinalizada = async (quem = gestor) =>
  (await request(app).get('/chamados').query({ sem_atendimento: 'true', busca: MARCA, limite: 100 }).set(auth(quem))).body;

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor');
  tecnico = await criarUsuarioELogar('tecnico');
  solicitante = await criarUsuarioELogar('solicitante');
  localId = await garantirLocal({ unidade: 'Unidade Crítico' });
  categoriaId = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    await apagarChamados(client, criados);
    await client.query('DELETE FROM plano_preventivo WHERE id = ANY($1::int[])', [planos]);
  } finally {
    client.release();
  }
  await pool.end();
});

describe('Crítico sem atendimento', () => {
  it('a diretriz é de 15 minutos', () => {
    expect(MINUTOS_ATE_ATENDER_CRITICO).toBe(15);
  });

  it('crítico corretivo aberto além do tempo é sinalizado no detalhe e na lista', async () => {
    const id = await abrir({ minutos: 20 });

    expect((await detalhe(id)).sem_atendimento_critico).toBe(true);

    const lista = await request(app).get('/chamados').query({ busca: MARCA, limite: 100 }).set(auth(gestor));
    expect(lista.body.chamados.find((c) => c.id === id).sem_atendimento_critico).toBe(true);
  });

  it('dentro dos 15 minutos ainda não é alerta', async () => {
    const id = await abrir({ minutos: 10 });
    expect((await detalhe(id)).sem_atendimento_critico).toBe(false);
  });

  it('sair de "aberto" desliga o alerta, e a resposta da própria mudança já vem sem ele', async () => {
    const id = await abrir({ minutos: 40 });
    expect((await detalhe(id)).sem_atendimento_critico).toBe(true);

    const triagem = await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor)).send({ estado: 'em_triagem' });
    expect(triagem.status).toBe(200);
    expect(triagem.body.chamado.sem_atendimento_critico).toBe(false);
    expect((await detalhe(id)).sem_atendimento_critico).toBe(false);
  });

  it('chamado cancelado não é alerta', async () => {
    const id = await abrir({ minutos: 40, estado: 'cancelado' });
    expect((await detalhe(id)).sem_atendimento_critico).toBe(false);
  });

  it('só a prioridade crítica conta: alta, aberta há horas, não é este alerta', async () => {
    const id = await abrir({ prioridade: 'alta', minutos: 180 });
    expect((await detalhe(id)).sem_atendimento_critico).toBe(false);
  });

  it('preventiva crítica na fila é trabalho planejado, e não emergência esquecida', async () => {
    const id = await abrir({ origem: 'preventiva', minutos: 180 });
    expect((await detalhe(id)).sem_atendimento_critico).toBe(false);
  });
});

describe('Filtro e resposta da lista', () => {
  it('sem_atendimento=true devolve só os sinalizados', async () => {
    const sim = await abrir({ minutos: 30, rotulo: 'sim' });
    const dentroDoPrazo = await abrir({ minutos: 5, rotulo: 'cedo' });
    const naoCritico = await abrir({ prioridade: 'media', minutos: 90, rotulo: 'media' });

    const corpo = await listaSinalizada();
    const ids = corpo.chamados.map((c) => c.id);

    expect(ids).toContain(sim);
    expect(ids).not.toContain(dentroDoPrazo);
    expect(ids).not.toContain(naoCritico);
    expect(corpo.chamados.every((c) => c.sem_atendimento_critico === true)).toBe(true);
    // O total da paginação acompanha o filtro, que é o que o alerta da gestão conta.
    expect(corpo.paginacao.total).toBe(corpo.chamados.length);
  });

  it('a lista diz quantos minutos valem, para a tela não repetir o número', async () => {
    const resposta = await request(app).get('/chamados').query({ limite: 1 }).set(auth(gestor));
    expect(resposta.body.atendimento_critico_minutos).toBe(MINUTOS_ATE_ATENDER_CRITICO);
  });

  it('o filtro respeita quem pode ver: o técnico só enxerga o que lhe foi designado', async () => {
    await abrir({ minutos: 30, rotulo: 'do-tecnico' });
    // Aberto e sem técnico: o técnico não o vê, com ou sem filtro.
    const corpo = await listaSinalizada(tecnico);
    expect(corpo.chamados).toEqual([]);
  });
});

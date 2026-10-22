const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const { apagarChamados } = require('./apoio/limpeza');
const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);

/**
 * Para quem um chamado pode ser atribuído (RF05).
 *
 * `atribuir` gravava o destino sem conferir nada: aceitava um solicitante como
 * "técnico", um técnico inativo e até ninguém. Como "atendido" é sair de `aberto`,
 * um crítico atribuído a ninguém parava de alertar a gestão sem que alguém tivesse
 * assumido o chamado. Cada recusa abaixo é um caso que a prova original aceitava.
 */

const MARCA = `dest${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

let gestor;
let tecnico;
let tecnicoInativo;
let solicitante;
let localId;
let categoriaId;
let equipeComTecnico;
let equipeSemTecnico;
let equipeInativa;
const chamados = [];
const equipes = [];

async function conta(perfil, { ativo = true } = {}) {
  const email = `${MARCA}_${perfil}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Destino ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app)
    .post('/auth/login')
    .set('X-Real-IP', `${IP}-${Math.random()}`)
    .send({ email, senha: 'senha123' });
  const dados = { ...login.body.usuario, token: login.body.token };
  // Desativada depois de entrar: o token já emitido não importa aqui, só o cadastro.
  if (!ativo) await pool.query('UPDATE usuario SET ativo = FALSE WHERE id = $1', [dados.id]);
  return dados;
}

async function equipe({ tecnicos = [], ativa = true } = {}) {
  const { rows } = await pool.query('INSERT INTO equipe (nome, ativo) VALUES ($1, $2) RETURNING id', [
    `${MARCA} equipe ${equipes.length}`,
    ativa,
  ]);
  equipes.push(rows[0].id);
  for (const t of tecnicos) {
    await pool.query('INSERT INTO equipe_tecnico (equipe_id, usuario_id) VALUES ($1, $2)', [rows[0].id, t.id]);
  }
  return rows[0].id;
}

const como = (quem) => ({ Authorization: `Bearer ${quem.token}` });

/** Um chamado novo, já em triagem: é o estado em que a primeira atribuição acontece. */
async function chamadoEmTriagem() {
  const aberto = await request(app)
    .post('/chamados')
    .set(como(solicitante))
    .send({
      titulo: `${MARCA} chamado`,
      descricao: 'Lâmpada queimada no corredor.',
      categoria_id: categoriaId,
      local_id: localId,
    });
  chamados.push(aberto.body.chamado.id);
  await request(app)
    .patch(`/chamados/${aberto.body.chamado.id}/estado`)
    .set(como(gestor))
    .send({ estado: 'em_triagem' });
  return aberto.body.chamado.id;
}

const atribuir = (id, corpo) => request(app).patch(`/chamados/${id}/atribuir`).set(como(gestor)).send(corpo);

async function situacao(id) {
  const { rows } = await pool.query('SELECT estado, tecnico_id, equipe_id FROM chamado WHERE id = $1', [id]);
  return rows[0];
}

beforeAll(async () => {
  gestor = await conta('gestor');
  tecnico = await conta('tecnico');
  tecnicoInativo = await conta('tecnico', { ativo: false });
  solicitante = await conta('solicitante');
  localId = await garantirLocal({ unidade: `Unidade ${MARCA}` });
  categoriaId = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
  equipeComTecnico = await equipe({ tecnicos: [tecnico] });
  equipeSemTecnico = await equipe();
  equipeInativa = await equipe({ ativa: false });
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

describe('Destino da atribuição', () => {
  it('sem técnico e sem equipe, recusa e deixa o chamado em triagem', async () => {
    const id = await chamadoEmTriagem();

    const resp = await atribuir(id, {});

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('DESTINO_OBRIGATORIO');
    expect((await situacao(id)).estado).toBe('em_triagem');
  });

  it('recusa quem não é técnico (um solicitante)', async () => {
    const id = await chamadoEmTriagem();

    const resp = await atribuir(id, { tecnico_id: solicitante.id });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('TECNICO_INVALIDO');
    expect(resp.body.erro.mensagem).toMatch(/não é técnico/);
    expect(await situacao(id)).toMatchObject({ estado: 'em_triagem', tecnico_id: null });
  });

  it('recusa técnico inativo', async () => {
    const id = await chamadoEmTriagem();

    const resp = await atribuir(id, { tecnico_id: tecnicoInativo.id });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.mensagem).toMatch(/inativo/);
    expect((await situacao(id)).estado).toBe('em_triagem');
  });

  it('recusa técnico que não existe', async () => {
    const id = await chamadoEmTriagem();

    const resp = await atribuir(id, { tecnico_id: 2147483000 });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.mensagem).toMatch(/não encontrado/);
  });

  it('recusa equipe que não existe e equipe desativada', async () => {
    const id = await chamadoEmTriagem();

    const inexistente = await atribuir(id, { equipe_id: 2147483000 });
    expect(inexistente.status).toBe(422);
    expect(inexistente.body.erro.codigo).toBe('EQUIPE_INVALIDA');

    const inativa = await atribuir(id, { equipe_id: equipeInativa });
    expect(inativa.status).toBe(422);
    expect(inativa.body.erro.mensagem).toMatch(/desativada/);
    expect((await situacao(id)).estado).toBe('em_triagem');
  });

  it('com técnico e equipe, o técnico precisa fazer parte da equipe', async () => {
    const id = await chamadoEmTriagem();

    const fora = await atribuir(id, { tecnico_id: tecnico.id, equipe_id: equipeSemTecnico });
    expect(fora.status).toBe(422);
    expect(fora.body.erro.codigo).toBe('TECNICO_FORA_DA_EQUIPE');
    expect((await situacao(id)).estado).toBe('em_triagem');

    const dentro = await atribuir(id, { tecnico_id: tecnico.id, equipe_id: equipeComTecnico });
    expect(dentro.status).toBe(200);
    expect(await situacao(id)).toMatchObject({
      estado: 'atribuido',
      tecnico_id: tecnico.id,
      equipe_id: equipeComTecnico,
    });
  });

  it('só técnico ativo, ou só equipe ativa, continuam atribuindo', async () => {
    const comTecnico = await chamadoEmTriagem();
    expect((await atribuir(comTecnico, { tecnico_id: tecnico.id })).status).toBe(200);
    expect(await situacao(comTecnico)).toMatchObject({ estado: 'atribuido', tecnico_id: tecnico.id });

    const comEquipe = await chamadoEmTriagem();
    expect((await atribuir(comEquipe, { equipe_id: equipeSemTecnico })).status).toBe(200);
    expect(await situacao(comEquipe)).toMatchObject({ estado: 'atribuido', equipe_id: equipeSemTecnico });
  });

  it('a reatribuição passa pela mesma conferência', async () => {
    const id = await chamadoEmTriagem();
    await atribuir(id, { tecnico_id: tecnico.id });

    const resp = await atribuir(id, {
      tecnico_id: tecnicoInativo.id,
      justificativa: 'O técnico anterior saiu de férias.',
    });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('TECNICO_INVALIDO');
    expect((await situacao(id)).tecnico_id).toBe(tecnico.id);
  });
});

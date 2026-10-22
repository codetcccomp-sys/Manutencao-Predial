const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const { apagarChamados } = require('./apoio/limpeza');
const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);

/**
 * Os ramos de recusa de materiais, equipes e equipamentos.
 *
 * A cobertura de ramos desses três serviços estava em 17%, 61% e 60%: os testes
 * provavam o caminho feliz e deixavam sem prova justamente o que o serviço faz
 * para recusar (404, "nada a atualizar", referência inexistente). São as linhas
 * que um refator desfaz sem ninguém notar.
 */

const MARCA = `aux${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

let gestor;
let tecnico;
let solicitante;
let localId;
let categoriaId;
const criados = { materiais: [], equipes: [], equipamentos: [], chamados: [] };

async function conta(perfil, { ativo = true } = {}) {
  const email = `${MARCA}_${perfil}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Aux ${perfil}`, email, senha: 'senha-teste-123' });
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
const INEXISTENTE = 2147483000;

beforeAll(async () => {
  gestor = await conta('gestor');
  tecnico = await conta('tecnico');
  solicitante = await conta('solicitante');
  localId = await garantirLocal({ unidade: `Unidade ${MARCA}` });
  categoriaId = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    await apagarChamados(client, criados.chamados);
    await client.query('DELETE FROM equipe_tecnico WHERE equipe_id = ANY($1::int[])', [criados.equipes]);
    await client.query('DELETE FROM equipe WHERE id = ANY($1::int[])', [criados.equipes]);
    await client.query('DELETE FROM equipamento WHERE id = ANY($1::int[])', [criados.equipamentos]);
    await client.query('DELETE FROM material WHERE id = ANY($1::int[])', [criados.materiais]);
  } finally {
    client.release();
  }
  await pool.end();
});

describe('Materiais', () => {
  let materialId;

  it('lista o catálogo, inclusive para o solicitante', async () => {
    const criado = await request(app)
      .post('/materiais')
      .set(como(gestor))
      .send({ nome: `${MARCA} cabo`, unidade_medida: 'm' });
    materialId = criado.body.material.id;
    criados.materiais.push(materialId);

    const resp = await request(app).get('/materiais').set(como(solicitante));

    expect(resp.status).toBe(200);
    expect(resp.body.materiais.map((m) => m.id)).toContain(materialId);
  });

  it('atualiza só o nome, só a unidade, ou os dois, e guarda o que não foi mandado', async () => {
    const nome = await request(app).patch(`/materiais/${materialId}`).set(como(gestor)).send({ nome: `${MARCA} cabo flex` });
    expect(nome.body.material).toMatchObject({ nome: `${MARCA} cabo flex`, unidade_medida: 'm' });

    const unidade = await request(app).patch(`/materiais/${materialId}`).set(como(gestor)).send({ unidade_medida: 'rolo' });
    expect(unidade.body.material).toMatchObject({ nome: `${MARCA} cabo flex`, unidade_medida: 'rolo' });

    const ambos = await request(app)
      .patch(`/materiais/${materialId}`)
      .set(como(gestor))
      .send({ nome: `${MARCA} fio`, unidade_medida: 'm' });
    expect(ambos.body.material).toMatchObject({ nome: `${MARCA} fio`, unidade_medida: 'm' });
  });

  it('recusa atualizar sem campo nenhum, e material que não existe', async () => {
    const vazio = await request(app).patch(`/materiais/${materialId}`).set(como(gestor)).send({});
    expect(vazio.status).toBe(422);
    expect(vazio.body.erro.codigo).toBe('NADA_A_ATUALIZAR');

    const sumido = await request(app).patch(`/materiais/${INEXISTENTE}`).set(como(gestor)).send({ nome: 'Qualquer um' });
    expect(sumido.status).toBe(404);
    expect(sumido.body.erro.codigo).toBe('MATERIAL_NAO_ENCONTRADO');
  });

  it('solicitante não altera o catálogo', async () => {
    const resp = await request(app).patch(`/materiais/${materialId}`).set(como(solicitante)).send({ nome: 'Invasor' });
    expect(resp.status).toBe(403);
  });

  it('no chamado: lançar material que não existe, e remover lançamento que não existe, voltam 404', async () => {
    const aberto = await request(app)
      .post('/chamados')
      .set(como(solicitante))
      .send({ titulo: `${MARCA} chamado`, descricao: 'Lâmpada queimada.', categoria_id: categoriaId, local_id: localId });
    const chamadoId = aberto.body.chamado.id;
    criados.chamados.push(chamadoId);

    const lancar = await request(app)
      .post(`/chamados/${chamadoId}/materiais`)
      .set(como(gestor))
      .send({ material_id: INEXISTENTE, quantidade: 1 });
    expect(lancar.status).toBe(404);
    expect(lancar.body.erro.codigo).toBe('MATERIAL_NAO_ENCONTRADO');

    const remover = await request(app).delete(`/chamados/${chamadoId}/materiais/${materialId}`).set(como(gestor));
    expect(remover.status).toBe(404);
    expect(remover.body.erro.codigo).toBe('LANCAMENTO_NAO_ENCONTRADO');
  });
});

describe('Equipes', () => {
  let equipeId;

  beforeAll(async () => {
    const criada = await request(app).post('/equipes').set(como(gestor)).send({ nome: `${MARCA} equipe` });
    equipeId = criada.body.equipe.id;
    criados.equipes.push(equipeId);
  });

  it('a ficha de uma equipe que não existe volta 404', async () => {
    const resp = await request(app).get(`/equipes/${INEXISTENTE}`).set(como(gestor));
    expect(resp.status).toBe(404);
    expect(resp.body.erro.codigo).toBe('EQUIPE_NAO_ENCONTRADA');
  });

  it('renomeia, desativa e reativa, cada campo sozinho', async () => {
    const renomeada = await request(app).patch(`/equipes/${equipeId}`).set(como(gestor)).send({ nome: `${MARCA} equipe B` });
    expect(renomeada.body.equipe).toMatchObject({ nome: `${MARCA} equipe B`, ativo: true });

    const desativada = await request(app).patch(`/equipes/${equipeId}`).set(como(gestor)).send({ ativo: false });
    expect(desativada.body.equipe).toMatchObject({ nome: `${MARCA} equipe B`, ativo: false });

    const reativada = await request(app).patch(`/equipes/${equipeId}`).set(como(gestor)).send({ ativo: true });
    expect(reativada.body.equipe.ativo).toBe(true);
  });

  it('recusa atualizar sem campo nenhum, e equipe que não existe', async () => {
    const vazio = await request(app).patch(`/equipes/${equipeId}`).set(como(gestor)).send({});
    expect(vazio.status).toBe(422);
    expect(vazio.body.erro.codigo).toBe('NADA_A_ATUALIZAR');

    const sumida = await request(app).patch(`/equipes/${INEXISTENTE}`).set(como(gestor)).send({ nome: 'Qualquer uma' });
    expect(sumida.status).toBe(404);
  });

  it('ao adicionar técnico: equipe inexistente, usuário inexistente e técnico inativo são recusados', async () => {
    const semEquipe = await request(app)
      .post(`/equipes/${INEXISTENTE}/tecnicos`)
      .set(como(gestor))
      .send({ usuario_id: tecnico.id });
    expect(semEquipe.status).toBe(404);
    expect(semEquipe.body.erro.codigo).toBe('EQUIPE_NAO_ENCONTRADA');

    const semUsuario = await request(app)
      .post(`/equipes/${equipeId}/tecnicos`)
      .set(como(gestor))
      .send({ usuario_id: INEXISTENTE });
    expect(semUsuario.status).toBe(404);
    expect(semUsuario.body.erro.codigo).toBe('USUARIO_NAO_ENCONTRADO');

    const inativo = await conta('tecnico', { ativo: false });
    const resp = await request(app)
      .post(`/equipes/${equipeId}/tecnicos`)
      .set(como(gestor))
      .send({ usuario_id: inativo.id });
    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('USUARIO_INATIVO');
  });
});

describe('Equipamentos', () => {
  let equipamentoId;
  const codigo = `${MARCA}-AC1`.toUpperCase();

  async function criar(extra = {}) {
    return request(app)
      .post('/equipamentos')
      .set(como(gestor))
      .send({ codigo, nome: `${MARCA} split`, categoria_id: categoriaId, local_id: localId, ...extra });
  }

  beforeAll(async () => {
    const resp = await criar();
    equipamentoId = resp.body.equipamento.id;
    criados.equipamentos.push(equipamentoId);
  });

  it('filtra por local e por trecho do código ou do nome, sem diferenciar maiúsculas', async () => {
    const porLocal = await request(app).get(`/equipamentos?local_id=${localId}`).set(como(gestor));
    expect(porLocal.body.equipamentos.map((e) => e.id)).toContain(equipamentoId);

    const porNome = await request(app).get(`/equipamentos?busca=${MARCA.toUpperCase()}%20SPLIT`).set(como(gestor));
    expect(porNome.body.equipamentos.map((e) => e.id)).toContain(equipamentoId);

    const porCodigo = await request(app).get(`/equipamentos?busca=${MARCA}-ac1`).set(como(gestor));
    expect(porCodigo.body.equipamentos.map((e) => e.id)).toContain(equipamentoId);

    const nenhum = await request(app).get(`/equipamentos?busca=${MARCA}-nada-assim`).set(como(gestor));
    expect(nenhum.body.equipamentos).toEqual([]);
  });

  it('desativado some da listagem padrão e volta para a gestão que pede os inativos', async () => {
    await request(app).patch(`/equipamentos/${equipamentoId}`).set(como(gestor)).send({ ativo: false });

    const padrao = await request(app).get(`/equipamentos?local_id=${localId}`).set(como(gestor));
    expect(padrao.body.equipamentos.map((e) => e.id)).not.toContain(equipamentoId);

    const comInativos = await request(app)
      .get(`/equipamentos?local_id=${localId}&incluir_inativos=true`)
      .set(como(gestor));
    expect(comInativos.body.equipamentos.map((e) => e.id)).toContain(equipamentoId);

    // O solicitante não vê inativos mesmo pedindo: para quem abre chamado, equipamento
    // desativado não existe.
    const doSolicitante = await request(app)
      .get(`/equipamentos?local_id=${localId}&incluir_inativos=true`)
      .set(como(solicitante));
    expect(doSolicitante.body.equipamentos.map((e) => e.id)).not.toContain(equipamentoId);

    await request(app).patch(`/equipamentos/${equipamentoId}`).set(como(gestor)).send({ ativo: true });
  });

  it('a ficha de um equipamento que não existe volta 404', async () => {
    const resp = await request(app).get(`/equipamentos/${INEXISTENTE}`).set(como(gestor));
    expect(resp.status).toBe(404);
    expect(resp.body.erro.codigo).toBe('EQUIPAMENTO_NAO_ENCONTRADO');
  });

  it('recusa data de instalação inválida, na criação e na edição', async () => {
    const criacao = await criar({ codigo: `${MARCA}-DATA`.toUpperCase(), data_instalacao: '31/12/2025' });
    expect(criacao.status).toBe(422);
    expect(criacao.body.erro.mensagem).toMatch(/AAAA-MM-DD/);

    const edicao = await request(app)
      .patch(`/equipamentos/${equipamentoId}`)
      .set(como(gestor))
      .send({ data_instalacao: '2025-13-45' });
    expect(edicao.status).toBe(422);
  });

  it('campo opcional vazio vira nulo, em vez de texto em branco', async () => {
    const resp = await request(app)
      .patch(`/equipamentos/${equipamentoId}`)
      .set(como(gestor))
      .send({ fabricante: 'Daikin', modelo: '   ' });

    expect(resp.status).toBe(200);
    expect(resp.body.equipamento.fabricante).toBe('Daikin');
    expect(resp.body.equipamento.modelo).toBeNull();
  });

  it('categoria ou local que não existem voltam 422, e não erro do banco', async () => {
    const criacao = await criar({ codigo: `${MARCA}-FK`.toUpperCase(), categoria_id: INEXISTENTE });
    expect(criacao.status).toBe(422);
    expect(criacao.body.erro.codigo).toBe('REFERENCIA_INVALIDA');

    const edicao = await request(app)
      .patch(`/equipamentos/${equipamentoId}`)
      .set(como(gestor))
      .send({ local_id: INEXISTENTE });
    expect(edicao.status).toBe(422);
    expect(edicao.body.erro.codigo).toBe('REFERENCIA_INVALIDA');
  });

  it('trocar o código por um que já existe volta 409', async () => {
    const outro = await criar({ codigo: `${MARCA}-AC2`.toUpperCase() });
    criados.equipamentos.push(outro.body.equipamento.id);

    const resp = await request(app)
      .patch(`/equipamentos/${outro.body.equipamento.id}`)
      .set(como(gestor))
      .send({ codigo });

    expect(resp.status).toBe(409);
    expect(resp.body.erro.codigo).toBe('CODIGO_DUPLICADO');
  });

  it('recusa atualizar sem campo nenhum, e equipamento que não existe', async () => {
    const vazio = await request(app).patch(`/equipamentos/${equipamentoId}`).set(como(gestor)).send({});
    expect(vazio.status).toBe(422);
    expect(vazio.body.erro.codigo).toBe('NADA_A_ATUALIZAR');

    const sumido = await request(app).patch(`/equipamentos/${INEXISTENTE}`).set(como(gestor)).send({ nome: 'Qualquer um' });
    expect(sumido.status).toBe(404);
  });
});

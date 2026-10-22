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
let chamadoId;

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_em_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Teste ${perfil}`, email, senha: 'senha-teste-123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha-teste-123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor');
  tecnico = await criarUsuarioELogar('tecnico');
  outroTecnico = await criarUsuarioELogar('tecnico');
  solicitante = await criarUsuarioELogar('solicitante');

  const localDeTeste = await garantirLocal({ unidade: 'Unidade EM' });
  const categoria = await pool.query('SELECT id FROM categoria LIMIT 1');

  const abertura = await request(app)
    .post('/chamados')
    .set('Authorization', `Bearer ${solicitante.token}`)
    .send({
      titulo: 'Chamado para materiais',
      descricao: 'Descrição do chamado de teste',
      categoria_id: categoria.rows[0].id,
      local_id: localDeTeste,
    });
  chamadoId = abertura.body.chamado.id;

  // Leva o chamado até "atribuido" ao técnico, que é o estado em que faz
  // sentido lançar consumo de material.
  await request(app)
    .patch(`/chamados/${chamadoId}/estado`)
    .set('Authorization', `Bearer ${gestor.token}`)
    .send({ estado: 'em_triagem' });
  await request(app)
    .patch(`/chamados/${chamadoId}/atribuir`)
    .set('Authorization', `Bearer ${gestor.token}`)
    .send({ tecnico_id: tecnico.usuario.id });
});

afterAll(async () => {
  await pool.end();
});

describe('Equipes', () => {
  let equipeId;

  it('gestor cria equipe; solicitante não', async () => {
    const negado = await request(app)
      .post('/equipes')
      .set('Authorization', `Bearer ${solicitante.token}`)
      .send({ nome: 'Equipe Proibida' });
    expect(negado.status).toBe(403);

    const criada = await request(app)
      .post('/equipes')
      .set('Authorization', `Bearer ${gestor.token}`)
      .send({ nome: `Equipe ${Date.now()}` });
    expect(criada.status).toBe(201);
    equipeId = criada.body.equipe.id;
  });

  it('adiciona técnico e lista os membros', async () => {
    const resp = await request(app)
      .post(`/equipes/${equipeId}/tecnicos`)
      .set('Authorization', `Bearer ${gestor.token}`)
      .send({ usuario_id: tecnico.usuario.id });

    expect(resp.status).toBe(201);
    expect(resp.body.equipe.tecnicos.map((t) => t.id)).toContain(tecnico.usuario.id);
  });

  it('adicionar o mesmo técnico duas vezes não duplica nem falha', async () => {
    const resp = await request(app)
      .post(`/equipes/${equipeId}/tecnicos`)
      .set('Authorization', `Bearer ${gestor.token}`)
      .send({ usuario_id: tecnico.usuario.id });

    expect(resp.status).toBe(201);
    const vezes = resp.body.equipe.tecnicos.filter((t) => t.id === tecnico.usuario.id).length;
    expect(vezes).toBe(1);
  });

  it('recusa quem não é técnico', async () => {
    const resp = await request(app)
      .post(`/equipes/${equipeId}/tecnicos`)
      .set('Authorization', `Bearer ${gestor.token}`)
      .send({ usuario_id: solicitante.usuario.id });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('PERFIL_INVALIDO');
  });

  it('remove técnico e recusa remover vínculo inexistente', async () => {
    const removido = await request(app)
      .delete(`/equipes/${equipeId}/tecnicos/${tecnico.usuario.id}`)
      .set('Authorization', `Bearer ${gestor.token}`);
    expect(removido.status).toBe(200);
    expect(removido.body.equipe.tecnicos).toHaveLength(0);

    const denovo = await request(app)
      .delete(`/equipes/${equipeId}/tecnicos/${tecnico.usuario.id}`)
      .set('Authorization', `Bearer ${gestor.token}`);
    expect(denovo.status).toBe(404);
  });

  it('equipe desativada some da listagem padrão', async () => {
    await request(app)
      .patch(`/equipes/${equipeId}`)
      .set('Authorization', `Bearer ${gestor.token}`)
      .send({ ativo: false });

    const padrao = await request(app).get('/equipes').set('Authorization', `Bearer ${gestor.token}`);
    expect(padrao.body.equipes.map((e) => e.id)).not.toContain(equipeId);

    const comInativas = await request(app)
      .get('/equipes?incluir_inativas=true')
      .set('Authorization', `Bearer ${gestor.token}`);
    expect(comInativas.body.equipes.map((e) => e.id)).toContain(equipeId);
  });
});

describe('Materiais', () => {
  let materialId;

  it('gestor cadastra material no catálogo', async () => {
    const resp = await request(app)
      .post('/materiais')
      .set('Authorization', `Bearer ${gestor.token}`)
      .send({ nome: `Cabo ${Date.now()}`, unidade_medida: 'm' });

    expect(resp.status).toBe(201);
    materialId = resp.body.material.id;
  });

  it('técnico designado lança consumo no chamado', async () => {
    const resp = await request(app)
      .post(`/chamados/${chamadoId}/materiais`)
      .set('Authorization', `Bearer ${tecnico.token}`)
      .send({ material_id: materialId, quantidade: 2.5 });

    expect(resp.status).toBe(201);
    expect(resp.body.materiais).toHaveLength(1);
    expect(Number(resp.body.materiais[0].quantidade)).toBe(2.5);
  });

  it('lançar o mesmo material de novo corrige a quantidade em vez de duplicar', async () => {
    const resp = await request(app)
      .post(`/chamados/${chamadoId}/materiais`)
      .set('Authorization', `Bearer ${tecnico.token}`)
      .send({ material_id: materialId, quantidade: 4 });

    expect(resp.body.materiais).toHaveLength(1);
    expect(Number(resp.body.materiais[0].quantidade)).toBe(4);
  });

  it('técnico de outro chamado não lança consumo neste', async () => {
    const resp = await request(app)
      .post(`/chamados/${chamadoId}/materiais`)
      .set('Authorization', `Bearer ${outroTecnico.token}`)
      .send({ material_id: materialId, quantidade: 1 });

    expect(resp.status).toBe(403);
  });

  it('solicitante do chamado vê o consumo mas não lança', async () => {
    const leitura = await request(app)
      .get(`/chamados/${chamadoId}/materiais`)
      .set('Authorization', `Bearer ${solicitante.token}`);
    expect(leitura.status).toBe(200);
    expect(leitura.body.materiais).toHaveLength(1);

    const escrita = await request(app)
      .post(`/chamados/${chamadoId}/materiais`)
      .set('Authorization', `Bearer ${solicitante.token}`)
      .send({ material_id: materialId, quantidade: 1 });
    expect(escrita.status).toBe(403);
  });

  it('recusa quantidade zero ou negativa', async () => {
    const resp = await request(app)
      .post(`/chamados/${chamadoId}/materiais`)
      .set('Authorization', `Bearer ${tecnico.token}`)
      .send({ material_id: materialId, quantidade: 0 });

    expect(resp.status).toBe(422);
  });

  it('remove o lançamento', async () => {
    const resp = await request(app)
      .delete(`/chamados/${chamadoId}/materiais/${materialId}`)
      .set('Authorization', `Bearer ${tecnico.token}`);

    expect(resp.status).toBe(200);
    expect(resp.body.materiais).toHaveLength(0);
  });
});

describe('Validação de faixa numérica', () => {
  it('avaliação com nota fora de 1..5 volta 422, e não erro do banco', async () => {
    const resp = await request(app)
      .post(`/chamados/${chamadoId}/avaliacao`)
      .set('Authorization', `Bearer ${solicitante.token}`)
      .send({ nota: 9 });

    expect(resp.status).toBe(422);
  });
});

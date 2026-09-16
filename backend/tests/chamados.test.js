const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

afterAll(async () => {
  await pool.end();
});

async function criarUsuarioELogar(perfilDesejado) {
  const email = `${perfilDesejado}_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: 'Teste', email, senha: 'senha123' });

  if (perfilDesejado !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfilDesejado, email]);
  }

  const loginResp = await request(app).post('/auth/login').send({ email, senha: 'senha123' });
  return { token: loginResp.body.token, usuario: loginResp.body.usuario };
}

async function obterLocalECategoria() {
  const localResp = await pool.query(
    "INSERT INTO local (unidade) VALUES ('Unidade Teste') RETURNING id"
  );
  const categoriaResp = await pool.query("SELECT id FROM categoria LIMIT 1");
  return { localId: localResp.rows[0].id, categoriaId: categoriaResp.rows[0].id };
}

describe('Fluxo de chamados', () => {
  let solicitante, tecnico, gestor, localId, categoriaId;

  beforeAll(async () => {
    solicitante = await criarUsuarioELogar('solicitante');
    tecnico = await criarUsuarioELogar('tecnico');
    gestor = await criarUsuarioELogar('gestor');
    ({ localId, categoriaId } = await obterLocalECategoria());
  });

  it('solicitante consegue abrir um chamado', async () => {
    const resp = await request(app)
      .post('/chamados')
      .set('Authorization', `Bearer ${solicitante.token}`)
      .send({
        titulo: 'Lâmpada queimada',
        descricao: 'Corredor do 2º andar sem iluminação.',
        categoria_id: categoriaId,
        local_id: localId,
      });

    expect(resp.status).toBe(201);
    expect(resp.body.chamado.estado).toBe('aberto');
    expect(resp.body.chamado.protocolo).toMatch(/^SMP-/);
  });

  it('técnico não pode atribuir chamados (apenas gestor/administrador)', async () => {
    const abertura = await request(app)
      .post('/chamados')
      .set('Authorization', `Bearer ${solicitante.token}`)
      .send({ titulo: 'Teste RBAC', descricao: 'Descrição', categoria_id: categoriaId, local_id: localId });

    const chamadoId = abertura.body.chamado.id;

    const resp = await request(app)
      .patch(`/chamados/${chamadoId}/atribuir`)
      .set('Authorization', `Bearer ${tecnico.token}`)
      .send({ tecnico_id: tecnico.usuario.id });

    expect(resp.status).toBe(403);
  });

  it('rejeita transição de estado inválida (aberto -> concluido direto)', async () => {
    const abertura = await request(app)
      .post('/chamados')
      .set('Authorization', `Bearer ${solicitante.token}`)
      .send({ titulo: 'Teste transição', descricao: 'Descrição', categoria_id: categoriaId, local_id: localId });

    const chamadoId = abertura.body.chamado.id;

    const resp = await request(app)
      .patch(`/chamados/${chamadoId}/estado`)
      .set('Authorization', `Bearer ${gestor.token}`)
      .send({ estado: 'concluido' });

    expect(resp.status).toBe(409);
    expect(resp.body.erro.codigo).toBe('TRANSICAO_INVALIDA');
  });

  it('solicitante só vê os próprios chamados na listagem', async () => {
    const outroSolicitante = await criarUsuarioELogar('solicitante');
    await request(app)
      .post('/chamados')
      .set('Authorization', `Bearer ${outroSolicitante.token}`)
      .send({ titulo: 'Chamado de outro usuário', descricao: 'Descrição', categoria_id: categoriaId, local_id: localId });

    const resp = await request(app)
      .get('/chamados')
      .set('Authorization', `Bearer ${solicitante.token}`);

    expect(resp.status).toBe(200);
    expect(resp.body.chamados.every((c) => c.solicitante_id === solicitante.usuario.id)).toBe(true);
  });
});

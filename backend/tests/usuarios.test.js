const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

let admin;
let gestor;
let solicitante;

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_usr_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Usr ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').send({ email, senha: 'senha123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

beforeAll(async () => {
  admin = await criarUsuarioELogar('administrador');
  gestor = await criarUsuarioELogar('gestor');
  solicitante = await criarUsuarioELogar('solicitante');
});

afterAll(async () => {
  await pool.end();
});

const comoAdmin = () => ({ Authorization: `Bearer ${admin.token}` });

describe('POST /usuarios', () => {
  it('administrador cria usuário com perfil escolhido', async () => {
    const resp = await request(app)
      .post('/usuarios')
      .set(comoAdmin())
      .send({
        nome: 'Técnico Novo',
        email: `tecnico_novo_${Date.now()}@exemplo.com`,
        senha: 'senha123',
        perfil: 'tecnico',
      });

    expect(resp.status).toBe(201);
    expect(resp.body.usuario.perfil).toBe('tecnico');
  });

  it('gestor não cria usuário', async () => {
    const resp = await request(app)
      .post('/usuarios')
      .set('Authorization', `Bearer ${gestor.token}`)
      .send({ nome: 'X', email: `x_${Date.now()}@exemplo.com`, senha: 'senha123', perfil: 'tecnico' });

    expect(resp.status).toBe(403);
  });
});

describe('GET /usuarios', () => {
  it('omite inativos por padrão e os inclui quando pedido', async () => {
    const criado = await request(app)
      .post('/usuarios')
      .set(comoAdmin())
      .send({
        nome: 'Vai Desligar',
        email: `desligado_${Date.now()}@exemplo.com`,
        senha: 'senha123',
        perfil: 'tecnico',
      });
    const id = criado.body.usuario.id;

    await request(app).patch(`/usuarios/${id}`).set(comoAdmin()).send({ ativo: false });

    const padrao = await request(app).get('/usuarios?perfil=tecnico').set(comoAdmin());
    expect(padrao.body.usuarios.map((u) => u.id)).not.toContain(id);

    const completo = await request(app)
      .get('/usuarios?perfil=tecnico&incluir_inativos=true')
      .set(comoAdmin());
    expect(completo.body.usuarios.map((u) => u.id)).toContain(id);
  });

  it('solicitante não lista usuários', async () => {
    const resp = await request(app)
      .get('/usuarios')
      .set('Authorization', `Bearer ${solicitante.token}`);
    expect(resp.status).toBe(403);
  });
});

describe('PATCH /usuarios/:id', () => {
  it('altera perfil de outro usuário', async () => {
    const resp = await request(app)
      .patch(`/usuarios/${solicitante.usuario.id}`)
      .set(comoAdmin())
      .send({ perfil: 'gestor' });

    expect(resp.status).toBe(200);
    expect(resp.body.usuario.perfil).toBe('gestor');

    // Devolve ao estado anterior para não interferir nos outros testes.
    await request(app)
      .patch(`/usuarios/${solicitante.usuario.id}`)
      .set(comoAdmin())
      .send({ perfil: 'solicitante' });
  });

  it('impede desativar a própria conta', async () => {
    const resp = await request(app)
      .patch(`/usuarios/${admin.usuario.id}`)
      .set(comoAdmin())
      .send({ ativo: false });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('AUTO_DESATIVACAO');
  });

  it('impede alterar o próprio perfil', async () => {
    const resp = await request(app)
      .patch(`/usuarios/${admin.usuario.id}`)
      .set(comoAdmin())
      .send({ perfil: 'solicitante' });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('AUTO_REBAIXAMENTO');
  });

  it('impede remover o último administrador ativo', async () => {
    const outroAdmin = await criarUsuarioELogar('administrador');

    // Com dois administradores, rebaixar um é permitido.
    const permitido = await request(app)
      .patch(`/usuarios/${outroAdmin.usuario.id}`)
      .set(comoAdmin())
      .send({ perfil: 'gestor' });
    expect(permitido.status).toBe(200);

    // Agora sobrou um só: outro administrador tenta desativá-lo.
    const promovido = await criarUsuarioELogar('administrador');
    const restantes = await pool.query(
      "SELECT count(*)::int AS n FROM usuario WHERE perfil='administrador' AND ativo=TRUE"
    );
    expect(restantes.rows[0].n).toBeGreaterThanOrEqual(2);

    // Desativa todos menos um, depois tenta o último.
    await pool.query(
      "UPDATE usuario SET ativo = FALSE WHERE perfil='administrador' AND id NOT IN ($1,$2)",
      [admin.usuario.id, promovido.usuario.id]
    );
    await request(app)
      .patch(`/usuarios/${promovido.usuario.id}`)
      .set(comoAdmin())
      .send({ ativo: false });

    const resp = await request(app)
      .patch(`/usuarios/${admin.usuario.id}`)
      .set('Authorization', `Bearer ${promovido.token}`)
      .send({ ativo: false });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('ULTIMO_ADMINISTRADOR');
  });

  it('gestor não altera usuários', async () => {
    const resp = await request(app)
      .patch(`/usuarios/${solicitante.usuario.id}`)
      .set('Authorization', `Bearer ${gestor.token}`)
      .send({ perfil: 'tecnico' });

    expect(resp.status).toBe(403);
  });
});

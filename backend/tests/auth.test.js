const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

const { ipDaSuite } = require('./apoio/ip');

// Ver tests/apoio/ip.js: cada suíte se apresenta ao login como um cliente
// distinto, para não dividir a cota por IP com as suítes que rodam em paralelo.
const IP = ipDaSuite(__filename);

afterAll(async () => {
  await pool.end();
});

describe('POST /auth/registrar', () => {
  const email = `teste_${Date.now()}@exemplo.com`;

  it('cria um usuário com perfil solicitante mesmo se outro perfil for enviado', async () => {
    const resposta = await request(app)
      .post('/auth/registrar')
      .send({ nome: 'Usuário Teste', email, senha: 'senha-teste-123', perfil: 'administrador' });

    expect(resposta.status).toBe(202);
    const { rows } = await pool.query('SELECT perfil FROM usuario WHERE email = $1', [email]);
    expect(rows[0].perfil).toBe('solicitante');
  });

  it('e-mail repetido não cria outra conta (a resposta é a do cadastro novo: ver cadastroSeguro.test.js)', async () => {
    const resposta = await request(app)
      .post('/auth/registrar')
      .send({ nome: 'Usuário Teste', email, senha: 'senha-teste-123' });

    expect(resposta.status).toBe(202);
    const { rows } = await pool.query('SELECT 1 FROM usuario WHERE email = $1', [email]);
    expect(rows).toHaveLength(1);
  });

  it('valida campos obrigatórios', async () => {
    const resposta = await request(app).post('/auth/registrar').send({ email: 'invalido' });
    expect(resposta.status).toBe(422);
  });
});

describe('POST /auth/login', () => {
  const email = `login_${Date.now()}@exemplo.com`;

  beforeAll(async () => {
    await request(app).post('/auth/registrar').send({ nome: 'Login Teste', email, senha: 'senha-teste-123' });
  });

  it('autentica com credenciais corretas e retorna token', async () => {
    const resposta = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha-teste-123' });
    expect(resposta.status).toBe(200);
    expect(resposta.body.token).toBeDefined();
    expect(resposta.body.usuario.email).toBe(email);
  });

  it('rejeita senha incorreta', async () => {
    const resposta = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'errada' });
    expect(resposta.status).toBe(401);
  });
});

describe('Rotas protegidas', () => {
  it('rejeita acesso sem token', async () => {
    const resposta = await request(app).get('/chamados');
    expect(resposta.status).toBe(401);
  });
});

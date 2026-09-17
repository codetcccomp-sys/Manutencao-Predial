const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

afterAll(async () => {
  await pool.end();
});

describe('E-mail insensível a maiúsculas', () => {
  const base = `Caixa_${Date.now()}@Exemplo.com`;

  it('guarda o e-mail em minúsculas mesmo quando enviado com maiúsculas', async () => {
    const resp = await request(app)
      .post('/auth/registrar')
      .send({ nome: 'Teste Caixa', email: base, senha: 'senha123' });

    expect(resp.status).toBe(201);
    expect(resp.body.usuario.email).toBe(base.toLowerCase());
  });

  it('autentica com qualquer combinação de maiúsculas', async () => {
    for (const variacao of [base, base.toLowerCase(), base.toUpperCase()]) {
      const resp = await request(app).post('/auth/login').send({ email: variacao, senha: 'senha123' });
      expect(resp.status).toBe(200);
      expect(resp.body.usuario.email).toBe(base.toLowerCase());
    }
  });

  it('impede uma segunda conta que só difere pela caixa', async () => {
    const resp = await request(app)
      .post('/auth/registrar')
      .send({ nome: 'Clone', email: base.toUpperCase(), senha: 'senha123' });

    expect(resp.status).toBe(409);
    expect(resp.body.erro.codigo).toBe('EMAIL_EM_USO');
  });

  it('ignora espaços em volta do e-mail', async () => {
    const resp = await request(app)
      .post('/auth/login')
      .send({ email: `  ${base}  `, senha: 'senha123' });

    expect(resp.status).toBe(200);
  });

  it('o banco recusa e-mail com maiúsculas mesmo por escrita direta', async () => {
    // A garantia não pode depender de o código lembrar de normalizar:
    // correções manuais por SQL acontecem.
    await expect(
      pool.query("INSERT INTO usuario (nome, email, senha_hash, perfil) VALUES ('X', 'MAIUSCULO@teste.com', 'x', 'solicitante')")
    ).rejects.toThrow(/usuario_email_minusculo/);
  });
});

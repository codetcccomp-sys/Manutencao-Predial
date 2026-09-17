const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

afterAll(async () => {
  await pool.end();
});

describe('GET /health/db', () => {
  it('lê uma tabela de verdade, não apenas o relógio do banco', async () => {
    const resp = await request(app).get('/health/db');

    expect(resp.status).toBe(200);
    expect(resp.body.banco).toBe('conectado');
    // Conexão aberta não é o mesmo que acesso concedido: a contagem só vem
    // se o papel da aplicação realmente puder ler a tabela.
    expect(resp.body.categorias).toBeGreaterThan(0);
  });
});

describe('GET /health', () => {
  it('responde sem tocar no banco', async () => {
    const resp = await request(app).get('/health');
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe('ok');
  });
});

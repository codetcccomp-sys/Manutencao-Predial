const request = require('supertest');
const pool = require('../src/config/db');
const app = require('../src/app');

afterAll(async () => {
  await pool.end();
});

describe('Cabeçalhos de segurança da API', () => {
  it('não deixa o navegador adivinhar o tipo do conteúdo', async () => {
    const resp = await request(app).get('/health');
    expect(resp.headers['x-content-type-options']).toBe('nosniff');
  });

  it('proíbe embutir a API em quadro de outro site', async () => {
    const resp = await request(app).get('/health');
    expect(resp.headers['content-security-policy']).toMatch(/frame-ancestors 'self'/);
    expect(resp.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('exige HTTPS nas próximas visitas', async () => {
    const resp = await request(app).get('/health');
    expect(resp.headers['strict-transport-security']).toMatch(/max-age=\d+/);
  });

  it('não anuncia o framework', async () => {
    const resp = await request(app).get('/health');
    expect(resp.headers['x-powered-by']).toBeUndefined();
  });

  it('vale também na resposta de erro, e a recusa de origem continua sendo 403', async () => {
    const resp = await request(app).get('/health').set('Origin', 'https://site-qualquer.example');
    expect(resp.status).toBe(403);
    expect(resp.body.erro.codigo).toBe('ORIGEM_NAO_PERMITIDA');
    expect(resp.headers['x-content-type-options']).toBe('nosniff');
  });

  it('não atrapalha o CORS de uma origem permitida', async () => {
    const resp = await request(app)
      .options('/auth/login')
      .set('Origin', 'https://conserva-predial.vercel.app')
      .set('Access-Control-Request-Method', 'POST');
    expect(resp.status).toBeLessThan(300);
    expect(resp.headers['access-control-allow-origin']).toBe('https://conserva-predial.vercel.app');
  });
});

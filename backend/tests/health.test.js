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

  describe('marca de demonstração (database/guarda-demonstracao.js)', () => {
    const MARCA = 'ambiente_demonstracao';

    afterEach(async () => {
      await pool.query('DELETE FROM configuracao WHERE chave = $1', [MARCA]);
    });

    it('sem a marca no banco, não se diz demonstração', async () => {
      const resp = await request(app).get('/health/db');

      expect(resp.body.demonstracao).toBe(false);
    });

    it('a resposta vem da linha do banco, e só o valor verdadeiro conta', async () => {
      await pool.query(`INSERT INTO configuracao (chave, valor) VALUES ($1, 'false'::jsonb)`, [MARCA]);
      expect((await request(app).get('/health/db')).body.demonstracao).toBe(false);

      await pool.query(`UPDATE configuracao SET valor = 'true'::jsonb WHERE chave = $1`, [MARCA]);
      expect((await request(app).get('/health/db')).body.demonstracao).toBe(true);
    });

    it('uma variável de ambiente não faz as vezes da marca', async () => {
      process.env.AMBIENTE = 'demonstracao';
      try {
        expect((await request(app).get('/health/db')).body.demonstracao).toBe(false);
      } finally {
        delete process.env.AMBIENTE;
      }
    });
  });

  it('com o banco fora, responde 503 sem contar o motivo a quem perguntou', async () => {
    const motivo =
      'password authentication failed for user "postgres.abcdef" at db.interno.supabase.co:6543';
    const consulta = jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error(motivo));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const resp = await request(app).get('/health/db');

      expect(resp.status).toBe(503);
      expect(resp.body).toEqual({ status: 'erro', banco: 'indisponivel' });
      expect(JSON.stringify(resp.body)).not.toContain('postgres.abcdef');
      // O motivo não some: vai para o log, onde quem opera o servidor procura.
      expect(log.mock.calls.flat().join(' ')).toContain(motivo);
    } finally {
      consulta.mockRestore();
      log.mockRestore();
    }
  });
});

describe('GET /health', () => {
  it('responde sem tocar no banco', async () => {
    const resp = await request(app).get('/health');
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe('ok');
  });
});

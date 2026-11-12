const http = require('http');
const app = require('../src/app');
const pool = require('../src/config/db');
const path = require('path');
const { apiDoSite, rotasMontadas, conferir } = require('../scripts/conferir-publicacao');

/**
 * A conferência pós-deploy (scripts/conferir-publicacao.js, workflow publicacao.yml) só serve se
 * acusar a API quebrada e deixar passar a que funciona. Aqui as duas coisas são provadas contra
 * servidores de verdade, numa porta local.
 */
const subir = (tratador) =>
  new Promise((resolve) => {
    const servidor = http.createServer(tratador).listen(0, '127.0.0.1', () => {
      resolve({ servidor, base: `http://127.0.0.1:${servidor.address().port}` });
    });
  });

const fechar = (servidor) => new Promise((resolve) => servidor.close(resolve));

// Como na produção: com o segredo do agendador definido, /tarefas sem credencial é 401. Sem ele
// a rota responde 503, e a conferência acusa de propósito (avisos e preventivas parados).
const segredoAnterior = process.env.CRON_SECRET;
beforeAll(() => {
  process.env.CRON_SECRET = 'segredo-de-teste-da-conferencia';
});

afterAll(async () => {
  if (segredoAnterior === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = segredoAnterior;
  await pool.end();
});

describe('Conferência pós-deploy', () => {
  it('confere a API que cada site de fato usa, lida do vercel.json dele', () => {
    const raiz = path.join(__dirname, '..', '..');

    expect(apiDoSite(path.join(raiz, 'frontend', 'vercel.json'))).toBe(
      'https://manutencao-predial-backend-delta.vercel.app'
    );
    expect(apiDoSite(path.join(raiz, 'demo', 'frontend', 'vercel.json'))).toBe(
      'https://conserva-predial-demo-api.vercel.app'
    );
  });

  it('lê de app.js todos os roteadores montados', () => {
    const rotas = rotasMontadas();

    expect(rotas).toEqual(expect.arrayContaining(['/auth', '/chamados', '/sla', '/telemetria']));
    expect(rotas.length).toBeGreaterThanOrEqual(18);
  });

  it('deixa passar a API que funciona', async () => {
    const { servidor, base } = await subir(app);
    try {
      expect(await conferir(base, 'producao')).toEqual([]);
    } finally {
      await fechar(servidor);
    }
  });

  it('acusa o roteador que responde 500, como na queda de 10/11/2026', async () => {
    const { servidor, base } = await subir((req, res) => {
      if (req.url.startsWith('/chamados')) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        return res.end('FUNCTION_INVOCATION_FAILED');
      }
      return app(req, res);
    });
    try {
      expect(await conferir(base, 'producao')).toEqual(['/chamados respondeu 500']);
    } finally {
      await fechar(servidor);
    }
  });

  it('acusa a API da produção ligada a um banco de demonstração', async () => {
    const { servidor, base } = await subir(app);
    try {
      const falhas = await conferir(base, 'demonstracao', []);

      expect(falhas).toEqual([expect.stringMatching(/demonstracao=false, mas esta API devia ser de demonstracao/)]);
    } finally {
      await fechar(servidor);
    }
  });

  it('acusa o agendador sem segredo, que deixa avisos e preventivas parados', async () => {
    delete process.env.CRON_SECRET;
    const { servidor, base } = await subir(app);
    try {
      expect(await conferir(base, 'producao', ['/tarefas'])).toEqual(['/tarefas respondeu 503']);
    } finally {
      process.env.CRON_SECRET = 'segredo-de-teste-da-conferencia';
      await fechar(servidor);
    }
  });

  it('acusa a API que não responde', async () => {
    const { servidor, base } = await subir(app);
    await fechar(servidor);

    const falhas = await conferir(base, 'producao', ['/auth']);

    expect(falhas).toHaveLength(3);
    expect(falhas[2]).toMatch(/^\/auth respondeu /);
  });
});

import { defineConfig, devices } from '@playwright/test';

const API = process.env.E2E_API ?? 'http://localhost:3333';
const APP = process.env.E2E_APP ?? 'http://localhost:4173';

/**
 * Ponta a ponta contra a build, não contra o servidor de desenvolvimento.
 *
 * É a build que vai para produção: testar o `vite dev` deixaria de fora tudo
 * que só aparece depois do empacotamento. O `preview` serve o mesmo `dist`
 * que o deploy publica, com o proxy de /api que o ambiente de produção faz por
 * rewrite.
 */
// Em ambientes que já trazem o Chromium instalado (o contêiner de
// desenvolvimento deste projeto, por exemplo), apontar para o executável
// existente evita baixar outro de 150 MB — e evita o erro de versão
// quando o binário pré-instalado não é o que esta versão do Playwright
// espera. No CI a variável não existe e vale o browser que o
// `playwright install` baixou. Fica nos projetos do Chromium, e não no `use`
// geral: o projeto do Firefox não pode herdar o executável de outro navegador.
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM
  ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM } }
  : {};

export default defineConfig({
  testDir: './e2e',
  // Uma tela de cada vez: as suítes compartilham o mesmo banco, e paralelizar
  // traria de volta exatamente as corridas que custaram caro no backend.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: APP,
    // Movimento reduzido por padrão. O Playwright espera o elemento parar de se
    // mover antes de clicar, então a entrada animada de cada tela somaria meio
    // segundo a cada navegação dos 59 testes — e o que as suítes de fluxo e de
    // layout verificam não depende de animação. As specs que testam o movimento
    // (animacao e seguranca) pedem `no-preference` por conta própria.
    reducedMotion: 'reduce',
    // Rastro só do que falhou: guardar tudo encheria o artefato do CI sem
    // ninguém abrir.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'computador',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, ...CHROMIUM },
    },
    {
      // A RNF02 pede interface responsiva para celular, e os defeitos de
      // layout que apareceram neste projeto só existiam em tela estreita.
      name: 'celular',
      use: { ...devices['Pixel 5'], ...CHROMIUM },
    },
    // RNF06: o Termo pede Chrome, Edge e Firefox. Chrome e Edge são o mesmo motor
    // (Chromium), coberto pelos dois projetos acima; o Firefox é outro motor, e só
    // um navegador de verdade mostra o que muda nele.
    //
    // Só existe com E2E_FIREFOX=1 (o job próprio do CI): sem o Firefox instalado, o
    // projeto falharia inteiro por falta do navegador, e uma falha dessas faria todo
    // teste de mutação de layout parecer "acusado" (testes/mutacao.mjs roda
    // `playwright test` sem escolher projeto). Só computador: o que muda no celular
    // é a largura, e a largura já é medida no Chromium.
    ...(process.env.E2E_FIREFOX
      ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 900 } } }]
      : []),
  ],

  webServer: [
    {
      command: 'node src/server.js',
      cwd: '../backend',
      url: `${API}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: '3333',
        // Cada teste fecha uma página e a telemetria manda o que juntou: todas saem do mesmo IP.
        TELEMETRIA_MAX_POR_MINUTO: '100000',
        NODE_ENV: 'test',
        JWT_SECRET: process.env.JWT_SECRET ?? 'segredo_de_teste_e2e',
        JWT_EXPIRES_IN: '1h',
        CRON_SECRET: process.env.CRON_SECRET ?? 'segredo_de_agendador_e2e',
        // O cenário cria dezenas de contas pelo mesmo endereço: o teto do cadastro público
        // (10 por IP por hora) é provado no jest, e aqui só atrapalharia.
        CADASTRO_MAX_POR_IP: '1000000',
        CADASTRO_MAX_POR_DIA: '1000000',
        DB_HOST: process.env.DB_HOST ?? 'localhost',
        DB_PORT: process.env.DB_PORT ?? '5432',
        DB_NAME: process.env.DB_NAME ?? 'smp',
        DB_USER: process.env.DB_USER ?? 'smp_user',
        DB_PASSWORD: process.env.DB_PASSWORD ?? 'smp_dev_pass',
      },
    },
    {
      command: 'npm run build && npm run preview -- --port 4173',
      url: APP,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

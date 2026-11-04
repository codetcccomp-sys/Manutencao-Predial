import { test, expect } from '@playwright/test';
import { montarCenario, entrar } from './apoio.js';

/**
 * A telemetria, vista por um navegador de verdade: o que sai do aparelho e o que o administrador lê.
 *
 * O que só o navegador prova é o que atravessa a rede: a tela vai pelo modelo da rota (nunca com o
 * número do chamado), "Não rastrear" corta o envio, o erro da tela chega sem endereço real e o
 * painel do administrador mostra o que foi medido.
 */

let cenario;
let chamado;

test.beforeAll(async () => {
  cenario = await montarCenario();
  chamado = await cenario.abrirChamado({ titulo: 'Chamado para a telemetria' });
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

// Quando a página é escondida, o aplicativo manda o que juntou. O evento é o mesmo que o navegador dispara.
const esconder = (page) => page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

function corpoDe(requisicao) {
  return JSON.parse(requisicao.postData());
}

test('manda as aberturas de tela pelo modelo da rota, e nunca pelo endereço real', async ({ page }) => {
  await entrar(page, cenario.pessoas.gestor);
  await page.goto(`/chamados/${chamado.id}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  const [requisicao] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith('/api/telemetria') && r.method() === 'POST'),
    esconder(page),
  ]);

  const corpo = corpoDe(requisicao);
  expect(corpo.telas['/chamados/:id']).toBeGreaterThanOrEqual(1);
  expect(JSON.stringify(corpo)).not.toContain(String(chamado.id));
  expect(requisicao.headers()['x-conserva']).toBe('1');
  // Nada de identidade no envio: o corpo só tem contagens e medidas.
  expect(Object.keys(corpo).sort()).toEqual(['acoes', 'desempenho', 'telas']);
});

test('quem liga "Não rastrear" não é medido', async ({ browser }) => {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  await page.addInitScript(() => Object.defineProperty(navigator, 'doNotTrack', { value: '1' }));
  const enviadas = [];
  page.on('request', (r) => r.url().endsWith('/api/telemetria') && enviadas.push(r));

  await entrar(page, cenario.pessoas.solicitante);
  await page.goto('/conta');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await esconder(page);
  await page.waitForTimeout(500);

  expect(enviadas).toHaveLength(0);
  await contexto.close();
});

test('um erro de tela chega à administração com a tela pelo modelo da rota', async ({ page }) => {
  await entrar(page, cenario.pessoas.gestor);
  await page.goto(`/chamados/${chamado.id}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  const [requisicao] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith('/api/telemetria/erro') && r.method() === 'POST'),
    // Um erro que ninguém captura, como o de um defeito de verdade.
    page.evaluate(() => setTimeout(() => { throw new Error('falha de teste da telemetria para ana@exemplo.com'); }, 0)),
  ]);

  const corpo = corpoDe(requisicao);
  expect(corpo.tela).toBe('/chamados/:id');
  expect(corpo.mensagem).toContain('falha de teste da telemetria');
  expect(JSON.stringify(corpo)).not.toContain(String(chamado.id));
});

test('o administrador lê o que foi medido no painel de uso e desempenho', async ({ page }) => {
  // Gera medida: abre telas e deixa o aplicativo enviar.
  await entrar(page, cenario.pessoas.gestor);
  await page.goto('/relatorios');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/telemetria')), esconder(page)]);

  await entrar(page, cenario.pessoas.administrador);
  await page.goto('/usuarios');
  await page.getByText('Ver o uso dos últimos dias').click();

  const tabela = page.getByRole('table', { name: 'Uso e desempenho de cada tela' });
  await expect(tabela).toBeVisible();
  await expect(tabela.getByRole('row', { name: /Relatórios/ })).toBeVisible();
  await expect(page.getByText(/Quem liga “Não rastrear” no navegador não entra na contagem/)).toBeVisible();
});

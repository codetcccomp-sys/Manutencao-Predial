import { test, expect } from '@playwright/test';
import { montarCenario, entrar } from './apoio.js';

/**
 * As telas da gestão carregam sob demanda (React.lazy em App.jsx e Inicio.jsx).
 *
 * Três coisas a provar no navegador, contra a build que vai ao ar:
 *
 * 1. Quem executa não baixa o código da gestão. Sozinha, essa prova passaria
 *    também se o pedaço nem existisse (se alguém voltasse a importar a tela de
 *    forma estática, o arquivo some do pacote e "não baixou" continua
 *    verdadeiro). Por isso o teste da gestão é o par dela: ele exige que o
 *    pedaço seja pedido quando a tela abre.
 * 2. A gestão baixa cada tela quando a abre, e não antes.
 * 3. Se o pedaço não chega (o sistema foi atualizado, ou a rede caiu), a tela
 *    diz isso, e recarregar resolve.
 *
 * Sem service worker: o que se mede é o que a página pede à rede, e a rota
 * interceptada do terceiro teste não atravessa um service worker.
 */

test.use({ serviceWorkers: 'block' });

const PEDACOS_DA_GESTAO = /\/assets\/(Relatorios|Usuarios|Cadastros|Preventiva|Etiquetas|Dashboard)-[\w-]+\.js/;

let cenario;

test.beforeAll(async () => {
  cenario = await montarCenario();
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

function pedacosBaixados(page) {
  const baixados = [];
  page.on('request', (pedido) => {
    const achado = PEDACOS_DA_GESTAO.exec(pedido.url());
    if (achado) baixados.push(achado[1]);
  });
  return baixados;
}

test('quem executa não baixa o código das telas da gestão', async ({ page }) => {
  const baixados = pedacosBaixados(page);
  const titulo = `Lâmpada queimada ${cenario.marca}`;
  const chamado = await cenario.abrirChamado({ titulo });
  await cenario.atribuir(chamado.id);

  await entrar(page, cenario.pessoas.tecnico);
  await expect(page.getByRole('heading', { level: 1, name: 'Minha fila' })).toBeVisible();
  await page.goto(`/chamados/${chamado.id}`);
  await expect(page.getByRole('heading', { name: titulo })).toBeVisible();
  await page.waitForLoadState('networkidle');

  expect(baixados).toEqual([]);
});

test('a gestão baixa o painel ao entrar e cada tela só quando a abre', async ({ page }) => {
  const baixados = pedacosBaixados(page);

  await entrar(page, cenario.pessoas.gestor);
  await expect(page.getByRole('heading', { level: 1, name: 'Chamados', exact: true })).toBeVisible();
  expect(baixados).toContain('Dashboard');
  expect(baixados).not.toContain('Relatorios');

  await page.getByRole('link', { name: 'Relatórios' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Relatórios' })).toBeVisible();
  expect(baixados).toContain('Relatorios');
});

test('se o pedaço da tela não chega, a tela explica e recarregar resolve', async ({ page }) => {
  await entrar(page, cenario.pessoas.gestor);

  const pedacoDeRelatorios = /\/assets\/Relatorios-[\w-]+\.js/;
  await page.route(pedacoDeRelatorios, (rota) => rota.abort());
  await page.getByRole('link', { name: 'Relatórios' }).click();

  const aviso = page.getByRole('alert').filter({ hasText: 'Não foi possível abrir esta tela' });
  await expect(aviso).toBeVisible();

  // O arquivo volta a existir (o equivalente a abrir a versão nova): recarregar
  // a página inteira, e não só tentar de novo, é o que traz a tela.
  await page.unroute(pedacoDeRelatorios);
  await page.getByRole('button', { name: 'Recarregar a página' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Relatórios' })).toBeVisible();
});

import { test, expect } from '@playwright/test';
import { montarCenario, entrar } from './apoio.js';

/**
 * Login com Google e ativação das duas etapas, vistos por um navegador de
 * verdade.
 *
 * O jsdom não mede layout nem avalia `@media (pointer: coarse)`: o botão do
 * Google esticando o formulário depois de o celular girar, e o link que só
 * aparece em tela de toque, só aparecem aqui.
 *
 * O Google de verdade não é chamado (o teste não pode depender da rede dele).
 * O script é trocado por um que desenha um botão de largura fixa, como o
 * iframe do Google faz — e o desenha por CSSOM, porque a CSP do app não tem
 * 'unsafe-inline' e atributo `style` escrito como texto seria bloqueado.
 */

const GOOGLE_FALSO = `
window.google = { accounts: { id: {
  initialize(opcoes) { window.__google = opcoes; },
  renderButton(lugar, opcoes) {
    const botao = document.createElement('div');
    botao.setAttribute('role', 'button');
    botao.tabIndex = 0;
    botao.textContent = 'Fazer login com o Google';
    botao.style.boxSizing = 'border-box';
    botao.style.width = Math.min(opcoes.width || 300, 400) + 'px';
    botao.style.height = '40px';
    botao.style.border = '1px solid #dadce0';
    lugar.appendChild(botao);
  },
} } };`;

async function simularGoogle(page) {
  await page.route('https://accounts.google.com/gsi/client', (rota) =>
    rota.fulfill({ contentType: 'text/javascript', body: GOOGLE_FALSO })
  );
  await page.route('**/api/auth/google', (rota) =>
    rota.request().method() === 'GET'
      ? rota.fulfill({ json: { client_id: 'e2e.apps.googleusercontent.com' } })
      : rota.continue()
  );
}

test('girar o celular com o botão do Google não faz o formulário vazar do cartão', async ({ page }) => {
  await simularGoogle(page);

  // Abre deitado: o botão nasce largo (até 400 px).
  await page.setViewportSize({ width: 700, height: 400 });
  await page.goto('/login');
  await expect(page.getByText('Fazer login com o Google')).toBeVisible();

  // Gira para ficar em pé. Antes do conserto, o botão seguia com a largura de
  // antes, a coluna do formulário esticava junto, e campos e "Entrar" passavam
  // do cartão e da tela (WCAG 1.4.10).
  await page.setViewportSize({ width: 320, height: 640 });

  const medir = () =>
    page.evaluate(() => {
      const direita = (el) => Math.round(el.getBoundingClientRect().right);
      const cartao = document.querySelector('form');
      const entrar = [...cartao.querySelectorAll('button')].find((b) => b.innerText.includes('Entrar'));
      return {
        janela: window.innerWidth,
        cartao: direita(cartao),
        campo: direita(cartao.querySelector('input')),
        entrar: direita(entrar),
        google: direita(document.querySelector('[data-testid=botao-google] > div')),
      };
    });

  // O redesenho do botão espera a medida assentar: confere até estabilizar.
  await expect.poll(async () => (await medir()).google).toBeLessThanOrEqual((await medir()).cartao);

  const m = await medir();
  expect(m.janela, 'a janela não alarga para caber o conteúdo').toBe(320);
  expect(m.campo, 'campo dentro do cartão').toBeLessThanOrEqual(m.cartao);
  expect(m.entrar, 'botão Entrar dentro do cartão').toBeLessThanOrEqual(m.cartao);
  expect(m.google, 'botão do Google dentro do cartão').toBeLessThanOrEqual(m.cartao);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test.describe('ativação das duas etapas', () => {
  let cenario;

  test.beforeAll(async () => {
    cenario = await montarCenario({ perfis: ['gestor'] });
  });

  test.afterAll(async () => {
    await cenario?.encerrar();
  });

  test('o foco vai ao começo dos passos, e o atalho para o aplicativo só aparece em tela de toque', async (
    { page },
    info
  ) => {
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/conta');

    await page.getByRole('button', { name: 'Ligar a verificação em duas etapas' }).click();

    // O botão clicado sumiu: sem cuidado, o foco ia para o corpo da página e
    // quem usa teclado recomeçava do cabeçalho.
    await expect(page.getByRole('form', { name: /Passos para ligar/ })).toBeFocused();

    // Num celular o QR Code da própria tela não se lê: o atalho para o
    // aplicativo é o caminho. No computador ele não leva a lugar nenhum.
    // Procurado pelo endereço, e não pelo papel: no computador ele existe e
    // está escondido, e a busca por papel não enxerga o que está escondido.
    const atalho = page.locator('a[href^="otpauth://totp/"]');
    await expect(atalho).toHaveCount(1);
    await expect(atalho).toHaveText('Abrir no aplicativo autenticador');
    if (info.project.name === 'celular') await expect(atalho).toBeVisible();
    else await expect(atalho).toBeHidden();

    // A chave sai em grupos de 4, e há botão para copiá-la.
    await expect(page.getByText(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copiar chave' })).toBeVisible();

    // Cancelar devolve o foco ao botão de origem.
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('button', { name: 'Ligar a verificação em duas etapas' })).toBeFocused();
  });
});

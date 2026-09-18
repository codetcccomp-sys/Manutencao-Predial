import { test, expect } from '@playwright/test';
import { montarCenario, entrar, conferirQueCabeNaTela } from './apoio.js';

/**
 * Layout: a camada que só um navegador de verdade mede.
 *
 * Todos os defeitos de responsividade deste projeto — o cartão de chamado
 * esticando a página, as tabelas vazando do cartão, o painel de avisos saindo
 * pela esquerda no celular — passaram por build verde e por teste de
 * componente. jsdom devolve zero em getBoundingClientRect: geometria só
 * existe aqui.
 */

let cenario;
let chamado;

test.beforeAll(async () => {
  cenario = await montarCenario();
  chamado = await cenario.abrirChamado({
    titulo:
      'Infiltração persistente na laje do subsolo junto ao quadro elétrico principal do bloco',
  });
  await cenario.atribuir(chamado.id);
  await cenario.pessoas.solicitante.post(`/chamados/${chamado.id}/comentarios`, {
    texto: 'Comentário com texto suficientemente longo para ocupar algumas linhas na tela.',
  });
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

const TELAS = [
  { rota: '/', espera: 'h2', quem: 'gestor' },
  { rota: '/chamados/novo', espera: 'form', quem: 'solicitante' },
  { rota: '/relatorios', espera: 'h3:has-text("Por local")', quem: 'gestor' },
  { rota: '/cadastros', espera: 'h3:has-text("Cadastrar local")', quem: 'gestor' },
  { rota: '/usuarios', espera: 'h2', quem: 'administrador' },
];

for (const { rota, espera, quem } of TELAS) {
  test(`${rota} cabe na tela`, async ({ page }) => {
    await entrar(page, cenario.pessoas[quem] ?? cenario.pessoas.administrador);
    await page.goto(rota);
    await page.waitForSelector(espera);
    await conferirQueCabeNaTela(page, expect);
  });
}

test('o detalhe do chamado cabe na tela', async ({ page }) => {
  await entrar(page, cenario.pessoas.gestor);
  await page.goto(`/chamados/${chamado.id}`);
  await page.waitForSelector('h3:has-text("Comentários")');
  await conferirQueCabeNaTela(page, expect);
});

test('um título longo é cortado em vez de esticar a página', async ({ page }) => {
  await entrar(page, cenario.pessoas.solicitante);
  await page.goto('/');
  await page.waitForSelector('a[href^="/chamados/"]');

  // O cartão é item de grid, e item de grid não encolhe abaixo do próprio
  // conteúdo por padrão: sem min-w-0, o título que o truncate deveria cortar
  // esticava a página inteira.
  await conferirQueCabeNaTela(page, expect);
});

test('o painel de avisos abre inteiro dentro da tela', async ({ page }) => {
  await entrar(page, cenario.pessoas.tecnico);

  const sino = page.getByRole('button', { name: /avisos/i });
  await sino.click();
  await page.waitForSelector('text=Avisos');

  const caixa = await page.locator('div:has(> div > span:text("Avisos"))').first().boundingBox();
  const largura = page.viewportSize().width;

  // Alinhado só pela direita do sino, o painel saía pela esquerda no celular
  // e o texto ficava cortado. Transbordo à esquerda não cria barra de
  // rolagem, então nada acusava.
  expect(caixa.x, 'o painel não pode começar fora da tela').toBeGreaterThanOrEqual(0);
  expect(caixa.x + caixa.width, 'o painel não pode terminar fora da tela').toBeLessThanOrEqual(
    largura + 1
  );
});

test('as tabelas de relatório rolam dentro do cartão, não levam a página', async ({ page }) => {
  await entrar(page, cenario.pessoas.gestor);
  await page.goto('/relatorios');
  await page.waitForSelector('h3:has-text("Carga por técnico")');

  await conferirQueCabeNaTela(page, expect);
});

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { montarCenario, entrar } from './apoio.js';

/**
 * Acessibilidade medida num navegador de verdade (WCAG 2.2 AA e boas práticas).
 *
 * Contraste, nome acessível e estrutura de cabeçalhos passam por build verde e por
 * teste de componente: o jsdom não calcula cor nem geometria. Foi o axe que achou o
 * "(opcional)" com 2,5:1 de contraste e um link que só se distinguia do texto pela
 * cor, num sistema cujos tokens de cor já eram medidos um a um.
 *
 * O axe pega cerca de um terço dos problemas de WCAG. O que ele não alcança — leitor
 * de tela de verdade, ordem de leitura, o que um texto alternativo diz — continua
 * sendo revisão de gente (docs/matriz-de-testes.md, seção 14).
 *
 * Roda nos dois projetos (computador e celular): o menu e o painel de avisos mudam
 * de forma em tela estreita.
 */

const REGRAS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Texto curto de cada violação, para a falha dizer onde está sem abrir o relatório. */
async function violacoes(page) {
  // Espera as consultas da tela terminarem: o select de técnico, por exemplo, só
  // existe depois de a lista chegar, e um axe rápido demais o via só em um dos dois
  // projetos.
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withTags(REGRAS).analyze();
  return violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`
  );
}

let cenario;
let chamado;

test.beforeAll(async () => {
  cenario = await montarCenario();
  chamado = await cenario.abrirChamado({ titulo: 'Lâmpada queimada no corredor do bloco A' });
  await cenario.atribuir(chamado.id);
  await cenario.pessoas.solicitante.post(`/chamados/${chamado.id}/comentarios`, {
    texto: 'Já avisei a portaria, mas a lâmpada continua apagada.',
  });
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

const PUBLICAS = ['/login', '/cadastro', '/recuperar-senha', '/privacidade', '/termos', '/cookies', '/suporte', '/isto-nao-existe'];

for (const rota of PUBLICAS) {
  test(`${rota} não tem violação de acessibilidade`, async ({ page }) => {
    await page.goto(rota);
    await page.waitForSelector('h1');
    expect(await violacoes(page)).toEqual([]);
  });
}

const INTERNAS = [
  { rota: '/', espera: 'h1', quem: 'gestor' },
  { rota: '/chamados/novo', espera: 'form', quem: 'solicitante' },
  { rota: '/relatorios', espera: 'h2:has-text("Por local")', quem: 'gestor' },
  { rota: '/cadastros', espera: 'h2:has-text("Cadastrar local")', quem: 'gestor' },
  { rota: '/cadastros?aba=expediente', espera: 'h2:has-text("Feriados")', quem: 'gestor' },
  { rota: '/cadastros?aba=distribuicao', espera: 'h2:has-text("Nova regra")', quem: 'gestor' },
  { rota: '/preventiva', espera: 'h2:has-text("Novo plano")', quem: 'gestor' },
  { rota: '/etiquetas?tipo=locais', espera: 'svg[role="img"]', quem: 'gestor' },
  { rota: '/usuarios', espera: 'h1', quem: 'administrador' },
  { rota: '/conta', espera: 'h1', quem: 'gestor' },
];

for (const { rota, espera, quem } of INTERNAS) {
  test(`${rota} não tem violação de acessibilidade (${quem})`, async ({ page }) => {
    await entrar(page, cenario.pessoas[quem]);
    await page.goto(rota);
    await page.waitForSelector(espera);
    expect(await violacoes(page)).toEqual([]);
  });
}

test('o detalhe do chamado não tem violação de acessibilidade', async ({ page }) => {
  await entrar(page, cenario.pessoas.gestor);
  await page.goto(`/chamados/${chamado.id}`);
  await page.waitForSelector('h2:has-text("Comentários")');
  expect(await violacoes(page)).toEqual([]);
});

test('o painel com o aviso de espaço do banco não tem violação de acessibilidade', async ({ page }) => {
  // O banco de teste está longe dos 70%: a resposta é simulada para a faixa aparecer.
  await page.route('**/operacao/armazenamento', (rota) =>
    rota.fulfill({
      json: {
        banco_bytes: 380 * 1024 * 1024,
        limite_bytes: 500 * 1024 * 1024,
        percentual: 76,
        alerta: true,
        alerta_a_partir_de: 70,
        anexos_no_banco_bytes: 200 * 1024 * 1024,
        anexos_no_banco: 300,
        anexos_no_storage: 0,
        modo: 'banco',
      },
    })
  );
  await entrar(page, cenario.pessoas.gestor);
  await page.goto('/');
  await expect(page.getByText('O espaço do banco está acabando')).toBeVisible();
  expect(await violacoes(page)).toEqual([]);
});

test('o diálogo de confirmação aberto não tem violação de acessibilidade', async ({ page }) => {
  await entrar(page, cenario.pessoas.gestor);
  await page.goto(`/chamados/${chamado.id}`);
  await page.getByRole('button', { name: 'Cancelado' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await violacoes(page)).toEqual([]);
});

test('os erros do sistema, abertos na tela de usuários, não têm violação de acessibilidade', async ({ page }) => {
  await entrar(page, cenario.pessoas.administrador);
  await page.goto('/usuarios');
  await page.getByText('Ver os erros recentes').click();
  await expect(page.getByText(/nas últimas 24 horas/)).toBeVisible();
  expect(await violacoes(page)).toEqual([]);
});

test.describe('ao trocar de tela', () => {
  test('o título da aba acompanha a tela e o foco vai para o título da página', async ({ page }) => {
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/');
    await page.waitForSelector('h1');
    await expect(page).toHaveTitle('Início — Conserva Predial');

    // Navegação pelo próprio sistema (o link some da tela ao trocar de rota, e é aí
    // que o foco caía no body).
    await page.getByRole('link', { name: /relat[óo]rios/i }).first().click();
    await page.waitForURL('**/relatorios');

    await expect(page).toHaveTitle('Relatórios — Conserva Predial');
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  });

  test('o atalho "Pular para o conteúdo" leva o foco para dentro do conteúdo', async ({ page, isMobile }) => {
    test.skip(isMobile, 'o atalho é para teclado; no celular não há Tab');
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/chamados/novo');
    await page.waitForSelector('form');

    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Pular para o conteúdo' })).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');

    const dentroDoConteudo = await page.evaluate(() => Boolean(document.activeElement?.closest('main')));
    expect(dentroDoConteudo).toBe(true);
  });
});

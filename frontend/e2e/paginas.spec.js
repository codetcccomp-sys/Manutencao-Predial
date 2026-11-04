import { test, expect } from '@playwright/test';
import { montarCenario, entrar, conferirQueCabeNaTela, responderSituacao } from './apoio.js';

/**
 * As páginas de informação, o endereço inexistente e o que os buscadores veem,
 * vistos por um navegador de verdade.
 *
 * O que só o navegador mede: o cabeçalho que a Vercel (aqui, o preview) entrega,
 * o que a página grava no aparelho de quem a abre e se tudo cabe em tablet.
 */

let cenario;

test.beforeAll(async () => {
  cenario = await montarCenario();
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

const PUBLICAS = [
  { rota: '/termos', titulo: 'Termos de uso — Conserva Predial', h1: 'Termos de uso' },
  { rota: '/privacidade', titulo: 'Privacidade — Conserva Predial', h1: 'Aviso de privacidade' },
  { rota: '/cookies', titulo: 'Cookies e armazenamento — Conserva Predial', h1: 'Cookies e armazenamento' },
  { rota: '/suporte', titulo: 'Ajuda e suporte — Conserva Predial', h1: 'Ajuda e suporte' },
];

test.describe('metadados e indexação', () => {
  test('cada página pública tem título e descrição próprios', async ({ page }) => {
    const descricoes = new Set();
    for (const { rota, titulo, h1 } of PUBLICAS) {
      await page.goto(rota);
      await expect(page.getByRole('heading', { level: 1, name: h1 })).toBeVisible();
      await expect(page).toHaveTitle(titulo);
      const descricao = await page.locator('meta[name="description"]').getAttribute('content');
      expect(descricao.length, rota).toBeGreaterThan(30);
      descricoes.add(descricao);
    }
    expect(descricoes.size).toBe(PUBLICAS.length);
  });

  test('toda tela sai com noindex, no cabeçalho e no HTML', async ({ page }) => {
    const resposta = await page.goto('/login');

    expect(resposta.headers()['x-robots-tag']).toBe('noindex, nofollow');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  });

  test('o robots.txt é servido como texto e afasta os robôs das telas internas', async ({ request }) => {
    const resposta = await request.get('/robots.txt');

    expect(resposta.status()).toBe(200);
    expect(resposta.headers()['content-type']).toMatch(/text\/plain/);
    const corpo = await resposta.text();
    for (const regra of ['/api/', '/chamados/', '/relatorios', '/usuarios', '/cadastros', '/preventiva', '/conta']) {
      expect(corpo).toContain(`Disallow: ${regra}`);
    }
    expect(corpo).not.toMatch(/^Disallow:\s*\/\s*$/m);
  });
});

test.describe('endereço que não existe', () => {
  test('sem sessão, mostra a página própria e leva à tela de entrada', async ({ page }) => {
    await page.goto('/isto-nao-existe');

    await expect(page.getByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeVisible();
    await expect(page).toHaveTitle('Página não encontrada — Conserva Predial');
    // Um endereço inexistente não é mandado para o login: a pessoa vê o que aconteceu.
    expect(new URL(page.url()).pathname).toBe('/isto-nao-existe');

    await page.getByRole('link', { name: 'Ir para a tela de entrada' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('com sessão, o caminho de volta é o início do sistema', async ({ page }) => {
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/chamados/abc/impressao-que-nao-existe');

    await expect(page.getByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeVisible();
    await page.getByRole('link', { name: 'Ir para o início' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  });
});

test.describe('o que fica no aparelho', () => {
  test('antes de entrar não há cookie algum, e depois só o da sessão, HttpOnly', async ({ page, context }) => {
    await page.goto('/login');
    await page.goto('/cookies');
    expect(await context.cookies()).toEqual([]);

    await entrar(page, cenario.pessoas.solicitante);

    const cookies = await context.cookies();
    expect(cookies.map((c) => c.name)).toEqual(['conserva_sessao']);
    expect(cookies[0].httpOnly).toBe(true);
    // O armazenamento local guarda só a chave que a página de cookies declara.
    const chaves = await page.evaluate(() => Object.keys(localStorage));
    expect(chaves).toEqual(['smp_usuario']);
  });

  test('o controle da página de cookies confirma o que apagou', async ({ page }) => {
    await page.goto('/cookies');

    await page.getByRole('button', { name: 'Apagar as consultas guardadas neste aparelho' }).click();

    await expect(page.getByText(/foram apagadas/)).toBeVisible();
  });
});

test.describe('ações à vista', () => {
  test('"Novo chamado" está no cabeçalho de qualquer tela e a abertura confirma com o protocolo', async ({ page }) => {
    await entrar(page, cenario.pessoas.solicitante);
    await page.goto('/conta');

    await page.getByRole('link', { name: '+ Novo chamado' }).click();
    await expect(page).toHaveURL(/\/chamados\/novo$/);
    // No próprio formulário, o botão do cabeçalho não se repete.
    await expect(page.getByRole('link', { name: '+ Novo chamado' })).toHaveCount(0);

    await page.getByLabel('Título').fill(`Confirmação de abertura ${cenario.marca}`);
    await page.getByLabel('Descrição').fill('Teste da mensagem que confirma a abertura do chamado.');
    await page.getByLabel('Categoria').selectOption({ index: 1 });
    await page.getByLabel('Local').selectOption({ label: `Unidade E2E ${cenario.marca} / A` });
    await responderSituacao(page);
    await page.getByRole('button', { name: 'Abrir chamado' }).click();

    await page.waitForURL(/\/chamados\/\d+$/);
    await expect(page.getByRole('status').filter({ hasText: /Chamado aberto\. O protocolo é SMP-/ })).toBeVisible();
    // A confirmação não volta ao recarregar a página.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByText(/Chamado aberto\. O protocolo é/)).toHaveCount(0);

    await expect(page.getByRole('link', { name: /Voltar à lista de chamados/ })).toBeVisible();
  });

  test('o técnico não vê "Novo chamado": a API recusa a abertura para ele', async ({ page }) => {
    await entrar(page, cenario.pessoas.tecnico);
    await page.goto('/conta');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: '+ Novo chamado' })).toHaveCount(0);
  });
});

test.describe('tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  for (const rota of ['/login', '/cadastro', '/termos', '/privacidade', '/cookies', '/suporte', '/isto-nao-existe']) {
    test(`${rota} cabe numa tela de tablet`, async ({ page }) => {
      await page.goto(rota);
      await expect(page.locator('h1').first()).toBeVisible();
      await conferirQueCabeNaTela(page, expect);
    });
  }

  for (const rota of ['/', '/chamados/novo', '/conta']) {
    test(`${rota} cabe numa tela de tablet, com o cabeçalho e o rodapé`, async ({ page }) => {
      await entrar(page, cenario.pessoas.gestor);
      await page.goto(rota);
      await expect(page.locator('h1').first()).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Informações do sistema' })).toBeVisible();
      await conferirQueCabeNaTela(page, expect);
    });
  }
});

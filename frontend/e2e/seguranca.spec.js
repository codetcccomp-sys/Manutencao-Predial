import { test, expect } from '@playwright/test';
import { montarCenario, entrar } from './apoio.js';

/**
 * Cabeçalhos de segurança, vistos por um navegador de verdade.
 *
 * A CSP do vercel.json bloqueia script de fora, estilo de fora e conexão para
 * outro site. Uma política que quebra a interface é pior que nenhuma, e só um
 * navegador acusa isso: o jsdom ignora CSP. Este teste percorre as telas com a
 * política em vigor (o preview serve os mesmos cabeçalhos da produção) e falha
 * se o navegador relatar QUALQUER violação.
 */

// Com animação ligada: é o GSAP escrevendo estilo (opacity, filter, transform) que
// a CSP sem 'unsafe-inline' precisa deixar passar, e só o movimento real prova isso.
test.use({ reducedMotion: 'no-preference' });

let cenario;
let chamado;

test.beforeAll(async () => {
  cenario = await montarCenario();
  chamado = await cenario.abrirChamado();
  await cenario.atribuir(chamado.id);
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

test('a página sai com os cabeçalhos de segurança', async ({ page }) => {
  const resposta = await page.goto('/login');
  const h = resposta.headers();

  expect(h['content-security-policy']).toContain("default-src 'self'");
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['permissions-policy']).toContain('camera=()');
  // Sistema de uso interno: nenhuma tela entra em índice de busca (o robots.txt só orienta).
  expect(h['x-robots-tag']).toBe('noindex, nofollow');
});

test('com a CSP em vigor, as telas funcionam e o navegador não relata violação', async ({ page }) => {
  const violacoes = [];
  const erros = [];

  // `securitypolicyviolation` dispara no documento sempre que a política
  // bloqueia algo; instalar antes de qualquer script da página garante pegar
  // também o que acontece no carregamento.
  await page.addInitScript(() => {
    window.__violacoes = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__violacoes.push(`${e.violatedDirective} → ${e.blockedURI || 'inline'}`)
    );
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /content security policy/i.test(msg.text())) erros.push(msg.text());
  });

  await entrar(page, cenario.pessoas.gestor);
  await expect(page.locator('h1')).toBeVisible();

  for (const rota of ['/', `/chamados/${chamado.id}`, '/relatorios', '/cadastros', '/preventiva', '/etiquetas?tipo=locais']) {
    await page.goto(rota);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1, h2').first()).toBeVisible();
    violacoes.push(...(await page.evaluate(() => window.__violacoes)));
  }

  // O painel de avisos posiciona-se com `style={...}`, e a CSP não tem
  // 'unsafe-inline' para estilo: o React aplica estilo pelo CSSOM, que a
  // política não bloqueia. Abrir o painel prova isso em vez de supor.
  await page.goto('/');
  await page.getByRole('button', { name: /^Avisos/ }).click();
  const painel = page.locator('div.fixed.z-20').filter({ hasText: 'Avisos' });
  await expect(painel).toBeVisible();
  // O estilo foi aplicado mesmo assim: sem isso o painel abriria em (0,0).
  expect(await painel.evaluate((el) => el.style.length)).toBeGreaterThan(0);
  violacoes.push(...(await page.evaluate(() => window.__violacoes)));

  // O painel de resumo vive num portal no body, com fundo desfocado
  // (backdrop-filter) e animação de entrada: é mais uma superfície em que uma
  // política estrita poderia bloquear algo sem ninguém perceber.
  await page.goto('/');
  await page.getByRole('button', { name: /ver resumo:/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir chamado completo' })).toBeVisible();
  violacoes.push(...(await page.evaluate(() => window.__violacoes)));

  expect(violacoes, `violações de CSP: ${JSON.stringify(violacoes)}`).toEqual([]);
  expect(erros).toEqual([]);
});

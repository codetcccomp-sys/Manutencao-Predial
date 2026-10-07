import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { montarCenario, entrar } from './apoio.js';

/**
 * A sessão vista por um navegador de verdade: cookie HttpOnly, a trava de
 * CSRF passando pelo proxy, a verificação em duas etapas e o "sair de todos".
 *
 * O jsdom não tem cookie HttpOnly nem SameSite; só aqui dá para ver que a tela
 * funciona sem tocar no token e que o script da página não o enxerga.
 */

let cenario;

test.beforeAll(async () => {
  cenario = await montarCenario({ perfis: ['gestor', 'solicitante'] });
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

// Gerador próprio, e não o do backend: o teste não pode herdar um defeito do
// código que está conferindo. O backend confere o dele contra os vetores do RFC.
function codigoTotp(segredo, instanteMs = Date.now()) {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of segredo) bits += alfabeto.indexOf(c).toString(2).padStart(5, '0');
  const chave = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(instanteMs / 30_000)));
  const hmac = createHmac('sha1', chave).update(contador).digest();
  const d = hmac[19] & 0x0f;
  return String((hmac.readUInt32BE(d) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

test('a sessão fica num cookie que o script da página não lê', async ({ page }) => {
  await entrar(page, cenario.pessoas.solicitante);

  const cookie = (await page.context().cookies()).find((c) => c.name === 'conserva_sessao');
  expect(cookie).toBeTruthy();
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe('Strict');

  const visivel = await page.evaluate(() => ({
    cookies: document.cookie,
    armazenado: JSON.stringify({ ...localStorage, ...sessionStorage }),
  }));
  expect(visivel.cookies).not.toContain('conserva_sessao');
  expect(visivel.armazenado).not.toContain(cookie.value);

  // E a API atende por ele, sem token em lugar nenhum da página.
  expect((await page.request.get('/api/chamados')).status()).toBe(200);
});

test('escrita só com o cookie, sem o cabeçalho da tela, é recusada', async ({ page }) => {
  await entrar(page, cenario.pessoas.solicitante);

  const status = await page.evaluate(async () => {
    const r = await fetch('/api/chamados', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo: 'Sem cabeçalho', descricao: 'Montada fora da tela.' }),
    });
    return r.status;
  });
  expect(status).toBe(403);
});

test('com duas etapas ligadas, entra com senha e código; "sair de todos" derruba o cookie antigo', async ({
  page,
}) => {
  const gestor = cenario.pessoas.gestor;
  const { segredo } = (await gestor.post('/auth/2fa/iniciar')).corpo;
  const ativacao = await gestor.post('/auth/2fa/ativar', { senha: gestor.senha, codigo: codigoTotp(segredo) });
  expect(ativacao.status).toBe(200);
  gestor.token = ativacao.corpo.token;

  await page.goto('/login');
  await page.getByLabel('E-mail').fill(gestor.usuario.email);
  await page.getByLabel('Senha').fill(gestor.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();

  // O código da ativação já foi usado e não vale de novo; o do passo seguinte
  // está dentro da tolerância de relógio que o servidor aceita.
  await page.getByLabel('Código').fill(codigoTotp(segredo, Date.now() + 30_000));
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.waitForURL('**/');

  const antigo = (await page.context().cookies()).find((c) => c.name === 'conserva_sessao');
  expect((await page.request.get('/api/chamados')).status()).toBe(200);

  await page.goto('/conta');
  await expect(page.getByText('Ligada', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sair de todos os aparelhos' }).click();
  await page.waitForURL('**/login');

  // Quem tivesse copiado o cookie antes não entra mais com ele.
  await page.context().addCookies([antigo]);
  expect((await page.request.get('/api/chamados')).status()).toBe(401);
});

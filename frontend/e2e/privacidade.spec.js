import { test, expect } from '@playwright/test';

/**
 * O aviso de privacidade, visto por um navegador de verdade.
 *
 * Não precisa de cenário nem de login: é público de propósito, porque o aviso
 * tem de estar ao alcance de quem ainda vai se cadastrar. O que só o navegador
 * mostra é o que está aqui: a página abrir sem ser jogada para o login, os
 * links abrirem em outra aba sem apagar o formulário, e nada vazar da tela.
 */

const titulo = (pagina) => pagina.getByRole('heading', { level: 1, name: 'Aviso de privacidade' });

test('abre sem login e cabe na tela', async ({ page }) => {
  await page.goto('/privacidade');

  await expect(page).toHaveURL(/\/privacidade$/);
  await expect(titulo(page)).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();

  // WCAG 1.4.10: nada empurra a página para o lado, nem no celular.
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(sobra).toBeLessThanOrEqual(0);

  // WCAG 2.5.8: link solto tem ao menos 24 x 24 px.
  for (const nome of ['Entrar', 'Criar conta']) {
    const caixa = await page.getByRole('link', { name: nome }).boundingBox();
    expect(caixa.height, `"${nome}" abaixo de 24px de altura`).toBeGreaterThanOrEqual(24);
  }
});

test('do cadastro, abre em outra aba e o formulário continua preenchido', async ({ page, context }) => {
  await page.goto('/cadastro');
  await page.getByLabel('Nome').fill('Pessoa de Teste');

  const [aba] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: /aviso de privacidade/i }).click(),
  ]);

  await expect(aba).toHaveURL(/\/privacidade$/);
  await expect(titulo(aba)).toBeVisible();
  // O motivo de ser outra aba: quem já digitou não perde o que digitou.
  await expect(page.getByLabel('Nome')).toHaveValue('Pessoa de Teste');
});

test('da tela de entrada também, que é por onde entra quem cria a conta pelo Google', async ({ page, context }) => {
  await page.goto('/login');

  const [aba] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: /aviso de privacidade/i }).click(),
  ]);

  await expect(aba).toHaveURL(/\/privacidade$/);
  await expect(titulo(aba)).toBeVisible();
});

import { test, expect } from '@playwright/test';
import { montarCenario, entrar } from './apoio.js';

/**
 * Concluir um chamado exige a confirmação do uso de EPI.
 *
 * O teste de componente garante o que a tela envia; este garante o que o
 * navegador de verdade faz com ela: a caixa obrigatória segura o envio, a
 * conclusão grava quem confirmou, e a caixa cabe na tela do celular sem
 * empurrar a página para o lado.
 */

let cenario;

test.beforeAll(async () => {
  cenario = await montarCenario();
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

async function chamadoEmAndamento() {
  const chamado = await cenario.abrirChamado({ titulo: `Conclusão com EPI ${cenario.marca}` });
  await cenario.atribuir(chamado.id);
  await cenario.pessoas.tecnico.patch(`/chamados/${chamado.id}/estado`, { estado: 'em_andamento' });
  return chamado;
}

test('sem marcar a caixa o chamado não conclui; marcada, conclui e registra quem confirmou', async ({ page }) => {
  const chamado = await chamadoEmAndamento();
  const tecnico = cenario.pessoas.tecnico;

  await entrar(page, tecnico);
  await page.goto(`/chamados/${chamado.id}`);

  await page.getByRole('button', { name: 'Concluído' }).click();
  await page.getByLabel(/Descrição do serviço executado/).fill('Trocado o registro e testada a vedação.');

  const caixa = page.getByRole('checkbox', { name: /EPIs exigidos para este serviço/ });
  await expect(caixa).not.toBeChecked();

  // O navegador segura o envio da caixa obrigatória vazia: nada vai ao servidor.
  await page.getByRole('button', { name: 'Concluir chamado' }).click();
  await expect(caixa).toBeFocused();
  expect((await tecnico.get(`/chamados/${chamado.id}`)).corpo.chamado.estado).toBe('em_andamento');

  await caixa.check();
  await page.getByRole('button', { name: 'Concluir chamado' }).click();

  await expect(page.getByText(/Uso de EPI confirmado em/)).toBeVisible();
  const { corpo } = await tecnico.get(`/chamados/${chamado.id}`);
  expect(corpo.chamado.estado).toBe('concluido');
  expect(corpo.chamado.epi_confirmado_por).toBe(tecnico.usuario.id);
  expect(corpo.chamado.epi_confirmado_em).not.toBeNull();
});

test('a caixa tem tamanho de alvo e cabe na tela', async ({ page }) => {
  const chamado = await chamadoEmAndamento();

  await entrar(page, cenario.pessoas.tecnico);
  await page.goto(`/chamados/${chamado.id}`);
  await page.getByRole('button', { name: 'Concluído' }).click();

  const caixa = page.getByRole('checkbox', { name: /EPIs exigidos para este serviço/ });
  const rotulo = page.locator('label', { has: caixa });
  await expect(rotulo).toBeVisible();

  // WCAG 2.5.8: alvo de ao menos 24 x 24 px. A caixa em si tem 20, e o rótulo
  // inteiro é clicável.
  const c = await caixa.boundingBox();
  const r = await rotulo.boundingBox();
  expect(c.width).toBeGreaterThanOrEqual(20);
  expect(c.height).toBeGreaterThanOrEqual(20);
  expect(r.height).toBeGreaterThanOrEqual(24);

  // Clicar no texto marca a caixa.
  await rotulo.getByText(/Confirmo que os EPIs/).click();
  await expect(caixa).toBeChecked();

  // WCAG 1.4.10: nada empurra a página para o lado.
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(sobra).toBeLessThanOrEqual(0);
  const cartao = await page.locator('form', { has: caixa }).boundingBox();
  expect(r.x + r.width).toBeLessThanOrEqual(cartao.x + cartao.width + 1);
});

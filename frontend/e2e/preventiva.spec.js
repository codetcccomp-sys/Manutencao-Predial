import { test, expect } from '@playwright/test';
import { montarCenario, entrar, conferirQueCabeNaTela } from './apoio.js';

/**
 * A manutenção preventiva de ponta a ponta: a gestão cadastra o equipamento e
 * o plano pela tela, o plano gera o chamado, o técnico o recebe na fila; e o
 * solicitante abre um corretivo pelo endereço que o QR Code levaria.
 */

let cenario;

test.beforeAll(async () => {
  cenario = await montarCenario();
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

test('gestão cadastra equipamento e plano, gera a execução, e o técnico a recebe na fila', async ({ page }) => {
  const codigo = `AC-${cenario.marca}`;
  const servico = `Limpeza do filtro ${cenario.marca}`;

  await entrar(page, cenario.pessoas.gestor);
  await page.getByRole('link', { name: 'Preventiva' }).click();
  await expect(page.getByRole('heading', { name: 'Manutenção preventiva' })).toBeVisible();

  // Equipamento.
  await page.getByRole('tab', { name: 'Equipamentos' }).click();
  await page.getByLabel('Código').fill(codigo.toLowerCase());
  await page.getByLabel('Nome').fill('Split 12.000 BTU');
  await page.getByLabel('Local').selectOption({ label: `Unidade E2E ${cenario.marca} / A` });
  await page.getByLabel('Categoria').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Cadastrar equipamento' }).click();
  // O código volta normalizado: é o que vai na etiqueta.
  await expect(page.getByRole('link', { name: `${codigo} — Split 12.000 BTU` })).toBeVisible();

  // Plano, com o técnico como responsável.
  await page.getByRole('tab', { name: 'Planos' }).click();
  await page.getByLabel('Serviço').fill(servico);
  await page.getByLabel('Roteiro').fill('Desligar, lavar o filtro, secar e recolocar.');
  await page
    .getByLabel('Equipamento')
    .selectOption({ label: `${codigo} — Split 12.000 BTU · Unidade E2E ${cenario.marca} / A` });
  await page.getByLabel('Repetir a cada').fill('3');
  await page.getByLabel('Próxima execução').fill('2031-03-10');
  // Pelo id: todo técnico de teste se chama "E2E tecnico", e pelo nome o
  // plano iria para o de outra rodada.
  await page.getByLabel('Responsável').selectOption(String(cenario.pessoas.tecnico.usuario.id));
  await page.getByRole('button', { name: 'Cadastrar plano' }).click();

  const plano = page.getByRole('listitem').filter({ hasText: servico });
  await expect(plano).toContainText('a cada 3 meses');
  await expect(plano).toContainText('10/03/2031');

  await plano.getByRole('button', { name: 'Gerar agora' }).click();
  // 2031 está longe da janela de antecedência: gerar hoje é antecipar, e o
  // sistema pergunta antes de pular o plano para a execução seguinte.
  const antecipar = page.getByRole('dialog', { name: 'Antecipar a preventiva?' });
  await expect(antecipar).toContainText('10/03/2031');
  await antecipar.getByRole('button', { name: 'Gerar agora' }).click();
  await expect(page.getByText(/gerado, previsto para 10\/03\/2031/)).toBeVisible();
  // O plano andou um período.
  await expect(plano).toContainText('10/06/2031');

  if (page.viewportSize().width < 640) await conferirQueCabeNaTela(page, expect);

  // O técnico recebe o chamado já atribuído, com o roteiro como descrição.
  await page.getByRole('button', { name: 'Sair' }).click();
  await entrar(page, cenario.pessoas.tecnico);
  await page.getByText(servico).first().click();
  await expect(page.getByRole('heading', { name: servico })).toBeVisible();
  await expect(page.getByText('Preventiva', { exact: true })).toBeVisible();
  await expect(page.getByText(/prevista para 10\/03\/2031/)).toBeVisible();
  await expect(page.getByText('Desligar, lavar o filtro, secar e recolocar.')).toBeVisible();

  // E a ficha do equipamento mostra a preventiva no histórico.
  await page.getByRole('link', { name: `${codigo} — Split 12.000 BTU` }).click();
  await expect(page.getByRole('heading', { name: 'Split 12.000 BTU' })).toBeVisible();
  await expect(page.getByRole('link', { name: servico })).toBeVisible();
  if (page.viewportSize().width < 640) await conferirQueCabeNaTela(page, expect);
});

test('pelo endereço do QR Code, o solicitante abre o chamado sem escolher o local', async ({ page }) => {
  const codigo = `BOMBA-${cenario.marca}`;
  const { corpo } = await cenario.pessoas.gestor.post('/equipamentos', {
    codigo,
    nome: 'Bomba de recalque',
    categoria_id: cenario.categoria.id,
    local_id: cenario.local.id,
  });
  expect(corpo.equipamento.codigo).toBe(codigo);

  await entrar(page, cenario.pessoas.solicitante);
  await page.goto(`/chamados/novo?equipamento=${codigo.toLowerCase()}`);

  await expect(page.getByText('Chamado para este equipamento')).toBeVisible();
  await expect(page.getByLabel('Equipamento')).toHaveValue(String(corpo.equipamento.id));

  const titulo = `Bomba fazendo barulho ${cenario.marca}`;
  await page.getByLabel('Título').fill(titulo);
  await page.getByLabel('Descrição').fill('Ruído forte ao ligar, desde ontem.');
  await page.getByRole('button', { name: 'Abrir chamado' }).click();

  await page.waitForURL(/\/chamados\/\d+$/);
  await expect(page.getByRole('heading', { name: titulo })).toBeVisible();
  await expect(page.getByText(`${codigo} — Bomba de recalque`)).toBeVisible();
  await expect(page.getByText(`Unidade E2E ${cenario.marca} / A`)).toBeVisible();
});

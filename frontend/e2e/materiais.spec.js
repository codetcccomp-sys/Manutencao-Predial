import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { montarCenario, entrar, conferirQueCabeNaTela } from './apoio.js';

/**
 * Materiais usados no atendimento (RF07), de ponta a ponta: a gestão cadastra o material no
 * catálogo, o técnico designado o lança no chamado, e o lançamento aparece na linha do tempo.
 *
 * A API existia desde o início, mas nenhuma tela a oferecia (achado de 13/11/2026). Este teste
 * é o que impede a tela de sumir de novo sem ninguém notar.
 */
let cenario;

test.beforeAll(async () => {
  cenario = await montarCenario();
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

const REGRAS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function semViolacoes(page) {
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withTags(REGRAS).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
}

test('a gestão cadastra o material e o técnico designado o lança no chamado', async ({ page }, info) => {
  const nome = `Cabo E2E ${cenario.marca} ${info.project.name}`;

  // 1. Gestão: catálogo, na aba Materiais de Cadastros.
  await entrar(page, cenario.pessoas.gestor);
  await page.goto('/cadastros?aba=materiais');
  await page.getByRole('textbox', { name: 'Nome', exact: true }).fill(nome);
  await page.getByRole('textbox', { name: /Unidade de medida/ }).fill('m');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByText('Material cadastrado.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: `Nome de ${nome}` })).toBeVisible();
  await semViolacoes(page);
  await conferirQueCabeNaTela(page, expect);

  // 2. Técnico designado: lança no chamado em atendimento.
  const chamado = await cenario.abrirChamado({ titulo: `Material ${cenario.marca} ${info.project.name}` });
  await cenario.atribuir(chamado.id);
  await cenario.pessoas.tecnico.patch(`/chamados/${chamado.id}/estado`, { estado: 'em_andamento' });

  await page.context().clearCookies();
  await entrar(page, cenario.pessoas.tecnico);
  await page.goto(`/chamados/${chamado.id}`);

  const secao = page.getByRole('region', { name: 'Materiais' });
  await secao.getByRole('combobox', { name: 'Material' }).selectOption({ label: `${nome} (m)` });
  await secao.getByRole('spinbutton', { name: /Quantidade/ }).fill('2.5');
  await secao.getByRole('button', { name: 'Lançar' }).click();

  // O nome também está nas opções do select: confere-se o item da lista.
  await expect(secao.getByRole('listitem').filter({ hasText: nome })).toContainText('· 2,5 m');
  // A linha do tempo diz quem lançou o quê: o chamado foi recarregado. Ela fica recolhida.
  await page.locator('details summary').filter({ hasText: /registros?/ }).click();
  await expect(page.getByText(`Material lançado: ${nome}, 2,5 m.`)).toBeVisible();
  await semViolacoes(page);
  await conferirQueCabeNaTela(page, expect);

  // 3. Concluído, o chamado vira registro: o material continua lá, sem formulário.
  await cenario.pessoas.tecnico.patch(`/chamados/${chamado.id}/estado`, {
    estado: 'concluido',
    servico_realizado: 'Troca do cabo do quadro de distribuição.',
    epi_confirmado: true,
  });
  await page.reload();
  await expect(secao.getByRole('listitem').filter({ hasText: nome })).toBeVisible();
  await expect(secao.getByRole('button')).toHaveCount(0);
});

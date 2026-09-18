import { test, expect } from '@playwright/test';
import { montarCenario, entrar } from './apoio.js';

/**
 * O caminho que o sistema existe para percorrer: alguém abre um chamado, a
 * gestão distribui, o técnico executa, o solicitante avalia.
 *
 * Aqui não há duplê nenhum — é a build real falando com a API real e o banco
 * real. É o que sobra quando o teste de componente já disse que cada peça
 * funciona sozinha e ninguém garantiu que elas se encaixam.
 */

let cenario;

test.beforeAll(async () => {
  cenario = await montarCenario();
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

test('abrir um chamado pela tela e vê-lo na lista', async ({ page }) => {
  await entrar(page, cenario.pessoas.solicitante);
  await page.goto('/chamados/novo');

  const titulo = `Porta emperrada na sala de aula ${cenario.marca}`;
  await page.getByLabel('Título').fill(titulo);
  await page.getByLabel('Descrição').fill('A porta não fecha desde a chuva da semana passada.');
  await page.getByLabel('Categoria').selectOption({ index: 1 });
  await page.getByLabel('Local').selectOption({ label: `Unidade E2E ${cenario.marca} / A` });
  await page.getByRole('button', { name: /abrir chamado|criar/i }).click();

  await page.waitForURL(/\/chamados\/\d+$/);
  await expect(page.getByRole('heading', { name: titulo })).toBeVisible();

  // E aparece na lista de quem abriu.
  await page.goto('/');
  await expect(page.getByText(titulo)).toBeVisible();
});

test('buscar pelo protocolo encontra o chamado (RF03)', async ({ page }) => {
  const chamado = await cenario.abrirChamado({ titulo: `Buscável ${cenario.marca}` });

  await entrar(page, cenario.pessoas.solicitante);
  await page.getByLabel('Buscar').fill(chamado.protocolo);

  await expect(page.getByText(chamado.protocolo)).toBeVisible();
  const cartoes = page.locator('a[href^="/chamados/"]').filter({ hasText: chamado.protocolo });
  await expect(cartoes).toHaveCount(1);
});

test('busca sem resultado diz o que foi procurado', async ({ page }) => {
  await entrar(page, cenario.pessoas.solicitante);
  await page.getByLabel('Buscar').fill(`inexistente-${cenario.marca}`);

  await expect(
    page.getByText(`Nenhum chamado encontrado para "inexistente-${cenario.marca}".`)
  ).toBeVisible();
});

test('o solicitante corrige o chamado e o histórico registra (RN03)', async ({ page }) => {
  const chamado = await cenario.abrirChamado({ titulo: `Antes da correção ${cenario.marca}` });

  await entrar(page, cenario.pessoas.solicitante);
  await page.goto(`/chamados/${chamado.id}`);

  await page.getByRole('button', { name: 'Corrigir' }).click();
  const novoTitulo = `Depois da correção ${cenario.marca}`;
  await page.getByLabel('Título').fill(novoTitulo);
  await page.getByRole('button', { name: 'Salvar correção' }).click();

  await expect(page.getByRole('heading', { name: novoTitulo })).toBeVisible();
  // Sem registro, o técnico leria uma descrição diferente da que motivou a
  // triagem, sem saber que mudou.
  await expect(page.getByText(/editado/i).first()).toBeVisible();
});

test('depois de atribuído o solicitante comenta, já que não pode editar (RN03)', async ({
  page,
}) => {
  const chamado = await cenario.abrirChamado();
  await cenario.atribuir(chamado.id);

  await entrar(page, cenario.pessoas.solicitante);
  await page.goto(`/chamados/${chamado.id}`);
  await page.waitForSelector('h3:has-text("Comentários")');

  await expect(page.getByRole('button', { name: 'Corrigir' })).toHaveCount(0);

  const texto = `Esqueci de dizer que piora à noite ${cenario.marca}`;
  await page.getByPlaceholder('Escreva um comentário').fill(texto);
  await page.getByRole('button', { name: 'Comentar' }).click();

  await expect(page.getByText(texto)).toBeVisible();
});

test('o comentário do solicitante vira aviso para o técnico', async ({ page }) => {
  const chamado = await cenario.abrirChamado();
  await cenario.atribuir(chamado.id);
  await cenario.pessoas.solicitante.post(`/chamados/${chamado.id}/comentarios`, {
    texto: `Aviso que o técnico precisa ver ${cenario.marca}`,
  });

  await entrar(page, cenario.pessoas.tecnico);

  const sino = page.getByRole('button', { name: /avisos: \d+ não lidos/i });
  await expect(sino).toBeVisible();
  await sino.click();

  const item = page.locator('li').filter({ hasText: chamado.protocolo }).first();
  await expect(item).toContainText('Comentário');

  // Clicar no aviso leva ao chamado citado.
  await item.getByRole('button').click();
  await page.waitForURL(`**/chamados/${chamado.id}`);
});

test('chamado encerrado guarda a conversa mas não aceita comentário novo', async ({ page }) => {
  const chamado = await cenario.abrirChamado();
  await cenario.atribuir(chamado.id);
  await cenario.pessoas.solicitante.post(`/chamados/${chamado.id}/comentarios`, {
    texto: `Dito antes de encerrar ${cenario.marca}`,
  });
  await cenario.concluir(chamado.id);

  await entrar(page, cenario.pessoas.solicitante);
  await page.goto(`/chamados/${chamado.id}`);
  await page.waitForSelector('h3:has-text("Comentários")');

  await expect(page.getByText(`Dito antes de encerrar ${cenario.marca}`)).toBeVisible();
  await expect(page.getByPlaceholder('Escreva um comentário')).toHaveCount(0);
  await expect(page.getByText(/não recebe novos comentários/)).toBeVisible();
});

test('o escopo por perfil vale na tela, não só na API', async ({ page }) => {
  const chamado = await cenario.abrirChamado({ titulo: `Privado ${cenario.marca}` });

  // Um segundo solicitante, que não tem nada com este chamado.
  const outro = await montarCenario({ perfis: ['solicitante'] });
  try {
    await entrar(page, outro.pessoas.solicitante);
    await page.goto(`/chamados/${chamado.id}`);

    // A tela mostra a recusa do servidor em vez de conteúdo alheio.
    await expect(page.getByText('Não foi possível carregar o chamado.')).toBeVisible();
    await expect(page.getByText(`Privado ${cenario.marca}`)).toHaveCount(0);
  } finally {
    await outro.encerrar();
  }
});

test('o solicitante não vê os atalhos da gestão no cabeçalho', async ({ page }) => {
  await entrar(page, cenario.pessoas.solicitante);

  await expect(page.getByRole('link', { name: 'Relatórios' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Cadastros' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Usuários' })).toHaveCount(0);
});

test('a gestão vê relatórios e cadastros; usuários é só do administrador', async ({ page }) => {
  await entrar(page, cenario.pessoas.gestor);

  await expect(page.getByRole('link', { name: 'Relatórios' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cadastros' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Usuários' })).toHaveCount(0);
});

test('sessão expirada devolve ao login em vez de deixar a tela quebrada', async ({ page }) => {
  await entrar(page, cenario.pessoas.solicitante);

  // Um token inválido é o que sobra quando o anterior vence: a tela precisa
  // perceber e voltar ao login, não encher de erro.
  await page.evaluate(() => localStorage.setItem('smp_token', 'token.invalido.demais'));
  await page.goto('/');

  await page.waitForURL('**/login', { timeout: 15_000 });
  await expect(page.getByText(/sess(ã|a)o expirou|entre com sua conta/i).first()).toBeVisible();
});

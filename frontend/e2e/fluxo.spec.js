import { test, expect } from '@playwright/test';
import { montarCenario, entrar, responderSituacao, conferirQueCabeNaTela } from './apoio.js';

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
  // Urgência 3, impacto 3 e risco 2 somam 8: "alta" na regra v1. A pessoa não escolhe a prioridade.
  await responderSituacao(page, {
    risco: 'Pode virar risco se demorar',
    impacto: 'Uma sala ou um serviço não pode ser usado',
    urgencia: 'Hoje',
  });
  await page.getByRole('button', { name: /abrir chamado|criar/i }).click();

  await page.waitForURL(/\/chamados\/\d+$/);
  await expect(page.getByRole('heading', { name: titulo })).toBeVisible();
  await expect(page.getByText('Alta', { exact: true }).first()).toBeVisible();

  // E aparece na lista de quem abriu.
  await page.goto('/');
  await expect(page.getByText(titulo)).toBeVisible();
});

test('cadastrar-se pela tela: senha comum é recusada com o motivo, e a boa leva a "pedido enviado" e depois entra', async ({ page }) => {
  const email = `cadastro_${cenario.marca}_${Date.now()}@exemplo.com`;
  await page.goto('/cadastro');
  await page.getByLabel('Nome').fill('Pessoa do Cadastro');
  await page.getByLabel('E-mail').fill(email);

  // Dez caracteres, mas entre as mais usadas: o servidor recusa e a tela diz por quê.
  await page.getByLabel('Senha').fill('senha12345');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByRole('alert')).toContainText('muito comum');

  await page.getByLabel('Senha').fill('uma frase longa para a senha');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByRole('heading', { name: 'Pedido enviado' })).toBeVisible();

  await page.getByRole('link', { name: 'Ir para o login' }).click();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/senha/i).fill('uma frase longa para a senha');
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page.getByRole('heading', { name: 'Meus pedidos' })).toBeVisible();
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

  // O histórico é registro de auditoria, não ferramenta de trabalho: fica
  // recolhido para não empurrar comentários e anexos, que são de uso diário,
  // para fora do alcance. Está lá quando se precisa dele — que é agora.
  const historico = page.locator('details', { hasText: 'Histórico' });
  await expect(page.getByText(/editado/i).first()).toBeHidden();

  await historico.locator('summary').click();

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
  await page.waitForSelector('h2:has-text("Comentários")');

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
  await page.waitForSelector('h2:has-text("Comentários")');

  await expect(page.getByText(`Dito antes de encerrar ${cenario.marca}`)).toBeVisible();
  await expect(page.getByPlaceholder('Escreva um comentário')).toHaveCount(0);
  await expect(page.getByText(/não recebe novos comentários/)).toBeVisible();
});

// RF09: o solicitante confirma a solução e avalia, com comentário; quem atendeu
// e a gestão passam a ver a avaliação no próprio chamado.
test('o solicitante confirma a solução e avalia, e a gestão vê a avaliação no chamado (RF09)', async ({ page }) => {
  const chamado = await cenario.abrirChamado();
  await cenario.atribuir(chamado.id);
  await cenario.concluir(chamado.id);

  await entrar(page, cenario.pessoas.solicitante);
  await page.goto(`/chamados/${chamado.id}`);
  const formulario = page.locator('form', {
    has: page.getByRole('heading', { name: 'Confirmar a solução e avaliar' }),
  });
  await expect(formulario.getByText(/você confirma que o serviço foi feito/)).toBeVisible();
  await formulario.getByLabel('Nota do atendimento').selectOption('4');
  await formulario.getByLabel('Comentário (opcional)').fill(`Resolveu ${cenario.marca}`);
  await formulario.getByRole('button', { name: 'Confirmar e enviar avaliação' }).click();

  await expect(page.getByText('Solução confirmada e avaliação enviada. Obrigado!')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sua avaliação' })).toBeVisible();
  await expect(page.getByLabel('Comentário (opcional)')).toHaveValue(`Resolveu ${cenario.marca}`);
  // O histórico fica recolhido: abre, e a confirmação está lá.
  await page.locator('summary', { hasText: 'Histórico' }).click();
  await expect(
    page.getByText('Solicitante confirmou a solução e avaliou o atendimento: nota 4 de 5.')
  ).toBeVisible();
  await conferirQueCabeNaTela(page, expect);

  // Outra pessoa no mesmo navegador: a sessão é o cookie.
  await page.context().clearCookies();
  await entrar(page, cenario.pessoas.gestor);
  await page.goto(`/chamados/${chamado.id}`);
  const cartao = page.locator('div', { has: page.getByRole('heading', { name: 'Avaliação do solicitante' }) }).last();
  await expect(cartao.getByText('4 de 5')).toBeVisible();
  await expect(cartao.getByText(`“Resolveu ${cenario.marca}”`)).toBeVisible();
  await expect(page.getByLabel('Nota do atendimento')).toHaveCount(0);
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

  // Um cookie com token inválido é o que sobra quando o anterior vence: a
  // tela precisa perceber e voltar ao login, não encher de erro.
  await page.context().addCookies([
    { name: 'conserva_sessao', value: 'token.invalido.demais', url: new URL(page.url()).origin },
  ]);
  await page.goto('/');

  await page.waitForURL('**/login', { timeout: 15_000 });
  await expect(page.getByText(/sess(ã|a)o expirou|entre com sua conta/i).first()).toBeVisible();
});

test('importar planilha de locais e abrir chamado num deles (RF02/RF11)', async ({ page }) => {
  await entrar(page, cenario.pessoas.gestor);
  await page.goto('/cadastros');

  const unidade = `Unidade Carga ${cenario.marca}`;
  const planilha = Buffer.from(
    `﻿unidade;bloco;pavimento;ambiente\r\n` +
      `${unidade};A;Térreo;Recepção\r\n` +
      `${unidade};A;1º andar;Sala 101\r\n`,
    'utf8'
  );

  await page
    .getByLabel('Planilha de locais')
    .setInputFiles({ name: 'locais.csv', mimeType: 'text/csv', buffer: planilha });

  await expect(page.getByText('2 locais criados de 2 linhas.')).toBeVisible();

  // Reenviar o mesmo arquivo reconhece o que já existe em vez de duplicar. É a
  // garantia que torna a correção de uma linha barata: reenvia-se tudo.
  await page
    .getByLabel('Planilha de locais')
    .setInputFiles({ name: 'locais.csv', mimeType: 'text/csv', buffer: planilha });

  await expect(page.getByText('0 locais criados; 2 já existiam de 2 linhas.')).toBeVisible();

  // O acento tem de ter sobrevivido a build, requisição, banco e volta — é
  // onde a codificação costuma quebrar sem ninguém notar.
  // A lista desenha os primeiros 50 locais; o filtro alcança o resto, e num banco que já acumulou
  // locais os recém-criados podem estar além deles.
  await page.getByPlaceholder('Filtrar locais').fill(unidade);
  await expect(page.getByText(`${unidade} / A / Térreo / Recepção`)).toBeVisible();

  // E o local importado serve para o que existe: abrir chamado nele.
  await entrar(page, cenario.pessoas.solicitante);
  await page.goto('/chamados/novo');
  await page.getByLabel('Local').selectOption({ label: `${unidade} / A / 1º andar / Sala 101` });
  await page.getByLabel('Título').fill(`Chamado no local importado ${cenario.marca}`);
  await page.getByLabel('Descrição').fill('Lâmpada queimada na sala recém-cadastrada.');
  await page.getByLabel('Categoria').selectOption({ index: 1 });
  await responderSituacao(page);
  await page.getByRole('button', { name: /abrir chamado|criar/i }).click();

  await page.waitForURL(/\/chamados\/\d+$/);
  await expect(page.getByText(`${unidade} / A / 1º andar / Sala 101`)).toBeVisible();
});

test('planilha com linha errada é recusada inteira, com os problemas na tela', async ({ page }) => {
  await entrar(page, cenario.pessoas.gestor);
  await page.goto('/cadastros');

  const unidade = `Unidade Recusa ${cenario.marca}`;
  await page.getByLabel('Planilha de locais').setInputFiles({
    name: 'ruim.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`unidade;ambiente\r\n${unidade};Sala 1\r\n;Sala 2\r\n`, 'utf8'),
  });

  await expect(page.getByText('Nada foi importado. Corrija e envie o arquivo de novo:')).toBeVisible();
  await expect(page.getByText('Linha 3: "unidade" é obrigatória.')).toBeVisible();

  // Tudo ou nada: a linha boa também ficou de fora.
  await page.getByPlaceholder('Filtrar locais').fill(unidade);
  await expect(page.getByText('Nenhum local corresponde ao filtro.')).toBeVisible();
});

import { test, expect } from '@playwright/test';
import { montarCenario, entrar, conferirQueCabeNaTela } from './apoio.js';

/**
 * Layout: a camada que só um navegador de verdade mede.
 *
 * Todos os defeitos de responsividade deste projeto — o cartão de chamado
 * esticando a página, as tabelas vazando do cartão, o painel de avisos saindo
 * pela esquerda no celular — passaram por build verde e por teste de
 * componente. jsdom devolve zero em getBoundingClientRect: geometria só
 * existe aqui.
 */

let cenario;
let chamado;

test.beforeAll(async () => {
  cenario = await montarCenario();
  chamado = await cenario.abrirChamado({
    titulo:
      'Infiltração persistente na laje do subsolo junto ao quadro elétrico principal do bloco',
  });
  await cenario.atribuir(chamado.id);
  await cenario.pessoas.solicitante.post(`/chamados/${chamado.id}/comentarios`, {
    texto: 'Comentário com texto suficientemente longo para ocupar algumas linhas na tela.',
  });
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

const TELAS = [
  { rota: '/', espera: 'h1', quem: 'gestor' },
  { rota: '/chamados/novo', espera: 'form', quem: 'solicitante' },
  { rota: '/relatorios', espera: 'h2:has-text("Por local")', quem: 'gestor' },
  { rota: '/cadastros', espera: 'h2:has-text("Cadastrar local")', quem: 'gestor' },
  { rota: '/preventiva', espera: 'h2:has-text("Novo plano")', quem: 'gestor' },
  { rota: '/cadastros?aba=expediente', espera: 'h2:has-text("Feriados")', quem: 'gestor' },
  { rota: '/cadastros?aba=distribuicao', espera: 'h2:has-text("Nova regra")', quem: 'gestor' },
  { rota: '/etiquetas?tipo=locais', espera: 'svg[role="img"]', quem: 'gestor' },
  { rota: '/usuarios', espera: 'h1', quem: 'administrador' },
];

for (const { rota, espera, quem } of TELAS) {
  test(`${rota} cabe na tela`, async ({ page }) => {
    await entrar(page, cenario.pessoas[quem] ?? cenario.pessoas.administrador);
    await page.goto(rota);
    await page.waitForSelector(espera);
    await conferirQueCabeNaTela(page, expect);
  });
}

test('o detalhe do chamado cabe na tela', async ({ page }) => {
  await entrar(page, cenario.pessoas.gestor);
  await page.goto(`/chamados/${chamado.id}`);
  await page.waitForSelector('h2:has-text("Comentários")');
  await conferirQueCabeNaTela(page, expect);
});

test('o diálogo de confirmação cabe na tela e devolve o foco', async ({ page }) => {
  await entrar(page, cenario.pessoas.gestor);
  await page.goto(`/chamados/${chamado.id}`);

  const botao = page.getByRole('button', { name: 'Cancelado' });
  await botao.click();

  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  // Um diálogo que não cabe é pior que nenhum: o botão de recusa fica fora da
  // tela e sobra confirmar.
  await conferirQueCabeNaTela(page, expect);
  const caixa = await dialogo.boundingBox();
  const tela = page.viewportSize();
  expect(caixa.y).toBeGreaterThanOrEqual(0);
  expect(caixa.y + caixa.height).toBeLessThanOrEqual(tela.height + 1);

  await page.keyboard.press('Escape');
  await expect(dialogo).toBeHidden();
  // O chamado continua no fluxo: fechar é "não".
  await expect(page.getByRole('button', { name: 'Cancelado' })).toBeFocused();
});

test('um título longo é cortado em vez de esticar a página', async ({ page }) => {
  await entrar(page, cenario.pessoas.solicitante);
  await page.goto('/');
  await page.waitForSelector('a[href^="/chamados/"]');

  // O cartão é item de grid, e item de grid não encolhe abaixo do próprio
  // conteúdo por padrão: sem min-w-0, o título que o truncate deveria cortar
  // esticava a página inteira.
  await conferirQueCabeNaTela(page, expect);
});

test('o painel de avisos abre inteiro dentro da tela', async ({ page }) => {
  await entrar(page, cenario.pessoas.tecnico);

  const sino = page.getByRole('button', { name: /avisos/i });
  await sino.click();
  await page.waitForSelector('text=Avisos');

  const caixa = await page.locator('div:has(> div > span:text("Avisos"))').first().boundingBox();
  const largura = page.viewportSize().width;

  // Alinhado só pela direita do sino, o painel saía pela esquerda no celular
  // e o texto ficava cortado. Transbordo à esquerda não cria barra de
  // rolagem, então nada acusava.
  expect(caixa.x, 'o painel não pode começar fora da tela').toBeGreaterThanOrEqual(0);
  expect(caixa.x + caixa.width, 'o painel não pode terminar fora da tela').toBeLessThanOrEqual(
    largura + 1
  );
});

test('o relatório cabe na tela em qualquer largura', async ({ page }) => {
  await entrar(page, cenario.pessoas.gestor);
  await page.goto('/relatorios');
  await page.waitForSelector('h2:has-text("Carga por técnico")');

  await conferirQueCabeNaTela(page, expect);
});

test('o primeiro Tab leva ao conteúdo, não aos links do cabeçalho', async ({ page }) => {
  await entrar(page, cenario.pessoas.administrador);
  await page.goto('/');

  await page.keyboard.press('Tab');

  const atalho = page.getByRole('link', { name: 'Pular para o conteúdo' });
  await expect(atalho).toBeFocused();

  // Invisível até receber foco: ocupa espaço nenhum para quem usa mouse.
  await expect(atalho).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.locator('#conteudo')).toBeVisible();

  // Sem o atalho, quem navega por teclado percorre título, três links do
  // menu, sino e Sair a cada troca de tela antes de alcançar o conteúdo.
  const antesDoConteudo = await page.evaluate(() => {
    const focaveis = [...document.querySelectorAll('a[href], button, input, select')];
    const conteudo = document.querySelector('#conteudo');
    return focaveis.findIndex((el) => conteudo.contains(el));
  });
  expect(antesDoConteudo).toBeGreaterThan(4);
});

test('a seção aberta se anuncia como página atual', async ({ page }) => {
  await entrar(page, cenario.pessoas.administrador);
  await page.goto('/relatorios');

  // aria-current é o que um leitor de tela anuncia; o sublinhado é o mesmo
  // sinal para quem enxerga. Antes não havia nenhum dos dois: os três links
  // ficavam idênticos, estivesse aberta qual estivesse.
  await expect(page.getByRole('link', { name: 'Relatórios' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(page.getByRole('link', { name: 'Cadastros' })).not.toHaveAttribute(
    'aria-current',
    'page'
  );
});

test('o conteúdo aproveita a largura do monitor', async ({ page }) => {
  await entrar(page, cenario.pessoas.gestor);
  await page.goto('/');
  await page.waitForSelector('h1');

  const { larguraConteudo, larguraTela } = await page.evaluate(() => ({
    larguraConteudo: document.querySelector('#conteudo').getBoundingClientRect().width,
    larguraTela: document.documentElement.clientWidth,
  }));

  // Em telas largas o sistema ocupava 896px e deixava mais da metade do
  // monitor vazia, enquanto as tabelas de relatório rolavam na horizontal
  // dentro do container apertado. No celular o teto não vincula e o conteúdo
  // continua ocupando a tela toda menos a margem.
  if (larguraTela >= 1280) {
    expect(larguraConteudo).toBeGreaterThan(1100);
  } else {
    expect(larguraConteudo).toBeGreaterThan(larguraTela - 48);
  }
});

test('o mesmo dado sai como tabela no monitor e como blocos no celular', async ({ page }, info) => {
  await entrar(page, cenario.pessoas.gestor);
  await page.goto('/relatorios');
  await page.waitForSelector('h2:has-text("Por local")');

  const tabela = page.getByRole('table', { name: 'Chamados por local no período' });

  if (info.project.name === 'celular') {
    // Cinco colunas de números num aparelho de 393px só se leem rolando para
    // o lado, e comparar linhas — que é para o que serve a tabela — deixa de
    // ser possível de qualquer jeito. Então não é a tabela encolhida: é outro
    // arranjo, um registro por vez.
    await expect(tabela).toBeHidden();
    await expect(page.getByText('Em aberto').first()).toBeVisible();
  } else {
    await expect(tabela).toBeVisible();

    // A legenda nomeia a tabela para quem não vê o título do cartão acima
    // dela — e é ela que faz o getByRole acima encontrar a tabela pelo nome.
    const colunas = await tabela.locator('thead th[scope="col"]').count();
    expect(colunas).toBe(4);

    // scope="row" na coluna de identidade é o que faz o leitor de tela dizer
    // "Local: Prédio A, Atrasados: 3" em vez de só "3".
    expect(await tabela.locator('tbody th[scope="row"]').count()).toBeGreaterThan(0);
  }
});

test('ordenar a tabela reordena e anuncia a direção', async ({ page }, info) => {
  test.skip(info.project.name === 'celular', 'a ordenação é do cabeçalho da tabela, que só existe a partir de sm');

  await entrar(page, cenario.pessoas.gestor);
  await page.goto('/relatorios');
  await page.waitForSelector('h2:has-text("Carga por técnico")');

  const tabela = page.getByRole('table', { name: 'Carga de chamados por técnico no período' });
  const cabecalho = tabela.locator('th', { hasText: 'Técnico' });

  // Sem ordenação nenhuma, nada foi escolhido ainda.
  await expect(cabecalho).toHaveAttribute('aria-sort', 'none');

  await cabecalho.getByRole('button').click();
  await expect(cabecalho).toHaveAttribute('aria-sort', 'ascending');

  // Clicar de novo inverte, em vez de reordenar igual: é o que a pessoa
  // espera do segundo clique.
  await cabecalho.getByRole('button').click();
  await expect(cabecalho).toHaveAttribute('aria-sort', 'descending');
});

test('o link da conta, no cabeçalho, é um alvo de ao menos 24px e o nome comprido não o quebra', async ({ page }) => {
  await entrar(page, cenario.pessoas.gestor);
  const link = page.getByTitle('Minha conta');

  // WCAG 2.5.8: alvo de ao menos 24 px. O texto sozinho dava 20.
  const caixa = await link.boundingBox();
  expect(caixa.height).toBeGreaterThanOrEqual(24);

  // O nome comprido é cortado com reticências dentro do link, sem estourar a tela.
  await expect(link).toBeVisible();
  await conferirQueCabeNaTela(page, expect);
});

import { test, expect } from '@playwright/test';
import { montarCenario, entrar, conferirQueCabeNaTela } from './apoio.js';

/**
 * Faixa de alerta de crítico sem atendimento, no navegador.
 *
 * A regra é do servidor e está provada nos testes do backend. Aqui o servidor é
 * simulado só para os pedidos com `sem_atendimento=true`: dar a um chamado
 * "15 minutos de idade" pela API é impossível (a abertura é carimbada pelo
 * banco), e esperar 15 minutos de verdade não é teste. O que só um navegador
 * mede é o resto: a faixa cabe na tela, o link é alvo de toque, o clique abre o
 * painel já filtrado e a faixa some quando o chamado deixa de estar parado.
 *
 * Sem service worker: a rota interceptada não atravessa um.
 */

test.use({ serviceWorkers: 'block' });

let cenario;

test.beforeAll(async () => {
  cenario = await montarCenario();
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

const PEDIDO_DO_ALERTA = /\/api\/chamados\?.*sem_atendimento=true/;

function chamadoParado() {
  return {
    id: 987654,
    protocolo: 'SMP-ALERTA-1',
    titulo: 'Quadro geral sem energia no bloco A',
    descricao: 'Sem energia desde a abertura.',
    estado: 'aberto',
    prioridade: 'critica',
    origem: 'corretiva',
    prazo_estimado: null,
    em_atraso: false,
    sem_atendimento_critico: true,
    data_abertura: new Date(Date.now() - 23 * 60_000).toISOString(),
    tecnico_id: null,
  };
}

/** Responde aos pedidos do alerta com a lista que o teste mandar; o resto vai ao servidor de verdade. */
async function simularAlerta(page, lista) {
  await page.route(PEDIDO_DO_ALERTA, async (rota) => {
    const limite = Number(new URL(rota.request().url()).searchParams.get('limite') || 20);
    await rota.fulfill({
      json: {
        chamados: lista.valor.slice(0, limite),
        paginacao: { pagina: 1, limite, total: lista.valor.length, paginas: 1 },
        atendimento_critico_minutos: 15,
      },
    });
  });
}

test('a gestão vê a faixa, e o link abre o painel só com os críticos sem atendimento', async ({ page }) => {
  await simularAlerta(page, { valor: [chamadoParado()] });
  await entrar(page, cenario.pessoas.gestor);

  const faixa = page.getByRole('alert').filter({ hasText: 'chamado crítico sem atendimento' });
  await expect(faixa).toBeVisible();
  await expect(faixa).toContainText('há mais de 15 minutos');
  await conferirQueCabeNaTela(page, expect);

  const link = faixa.getByRole('link', { name: 'Ver o chamado' });
  // WCAG 2.5.8: alvo de ao menos 24 px de altura.
  expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(24);

  await link.click();
  await expect(page).toHaveURL(/recorte=criticos/);
  await expect(page.getByRole('checkbox', { name: 'Críticos sem atendimento' })).toBeChecked();
  await expect(page.getByText('Quadro geral sem energia no bloco A')).toBeVisible();
  await expect(page.getByText(/Sem atendimento há \d+ min/)).toBeVisible();
  await conferirQueCabeNaTela(page, expect);
});

test('a faixa some quando o chamado deixa de estar parado, sem recarregar a página', async ({ page }) => {
  const lista = { valor: [chamadoParado()] };
  await simularAlerta(page, lista);
  await entrar(page, cenario.pessoas.gestor);
  const faixa = page.getByRole('alert').filter({ hasText: 'sem atendimento' });
  await expect(faixa).toBeVisible();

  // A triagem foi feita: o servidor deixa de devolvê-lo. A navegação refaz a consulta.
  lista.valor = [];
  await page.getByRole('link', { name: 'Relatórios' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Relatórios' })).toBeVisible();
  await expect(faixa).toHaveCount(0);
});

test('quem executa não recebe a faixa nem faz a consulta', async ({ page }) => {
  const pedidos = [];
  page.on('request', (pedido) => {
    if (PEDIDO_DO_ALERTA.test(pedido.url())) pedidos.push(pedido.url());
  });
  await simularAlerta(page, { valor: [chamadoParado()] });

  await entrar(page, cenario.pessoas.tecnico);
  await expect(page.getByRole('heading', { level: 1, name: 'Minha fila' })).toBeVisible();
  await page.waitForLoadState('networkidle');

  await expect(page.getByRole('alert').filter({ hasText: 'sem atendimento' })).toHaveCount(0);
  expect(pedidos).toEqual([]);
});

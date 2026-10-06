import { test, expect } from '@playwright/test';
import { montarCenario, entrar, conferirQueCabeNaTela } from './apoio.js';

/**
 * Animações, vistas por um navegador de verdade.
 *
 * O jsdom não tem relógio de quadros nem layout: ele confere que o número chega
 * ao valor final, mas não que a página realmente entra desfocada e termina
 * nítida, nem que um modal continua cobrindo a janela inteira depois da
 * entrada. Isto confere.
 */

let cenario;

test.beforeAll(async () => {
  cenario = await montarCenario();
  // Quatro em aberto: o suficiente para a contagem passar por valores
  // intermediários e para a lista ter mais de um cartão em sequência.
  for (let i = 0; i < 4; i += 1) {
    await cenario.abrirChamado({ titulo: `Chamado de animação ${i + 1}` });
  }
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

/**
 * Guarda, a cada mudança, o texto de cada número animado. É a única forma
 * honesta de provar uma contagem: uma amostra única pode pegar o 0, o valor
 * final ou nada, conforme a velocidade da máquina.
 */
async function gravarContagens(page) {
  await page.addInitScript(() => {
    window.__contagens = [];
    const ler = () => {
      const valores = [...document.querySelectorAll('span.text-2xl > span, p.text-2xl > span')].map(
        (n) => n.textContent
      );
      window.__contagens.push(valores.join('|'));
    };
    new MutationObserver(ler).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}

test.describe('com movimento', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('a página entra animada e termina sem estilo residual', async ({ page }) => {
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/relatorios');

    const envoltorio = page.locator('main > div.animate-pagina-in');
    await expect(envoltorio).toBeVisible();
    expect(await envoltorio.evaluate((el) => getComputedStyle(el).animationName)).toBe('pagina-in');

    // Depois da entrada o envoltório volta ao estilo normal. `backwards` no
    // CSS é o que garante isto; com `forwards` o filter ficaria aplicado.
    await expect
      .poll(() => envoltorio.evaluate((el) => getComputedStyle(el).filter), { timeout: 5000 })
      .toBe('none');
    expect(await envoltorio.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  });

  test('elemento fixed dentro da página cobre a janela inteira depois da entrada', async ({ page }) => {
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/relatorios');
    const envoltorio = page.locator('main > div.animate-pagina-in');
    await expect
      .poll(() => envoltorio.evaluate((el) => getComputedStyle(el).filter), { timeout: 5000 })
      .toBe('none');

    // É o que um modal (Confirmacao, `fixed inset-0`) faz. Um filter ou transform
    // residual no ancestral o prenderia ao envoltório, e o fundo escurecido
    // cobriria só a coluna do conteúdo.
    const cobertura = await page.evaluate(() => {
      const caixa = document.createElement('div');
      caixa.style.cssText = 'position:fixed;inset:0';
      document.querySelector('main > div').appendChild(caixa);
      const r = caixa.getBoundingClientRect();
      caixa.remove();
      return { x: r.x, y: r.y, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight };
    });
    expect(cobertura).toEqual({ x: 0, y: 0, w: cobertura.iw, h: cobertura.ih, iw: cobertura.iw, ih: cobertura.ih });
  });

  test('os indicadores sobem de 0 até o valor, sem passar do valor', async ({ page }) => {
    await gravarContagens(page);
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/');
    await expect(page.getByText('Em aberto').first()).toBeVisible();

    // Espera o valor assentar.
    await page.waitForTimeout(1600);
    const sequencia = await page.evaluate(() => window.__contagens);

    // Só quadros em que TODOS os indicadores já estão na tela: uma linha vazia
    // (antes do resumo chegar) viraria 0 e contaria como "valor menor que o
    // final", e o teste passaria mesmo sem animação nenhuma.
    const porIndicador = sequencia
      .map((linha) => linha.split('|'))
      .filter((v) => v.length >= 3 && v.every((x) => x !== ''))
      .map((v) => v.map((x) => Number(x.replace(/\./g, ''))));
    expect(porIndicador.length).toBeGreaterThan(1);

    const ultimo = porIndicador[porIndicador.length - 1];
    const maior = Math.max(...ultimo);
    expect(maior).toBeGreaterThanOrEqual(4);

    // Nenhum quadro mostra um valor maior que o final (a contagem sobe, não
    // estoura) e há quadro anterior ao valor final (houve movimento).
    for (const linha of porIndicador) {
      linha.forEach((n, i) => expect(n).toBeLessThanOrEqual(ultimo[i]));
    }
    expect(porIndicador.some((linha) => linha.some((n, i) => n < ultimo[i]))).toBe(true);
  });

  test('as barras dos relatórios crescem até o valor', async ({ page }) => {
    await page.addInitScript(() => {
      window.__larguras = [];
      const laco = () => {
        const barra = document.querySelector('div.transition-\\[width\\]');
        if (barra) window.__larguras.push(barra.getBoundingClientRect().width);
        requestAnimationFrame(laco);
      };
      requestAnimationFrame(laco);
    });
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/relatorios');
    await expect(page.getByText('Total').first()).toBeVisible();
    await page.waitForTimeout(1500);

    const larguras = await page.evaluate(() => window.__larguras);
    expect(larguras.length).toBeGreaterThan(3);
    // Começa vazia, termina cheia, e passa por tamanhos intermediários.
    expect(larguras[0]).toBe(0);
    expect(larguras[larguras.length - 1]).toBeGreaterThan(0);
    const final = larguras[larguras.length - 1];
    expect(larguras.some((w) => w > 0 && w < final)).toBe(true);
  });

  test('depois de animar, nada transborda a tela (desktop e celular)', async ({ page }) => {
    await entrar(page, cenario.pessoas.gestor);
    for (const rota of ['/', '/relatorios']) {
      await page.goto(rota);
      await page.waitForTimeout(1500);
      await conferirQueCabeNaTela(page, expect);
    }
  });
});

test.describe('com movimento reduzido', () => {
  test.use({ reducedMotion: 'reduce' });

  test('o valor final aparece direto, sem contagem', async ({ page }) => {
    await gravarContagens(page);
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/');
    await expect(page.getByText('Em aberto').first()).toBeVisible();
    await page.waitForTimeout(500);

    const sequencia = await page.evaluate(() => window.__contagens);
    const linhas = sequencia.filter((l) => l.split('|').some((v) => v !== ''));
    expect(linhas.length).toBeGreaterThan(0);

    // Todo quadro em que há indicador na tela já mostra os valores finais: nenhum
    // quadro intermediário. Em movimento, as linhas anteriores à última têm
    // valores menores (provado no teste acima).
    const ultima = linhas[linhas.length - 1];
    expect(Math.max(...ultima.split('|').map((v) => Number(v.replace(/\./g, ''))))).toBeGreaterThanOrEqual(4);
    expect(linhas.every((l) => l === ultima)).toBe(true);
  });

  test('a página não passa pela entrada animada', async ({ page }) => {
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/relatorios');
    const envoltorio = page.locator('main > div.animate-pagina-in');
    await expect(envoltorio).toBeVisible();
    // A regra global de prefers-reduced-motion reduz a duração a ~0: o filter
    // já está sem efeito no primeiro quadro que se consegue medir.
    const filtro = await envoltorio.evaluate((el) => getComputedStyle(el).filter);
    expect(filtro).toBe('none');
  });
});

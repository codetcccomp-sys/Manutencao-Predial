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
let atribuido;

test.beforeAll(async () => {
  cenario = await montarCenario();
  // O atribuído nasce primeiro: na lista (mais recente em cima) fica abaixo dos
  // abertos, e filtrar por "Atribuído" o faz subir ao topo — é o movimento que o
  // FLIP precisa mostrar.
  // Título único por execução: o banco de teste acumula as rodadas anteriores (e o
  // desktop roda antes do celular), e dois cartões com o mesmo título tornam a busca
  // do botão ambígua.
  atribuido = await cenario.abrirChamado({ titulo: `Atribuído da animação ${cenario.marca}` });
  await cenario.atribuir(atribuido.id);
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

test.describe('Fase 2: lista que se reorganiza e painel de resumo', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('ao filtrar, o cartão que continua desliza até o novo lugar', async ({ page }) => {
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/');
    const cartao = page.locator(`li[data-flip="${atribuido.id}"]`);
    await expect(cartao).toBeVisible();
    await page.waitForTimeout(1200);

    // Amostra o transform do cartão a cada quadro durante a troca do filtro. Uma
    // amostra só pode pegar o começo, o fim ou nada, conforme a máquina.
    await page.evaluate((id) => {
      window.__deslocamentos = [];
      const laco = () => {
        const li = document.querySelector(`li[data-flip="${id}"]`);
        if (li) {
          const m = new DOMMatrixReadOnly(getComputedStyle(li).transform);
          window.__deslocamentos.push(Math.round(m.m42));
        }
        requestAnimationFrame(laco);
      };
      requestAnimationFrame(laco);
    }, atribuido.id);

    await page.selectOption('#filtro-estado', 'atribuido');
    await page.waitForTimeout(1800);

    const amostras = await page.evaluate(() => window.__deslocamentos);
    // Subiu na lista: o cartão ficou ACIMA de onde estava, então começa deslocado
    // para baixo (valor positivo) e termina em zero. Um salto brusco não passaria
    // por valores intermediários.
    const positivos = amostras.filter((y) => y > 0);
    expect(positivos.length, `amostras: ${JSON.stringify(amostras.slice(-40))}`).toBeGreaterThan(2);
    expect(Math.max(...positivos)).toBeGreaterThan(Math.min(...positivos));
    expect(amostras[amostras.length - 1]).toBe(0);
  });

  test('o painel de resumo desliza da direita, cobre a janela e mostra o chamado', async ({ page }) => {
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/');
    const abrir = page.getByRole('button', { name: new RegExp(`ver resumo: ${atribuido.titulo}`, 'i') });
    await abrir.click();

    const painel = page.getByRole('dialog');
    await expect(painel).toBeVisible();
    await expect(painel.getByText(atribuido.titulo)).toBeVisible();
    await expect(painel.getByText(/descrição do problema relatado/i)).toBeVisible();

    // Entra deslocado e termina no lugar. `backwards` não deixa transform residual.
    await expect
      .poll(() => painel.evaluate((el) => getComputedStyle(el).transform), { timeout: 4000 })
      .toBe('none');

    // Está no body (portal), e o fundo cobre a janela inteira: um ancestral com
    // transform (o cartão, durante o FLIP) prenderia o `fixed` e o painel nasceria
    // do tamanho do cartão.
    const geometria = await painel.evaluate((el) => {
      const fundo = el.parentElement;
      const r = fundo.getBoundingClientRect();
      const a = el.getBoundingClientRect();
      return {
        noBody: fundo.parentElement === document.body,
        fundo: [r.x, r.y, r.width, r.height],
        janela: [0, 0, innerWidth, innerHeight],
        painelDentro: a.right <= innerWidth + 1 && a.left >= -1,
        rolagemTravada: document.body.style.overflow,
      };
    });
    expect(geometria.noBody).toBe(true);
    expect(geometria.fundo).toEqual(geometria.janela);
    expect(geometria.painelDentro).toBe(true);
    expect(geometria.rolagemTravada).toBe('hidden');
  });

  test('Esc fecha o painel e devolve o foco ao botão que o abriu', async ({ page }) => {
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/');
    const abrir = page.getByRole('button', { name: new RegExp(`ver resumo: ${atribuido.titulo}`, 'i') });
    await abrir.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fechar resumo' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(abrir).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });

  test('"Abrir chamado completo" leva à tela do chamado', async ({ page }) => {
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/');
    await page.getByRole('button', { name: new RegExp(`ver resumo: ${atribuido.titulo}`, 'i') }).click();
    await page.getByRole('link', { name: 'Abrir chamado completo' }).click();

    await expect(page).toHaveURL(new RegExp(`/chamados/${atribuido.id}$`));
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('o painel cabe na tela e a lista não transborda, no desktop e no celular', async ({ page }) => {
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/');
    await page.waitForTimeout(1500);
    await conferirQueCabeNaTela(page, expect);

    await page.getByRole('button', { name: new RegExp(`ver resumo: ${atribuido.titulo}`, 'i') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect
      .poll(() => page.getByRole('dialog').evaluate((el) => getComputedStyle(el).transform), { timeout: 4000 })
      .toBe('none');
    const larguraDoPainel = await page.getByRole('dialog').evaluate((el) => el.getBoundingClientRect().width);
    expect(larguraDoPainel).toBeLessThanOrEqual(page.viewportSize().width);
    await expect(page.getByRole('link', { name: 'Abrir chamado completo' })).toBeVisible();
  });
});

test.describe('Fase 3: gráfico de chamados por dia', () => {
  test.use({ reducedMotion: 'no-preference' });

  const FUSO = 'America/Sao_Paulo';
  const diaNoFuso = (deslocamento = 0) => {
    const d = new Date(Date.now() + deslocamento * 86_400_000);
    return d.toLocaleDateString('en-CA', { timeZone: FUSO });
  };

  let periodo;
  let esperado;

  test.beforeAll(async () => {
    // Um chamado concluído hoje: sem ele a série "concluídos" seria zero e o teste
    // não distinguiria a linha certa de uma linha chapada.
    const concluido = await cenario.abrirChamado({ titulo: `Concluído da série ${cenario.marca}` });
    await cenario.atribuir(concluido.id);
    await cenario.concluir(concluido.id);

    periodo = { de: diaNoFuso(-3), ate: diaNoFuso(0) };
    const { corpo } = await cenario.pessoas.gestor.get(
      `/relatorios/serie?de=${periodo.de}&ate=${periodo.ate}`
    );
    esperado = corpo;
  });

  async function abrirRelatorioNoPeriodo(page) {
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/relatorios');
    const datas = page.locator('input[type="date"]');
    await datas.nth(0).fill(periodo.de);
    await datas.nth(1).fill(periodo.ate);
    const grupo = page.getByRole('group', { name: /chamados abertos e concluídos por dia/i });
    await expect(grupo).toBeVisible();
    // No celular o gráfico fica abaixo da dobra: `mouse.move` para fora da janela não
    // gera evento nenhum, e o teste falharia por posição, não por defeito.
    await grupo.scrollIntoViewIfNeeded();
    return grupo;
  }

  test('o gráfico revela a linha da esquerda para a direita', async ({ page }) => {
    await page.addInitScript(() => {
      window.__revelacao = [];
      const laco = () => {
        const r = document.querySelector('clipPath rect');
        if (r) window.__revelacao.push(Number(r.getAttribute('width')));
        requestAnimationFrame(laco);
      };
      requestAnimationFrame(laco);
    });
    const grupo = await abrirRelatorioNoPeriodo(page);
    await page.waitForTimeout(1600);

    const larguras = await page.evaluate(() => window.__revelacao);
    const final = larguras[larguras.length - 1];
    // Termina EXATAMENTE na largura do gráfico. "Maior que 200" deixou passar um
    // defeito em que a revelação parava na metade (alvo capturado antes da medição).
    const larguraDoSvg = Number(await grupo.locator('svg').getAttribute('width'));
    expect(larguraDoSvg).toBeGreaterThan(200);
    expect(final).toBe(larguraDoSvg);
    // Passa por larguras intermediárias, e termina na inteira.
    expect(larguras.some((w) => w > 0 && w < final * 0.9)).toBe(true);
    expect(Math.min(...larguras)).toBeLessThan(final * 0.5);
    await expect(grupo.locator('svg')).toBeVisible();
  });

  test('o dia sob o mouse mostra os mesmos números que a API', async ({ page }) => {
    const grupo = await abrirRelatorioNoPeriodo(page);
    await page.waitForTimeout(1500);

    const caixa = await grupo.boundingBox();
    // A borda direita da área útil é o último dia do período (hoje).
    await page.mouse.move(caixa.x + caixa.width - 14, caixa.y + caixa.height / 2);

    const ultimo = esperado.dias[esperado.dias.length - 1];
    const dica = page.locator('[data-dica]');
    await expect(dica).toBeVisible();
    await expect(dica).toContainText(new RegExp(`Abertos:\\s*${ultimo.abertos}`));
    await expect(dica).toContainText(new RegExp(`Concluídos:\\s*${ultimo.concluidos}`));
    // Hoje há pelo menos um concluído e vários abertos: o teste não passa por zeros.
    expect(ultimo.abertos).toBeGreaterThan(0);
    expect(ultimo.concluidos).toBeGreaterThan(0);

    await page.mouse.move(caixa.x - 40, caixa.y - 40);
    await expect(dica).toHaveCount(0);
  });

  test('pelo teclado, as setas percorrem os dias e o leitor de tela é avisado', async ({ page }) => {
    const grupo = await abrirRelatorioNoPeriodo(page);
    await grupo.focus();

    await page.keyboard.press('End');
    const ultimo = esperado.dias[esperado.dias.length - 1];
    const anterior = esperado.dias[esperado.dias.length - 2];
    await expect(grupo.getByRole('status')).toContainText(`${ultimo.abertos} abertos, ${ultimo.concluidos} concluídos`);

    await page.keyboard.press('ArrowLeft');
    await expect(grupo.getByRole('status')).toContainText(`${anterior.abertos} abertos, ${anterior.concluidos} concluídos`);

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-dica]')).toHaveCount(0);
  });

  test('o gráfico cabe na tela, no desktop e no celular, e a dica não sai dela', async ({ page }) => {
    const grupo = await abrirRelatorioNoPeriodo(page);
    await page.waitForTimeout(1500);
    await conferirQueCabeNaTela(page, expect);

    const caixa = await grupo.boundingBox();
    expect(caixa.width).toBeLessThanOrEqual(page.viewportSize().width);

    // Dica no extremo direito: abre para a esquerda do ponto e continua visível.
    await page.mouse.move(caixa.x + caixa.width - 14, caixa.y + caixa.height / 2);
    const dica = page.locator('[data-dica]');
    await expect(dica).toBeVisible();
    const d = await dica.boundingBox();
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.x + d.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  });
});

test.describe('Fase 3 com movimento reduzido', () => {
  test.use({ reducedMotion: 'reduce' });

  test('o gráfico aparece inteiro, sem revelação', async ({ page }) => {
    await page.addInitScript(() => {
      window.__revelacao = [];
      const laco = () => {
        const r = document.querySelector('clipPath rect');
        if (r) window.__revelacao.push(Number(r.getAttribute('width')));
        requestAnimationFrame(laco);
      };
      requestAnimationFrame(laco);
    });
    await entrar(page, cenario.pessoas.gestor);
    await page.goto('/relatorios');
    await expect(page.getByRole('group', { name: /por dia/i })).toBeVisible();
    await page.waitForTimeout(600);

    const larguras = await page.evaluate(() => window.__revelacao);
    expect(larguras.length).toBeGreaterThan(0);
    // Todas as amostras já estão na largura final: nunca houve quadro parcial.
    expect(new Set(larguras).size).toBe(1);
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

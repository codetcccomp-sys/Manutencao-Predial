import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GraficoDeLinhas, { escalaVertical } from '../src/components/ui/GraficoDeLinhas';

/**
 * O gráfico é a única peça visual do sistema que não se entende por texto: se a
 * escala errar, se o teclado não alcançar os dias ou se o dia ativo mostrar o
 * número do vizinho, a gestão decide em cima de um desenho que mente.
 */

const SERIES = [
  { chave: 'abertos', rotulo: 'Abertos', cor: 'navy' },
  { chave: 'concluidos', rotulo: 'Concluídos', cor: 'sucesso' },
];

const DIAS = [
  { dia: '2026-10-01', abertos: 2, concluidos: 0 },
  { dia: '2026-10-02', abertos: 5, concluidos: 1 },
  { dia: '2026-10-03', abertos: 0, concluidos: 3 },
  { dia: '2026-10-04', abertos: 4, concluidos: 2 },
  { dia: '2026-10-05', abertos: 1, concluidos: 4 },
];

const grupo = () => screen.getByRole('group');
const dica = () => document.querySelector('[data-dica]');

afterEach(() => {
  vi.restoreAllMocks();
  delete window.matchMedia;
});

describe('escalaVertical', () => {
  it('usa degraus inteiros e cobre o maior valor', () => {
    expect(escalaVertical(7)).toEqual({ topo: 8, marcas: [0, 2, 4, 6, 8] });
    expect(escalaVertical(37)).toEqual({ topo: 40, marcas: [0, 10, 20, 30, 40] });
    expect(escalaVertical(4)).toEqual({ topo: 4, marcas: [0, 1, 2, 3, 4] });
  });

  it('nunca devolve um eixo sem altura, nem com tudo zerado', () => {
    const { topo, marcas } = escalaVertical(0);
    expect(topo).toBeGreaterThan(0);
    expect(marcas.length).toBeGreaterThan(1);
  });

  it('o topo sempre alcança o maior valor', () => {
    for (const maximo of [1, 3, 9, 11, 26, 51, 99, 101, 480, 4999, 12000]) {
      expect(escalaVertical(maximo).topo).toBeGreaterThanOrEqual(maximo);
    }
  });
});

describe('GraficoDeLinhas', () => {
  it('descreve o gráfico em texto, com o período e os totais', () => {
    render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="Chamados por dia" />);

    const rotulo = grupo().getAttribute('aria-label');
    expect(rotulo).toMatch(/Chamados por dia/);
    expect(rotulo).toMatch(/12 abertos/);
    expect(rotulo).toMatch(/10 concluídos/);
    expect(rotulo).toMatch(/setas/i);
  });

  it('mostra a legenda com o total de cada série', () => {
    render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="t" />);
    expect(screen.getByText(/Abertos:/).textContent).toMatch(/12/);
    expect(screen.getByText(/Concluídos:/).textContent).toMatch(/10/);
  });

  it('desenha uma linha por série e a área sob a primeira', () => {
    const { container } = render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="t" />);
    expect(container.querySelectorAll('svg path').length).toBe(3);
  });

  it('o SVG é decorativo para leitor de tela', () => {
    const { container } = render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="t" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('sem nenhum chamado no período, diz isso em vez de desenhar uma reta no zero', () => {
    const zerados = DIAS.map((d) => ({ ...d, abertos: 0, concluidos: 0 }));
    const { container } = render(<GraficoDeLinhas dias={zerados} series={SERIES} titulo="t" />);

    expect(screen.getByText('Nenhum chamado neste período.')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('lista vazia também cai no aviso', () => {
    render(<GraficoDeLinhas dias={[]} series={SERIES} titulo="t" />);
    expect(screen.getByText('Nenhum chamado neste período.')).toBeInTheDocument();
  });

  it('um único dia desenha um ponto, e não uma linha que não existe', () => {
    const { container } = render(
      <GraficoDeLinhas dias={[{ dia: '2026-10-01', abertos: 3, concluidos: 1 }]} series={SERIES} titulo="t" />
    );
    expect(container.querySelectorAll('svg path').length).toBe(0);
    expect(container.querySelectorAll('svg circle').length).toBe(2);
  });
});

describe('Teclado', () => {
  it('as setas percorrem os dias e mostram o número certo de cada um', async () => {
    render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="t" />);
    await userEvent.tab();
    expect(grupo()).toHaveFocus();
    expect(dica()).toBeNull();

    // Da esquerda sem dia ativo, vai para o último dia.
    await userEvent.keyboard('{ArrowLeft}');
    expect(dica().textContent).toMatch(/Abertos:\s*1/);
    expect(dica().textContent).toMatch(/Concluídos:\s*4/);

    await userEvent.keyboard('{ArrowLeft}');
    expect(dica().textContent).toMatch(/Abertos:\s*4/);
    expect(dica().textContent).toMatch(/Concluídos:\s*2/);

    await userEvent.keyboard('{Home}');
    expect(dica().textContent).toMatch(/Abertos:\s*2/);

    await userEvent.keyboard('{End}');
    expect(dica().textContent).toMatch(/Concluídos:\s*4/);
  });

  it('não passa dos extremos', async () => {
    render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="t" />);
    await userEvent.tab();

    await userEvent.keyboard('{Home}{ArrowLeft}{ArrowLeft}');
    expect(dica().textContent).toMatch(/Abertos:\s*2/);

    await userEvent.keyboard('{End}{ArrowRight}{ArrowRight}');
    expect(dica().textContent).toMatch(/Abertos:\s*1/);
  });

  it('anuncia o dia ativo na região ao vivo, só quando o teclado o muda', async () => {
    render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="t" />);
    expect(screen.getByRole('status')).toHaveTextContent('');

    await userEvent.tab();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('status')).toHaveTextContent(/1 abertos, 4 concluídos/);
  });

  it('Esc e sair do gráfico escondem a dica', async () => {
    render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="t" />);
    await userEvent.tab();
    await userEvent.keyboard('{End}');
    expect(dica()).not.toBeNull();

    await userEvent.keyboard('{Escape}');
    expect(dica()).toBeNull();

    await userEvent.keyboard('{End}');
    await userEvent.tab();
    expect(dica()).toBeNull();
  });
});

describe('Ponteiro', () => {
  function comLargura640() {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 640, bottom: 240, width: 640, height: 240, x: 0, y: 0,
    });
  }

  it('o dia sob o mouse é o que a dica mostra', () => {
    comLargura640();
    render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="t" />);

    // Área útil de 34 a 626; o meio dela (330) é o terceiro de cinco dias.
    fireEvent.pointerMove(grupo(), { clientX: 330, pointerType: 'mouse' });
    expect(dica().textContent).toMatch(/Abertos:\s*0/);
    expect(dica().textContent).toMatch(/Concluídos:\s*3/);

    fireEvent.pointerMove(grupo(), { clientX: 34, pointerType: 'mouse' });
    expect(dica().textContent).toMatch(/Abertos:\s*2/);

    fireEvent.pointerMove(grupo(), { clientX: 626, pointerType: 'mouse' });
    expect(dica().textContent).toMatch(/Abertos:\s*1/);
  });

  it('entre dois dias, escolhe o mais próximo (a margem do eixo entra na conta)', () => {
    comLargura640();
    render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="t" />);

    // Dias a 34, 182, 330, 478 e 626. O meio entre o 1º e o 2º é 108: aquém dele o mais
    // próximo é o 1º, além dele é o 2º. Sem descontar a margem de 34px, 104 viraria o 2º.
    fireEvent.pointerMove(grupo(), { clientX: 104, pointerType: 'mouse' });
    expect(dica().textContent).toMatch(/Abertos:\s*2/);

    fireEvent.pointerMove(grupo(), { clientX: 112, pointerType: 'mouse' });
    expect(dica().textContent).toMatch(/Abertos:\s*5/);
  });

  it('fora da área, escolhe o extremo mais próximo em vez de sair dos dados', () => {
    comLargura640();
    render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="t" />);

    fireEvent.pointerMove(grupo(), { clientX: -50, pointerType: 'mouse' });
    expect(dica().textContent).toMatch(/Abertos:\s*2/);

    fireEvent.pointerMove(grupo(), { clientX: 5000, pointerType: 'mouse' });
    expect(dica().textContent).toMatch(/Abertos:\s*1/);
  });

  it('o mouse que sai esconde a dica; o toque que levanta o dedo não', () => {
    comLargura640();
    render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="t" />);

    fireEvent.pointerMove(grupo(), { clientX: 330, pointerType: 'mouse' });
    fireEvent.pointerLeave(grupo(), { pointerType: 'mouse' });
    expect(dica()).toBeNull();

    fireEvent.pointerDown(grupo(), { clientX: 330, pointerType: 'touch' });
    fireEvent.pointerLeave(grupo(), { pointerType: 'touch' });
    expect(dica()).not.toBeNull();
  });
});

describe('Animação de revelação', () => {
  const recorte = (c) => c.querySelector('clipPath rect');

  it('sem movimento, o gráfico nasce inteiro', () => {
    const { container } = render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="t" />);
    expect(recorte(container).getAttribute('width')).toBe('640');
  });

  it('com movimento, começa fechado e revela até a largura inteira', async () => {
    window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
    const { container } = render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="t" />);

    expect(Number(recorte(container).getAttribute('width'))).toBeLessThan(640);
    await waitFor(() => expect(Number(recorte(container).getAttribute('width'))).toBe(640), { timeout: 3000 });
  });

  it('termina na largura MEDIDA, mesmo quando ela chega depois do primeiro quadro', async () => {
    // O gráfico nasce com 640 e mede a largura real logo em seguida. Uma animação que
    // fixasse o alvo no primeiro quadro pararia em 640 de 900: a metade direita do
    // gráfico nunca seria revelada.
    window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 900, bottom: 240, width: 900, height: 240, x: 0, y: 0,
    });
    const { container } = render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="t" />);

    // Espera a animação ACABAR (1s) antes de olhar. Com o defeito, o primeiro quadro já
    // mostra 900 (o React escreve a largura nova) e só depois o GSAP puxa o valor de
    // volta para 640: um `waitFor` voltaria no primeiro quadro e daria o teste por bom.
    await new Promise((ok) => setTimeout(ok, 1400));

    expect(container.querySelector('svg').getAttribute('width')).toBe('900');
    expect(recorte(container).getAttribute('width')).toBe('900');
  });

  it('quem pediu menos movimento recebe o gráfico inteiro, mesmo com matchMedia', () => {
    window.matchMedia = (q) => ({ matches: q.includes('reduced-motion'), media: q, addEventListener() {}, removeEventListener() {} });
    const { container } = render(<GraficoDeLinhas dias={DIAS} series={SERIES} titulo="t" />);
    expect(recorte(container).getAttribute('width')).toBe('640');
  });
});

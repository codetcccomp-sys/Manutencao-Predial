import { useRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useListaAnimada } from '../src/animacao/useListaAnimada';

/**
 * O jsdom não tem layout: `getBoundingClientRect` devolve tudo zero, e sem
 * posições não há o que comparar. Aqui cada item declara onde "está" por
 * `data-topo`, e a medição é simulada a partir disso — o que se testa é a
 * decisão do hook (quem entra, quem desliza, quem fica), não o motor de layout.
 */
const original = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  Element.prototype.getBoundingClientRect = function medir() {
    const topo = Number(this.dataset?.topo ?? 0);
    return { left: 0, top: topo, right: 0, bottom: topo, width: 0, height: 0, x: 0, y: topo };
  };
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = original;
  delete window.matchMedia;
});

function preferenciaDoSistema(reduzir) {
  window.matchMedia = (consulta) => ({
    matches: reduzir && consulta.includes('prefers-reduced-motion'),
    media: consulta,
    addEventListener() {},
    removeEventListener() {},
  });
}

function Lista({ itens }) {
  const ref = useRef(null);
  useListaAnimada(ref, [itens]);
  return (
    <ul ref={ref}>
      {itens.map(({ id, topo }) => (
        <li key={id} data-flip={id} data-topo={topo} data-testid={`item-${id}`}>
          {id}
        </li>
      ))}
    </ul>
  );
}

const item = (id) => screen.getByTestId(`item-${id}`);
const ESTILO_LIMPO = (el) => el.style.opacity === '' && el.style.transform === '';

async function assentar(...ids) {
  await waitFor(() => ids.forEach((id) => expect(ESTILO_LIMPO(item(id))).toBe(true)), { timeout: 3000 });
}

describe('useListaAnimada', () => {
  it('na primeira carga todos entram: começam invisíveis e terminam sem estilo residual', async () => {
    preferenciaDoSistema(false);
    render(<Lista itens={[{ id: 'a', topo: 0 }, { id: 'b', topo: 50 }]} />);

    expect(item('a').style.opacity).toBe('0');
    expect(item('b').style.opacity).toBe('0');
    await assentar('a', 'b');
  });

  it('quem continua na lista desliza do lugar antigo para o novo, e quem chega entra', async () => {
    preferenciaDoSistema(false);
    const { rerender } = render(
      <Lista itens={[{ id: 'a', topo: 0 }, { id: 'b', topo: 50 }, { id: 'c', topo: 100 }]} />
    );
    await assentar('a', 'b', 'c');

    // `b` sai; `c` sobe de 100 para 0; `a` desce de 0 para 50; `d` é novo.
    rerender(<Lista itens={[{ id: 'c', topo: 0 }, { id: 'a', topo: 50 }, { id: 'd', topo: 100 }]} />);

    // Começam no lugar ANTIGO, expresso como deslocamento: c estava 100 abaixo,
    // a estava 50 acima. Sem isso o cartão saltaria em vez de deslizar.
    expect(item('c').style.transform).toMatch(/100/);
    expect(item('a').style.transform).toMatch(/-50/);
    // Quem já existia não repete a entrada (não fica invisível).
    expect(item('c').style.opacity).toBe('');
    expect(item('a').style.opacity).toBe('');
    // Quem acabou de chegar entra.
    expect(item('d').style.opacity).toBe('0');

    await assentar('a', 'c', 'd');
  });

  it('o retrato anterior sobrevive ao esqueleto (lista vazia no meio)', async () => {
    preferenciaDoSistema(false);
    const { rerender } = render(<Lista itens={[{ id: 'a', topo: 0 }, { id: 'b', topo: 50 }]} />);
    await assentar('a', 'b');

    // Cada troca de filtro liga "carregando" e troca a lista por um esqueleto.
    rerender(<Lista itens={[]} />);
    rerender(<Lista itens={[{ id: 'b', topo: 0 }]} />);

    // `b` estava em 50 e agora está em 0: tem de deslizar, e não entrar do nada.
    expect(item('b').style.transform).toMatch(/50/);
    expect(item('b').style.opacity).toBe('');
    await assentar('b');
  });

  it('diferença abaixo de 1px é arredondamento, não movimento', async () => {
    preferenciaDoSistema(false);
    const { rerender } = render(<Lista itens={[{ id: 'a', topo: 10 }]} />);
    await assentar('a');

    rerender(<Lista itens={[{ id: 'a', topo: 10.4 }]} />);
    expect(item('a').style.transform).toBe('');
  });

  it('quem pediu menos movimento recebe a lista direto no lugar', () => {
    preferenciaDoSistema(true);
    const { rerender } = render(<Lista itens={[{ id: 'a', topo: 0 }, { id: 'b', topo: 50 }]} />);
    rerender(<Lista itens={[{ id: 'b', topo: 0 }, { id: 'a', topo: 50 }]} />);

    expect(ESTILO_LIMPO(item('a'))).toBe(true);
    expect(ESTILO_LIMPO(item('b'))).toBe(true);
  });

  it('lista vazia não quebra', () => {
    preferenciaDoSistema(false);
    expect(() => render(<Lista itens={[]} />)).not.toThrow();
  });
});

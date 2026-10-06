import { useRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import NumeroAnimado from '../src/animacao/NumeroAnimado';
import { useEntrada } from '../src/animacao/useEntrada';
import { reduzMovimento } from '../src/animacao/movimento';

/**
 * O jsdom não tem `matchMedia`, e `reduzMovimento` trata isso como "sem
 * movimento": o valor final aparece no primeiro quadro. Por isso os testes de
 * animação simulam a preferência do sistema, nos dois sentidos.
 */
function preferenciaDoSistema(reduzir) {
  window.matchMedia = (consulta) => ({
    matches: reduzir && consulta.includes('prefers-reduced-motion'),
    media: consulta,
    addEventListener() {},
    removeEventListener() {},
  });
}

afterEach(() => {
  delete window.matchMedia;
});

describe('reduzMovimento', () => {
  it('sem matchMedia (jsdom), não anima', () => {
    expect(reduzMovimento()).toBe(true);
  });

  it('obedece à preferência do sistema', () => {
    preferenciaDoSistema(true);
    expect(reduzMovimento()).toBe(true);
    preferenciaDoSistema(false);
    expect(reduzMovimento()).toBe(false);
  });
});

describe('NumeroAnimado', () => {
  it('sem movimento, mostra o valor final no primeiro quadro', () => {
    render(<NumeroAnimado valor={25} />);
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('quem pediu menos movimento recebe o valor final, mesmo com matchMedia', () => {
    preferenciaDoSistema(true);
    render(<NumeroAnimado valor={25} />);
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('com movimento, começa em 0 e chega ao valor final', async () => {
    preferenciaDoSistema(false);
    const { container } = render(<NumeroAnimado valor={50} duracao={0.15} />);

    // O primeiro quadro é o 0: sem isso a "contagem" seria só o número parado.
    expect(container.textContent).toBe('0');
    await waitFor(() => expect(container.textContent).toBe('50'), { timeout: 2000 });
  });

  it('um valor novo parte do que estava na tela, não de zero', async () => {
    preferenciaDoSistema(false);
    const { container, rerender } = render(<NumeroAnimado valor={24} duracao={0.1} />);
    await waitFor(() => expect(container.textContent).toBe('24'), { timeout: 2000 });

    rerender(<NumeroAnimado valor={25} duracao={0.1} />);
    // Logo depois da troca o número ainda é o antigo (ou já o novo), nunca 0.
    expect(['24', '25']).toContain(container.textContent);
    await waitFor(() => expect(container.textContent).toBe('25'), { timeout: 2000 });
  });

  it('formata no padrão brasileiro', () => {
    render(<NumeroAnimado valor={12345} />);
    expect(screen.getByText('12.345')).toBeInTheDocument();
  });

  it('valor que não é número cai em 0 em vez de mostrar NaN', () => {
    render(<NumeroAnimado valor={undefined} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

function Lista({ itens }) {
  const ref = useRef(null);
  useEntrada(ref, [itens]);
  return (
    <ul ref={ref}>
      {itens.map((i) => (
        <li key={i} data-anim data-testid={`item-${i}`}>
          {i}
        </li>
      ))}
    </ul>
  );
}

describe('useEntrada', () => {
  it('sem movimento, não mexe no estilo dos itens', () => {
    render(<Lista itens={[1, 2, 3]} />);
    expect(screen.getByTestId('item-1').style.opacity).toBe('');
    expect(screen.getByTestId('item-1').style.filter).toBe('');
  });

  it('com movimento, os itens começam invisíveis e terminam sem estilo residual', async () => {
    preferenciaDoSistema(false);
    render(<Lista itens={[1, 2]} />);

    // Antes do primeiro quadro pintado o item já está escondido: sem isso ele
    // apareceria inteiro por um instante e sumiria para então entrar.
    expect(screen.getByTestId('item-1').style.opacity).toBe('0');

    // No fim o estilo inline sai: um `filter` ou `transform` residual criaria um
    // bloco de contenção e prenderia `position: fixed` ao item.
    await waitFor(
      () => {
        const item = screen.getByTestId('item-1');
        expect(item.style.opacity).toBe('');
        expect(item.style.filter).toBe('');
        expect(item.style.transform).toBe('');
      },
      { timeout: 3000 }
    );
  });

  it('lista vazia não quebra', () => {
    preferenciaDoSistema(false);
    expect(() => render(<Lista itens={[]} />)).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import CabecalhoDePagina from '../src/components/ui/CabecalhoDePagina.jsx';

describe('CabecalhoDePagina', () => {
  it('a margem que a tela passa substitui a padrão, em vez de somar com ela', () => {
    render(<CabecalhoDePagina titulo="Cadastros" className="mb-0" />);
    const caixa = screen.getByRole('heading', { level: 1 }).parentElement.parentElement;

    expect(caixa.className).toContain('mb-0');
    expect(caixa.className).not.toContain('mb-6');
  });

  it('sem margem informada, afasta o conteúdo como antes', () => {
    render(<CabecalhoDePagina titulo="Chamados" />);
    const caixa = screen.getByRole('heading', { level: 1 }).parentElement.parentElement;

    expect(caixa.className).toContain('mb-6');
  });
});

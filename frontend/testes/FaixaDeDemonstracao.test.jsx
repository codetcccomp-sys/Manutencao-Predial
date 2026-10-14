import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: {}, headers: {} }), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ usuario: { id: 4, nome: 'Davi', perfil: 'solicitante' }, logout: vi.fn() }),
}));
vi.mock('../src/components/Avisos', () => ({ default: () => null }));

import Layout from '../src/components/Layout';

/**
 * A faixa da demonstração publicada. O valor vem da variável da build
 * (VITE_AMBIENTE): só o projeto da Vercel da demonstração a define, e a
 * produção nunca pode mostrá-la.
 */

const abrir = () =>
  render(
    <MemoryRouter>
      <Layout />
    </MemoryRouter>
  );

afterEach(() => vi.unstubAllEnvs());

describe('Faixa de demonstração', () => {
  it('na demonstração, avisa em toda tela que os dados são fictícios', () => {
    vi.stubEnv('VITE_AMBIENTE', 'demonstracao');
    abrir();

    const faixa = screen.getByRole('note');
    expect(faixa).toHaveTextContent(/ambiente de demonstração/i);
    expect(faixa).toHaveTextContent(/fictícios/i);
  });

  it('sem a variável (a produção), não aparece', () => {
    vi.stubEnv('VITE_AMBIENTE', '');
    abrir();

    expect(screen.queryByRole('note')).toBeNull();
  });

  it('qualquer outro valor também não liga a faixa', () => {
    vi.stubEnv('VITE_AMBIENTE', 'producao');
    abrir();

    expect(screen.queryByRole('note')).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../src/api/client', async () => {
  const real = await vi.importActual('../src/api/client');
  return { ...real, default: { get: vi.fn().mockResolvedValue({ data: { client_id: null } }), post: vi.fn(), patch: vi.fn() } };
});

import { AuthProvider } from '../src/context/AuthContext';
import Login from '../src/pages/Login';
import Cadastro from '../src/pages/Cadastro';
import RecuperarSenha from '../src/pages/RecuperarSenha';
import RedefinirSenha from '../src/pages/RedefinirSenha';

/**
 * As telas de fora do login têm a área principal marcada.
 *
 * Sem <main>, quem navega por regiões (leitor de tela, atalho de teclado) não
 * tem para onde pular, e o axe aponta a falta da região. O Login era assim; as
 * outras três telas de entrada seguiam o mesmo molde.
 */
const TELAS = [
  ['Entrar', Login, '/login'],
  ['Criar conta', Cadastro, '/cadastro'],
  ['Recuperar senha', RecuperarSenha, '/recuperar-senha'],
  ['Redefinir senha', RedefinirSenha, '/redefinir-senha?token=abc'],
];

describe('Área principal das telas de entrada', () => {
  it.each(TELAS)('%s tem exatamente um <main>', (_nome, Tela, caminho) => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={[caminho]}>
          <Tela />
        </MemoryRouter>
      </AuthProvider>
    );

    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});

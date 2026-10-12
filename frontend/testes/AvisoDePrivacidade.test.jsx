import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../src/api/client', async () => {
  const real = await vi.importActual('../src/api/client');
  return {
    ...real,
    default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

import api from '../src/api/client';
import { AuthProvider } from '../src/context/AuthContext';
import Cadastro from '../src/pages/Cadastro';
import Login from '../src/pages/Login';
import MinhaConta from '../src/pages/MinhaConta';

/**
 * Onde o aviso de privacidade é apontado.
 *
 * Três portas, porque há três momentos em que a pessoa entrega ou revê seus dados:
 * o cadastro (antes de entregar), a tela de entrada (por onde entra quem cria a conta
 * pelo Google, sem nunca ver o cadastro) e a conta (para quem já está dentro).
 * Em todas, em outra aba: quem já digitou o formulário não pode perdê-lo.
 */

const USUARIO = { id: 1, nome: 'Ana', email: 'ana@exemplo.com', perfil: 'solicitante' };

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset();
  api.get.mockResolvedValue({ data: { client_id: null, ativo: false, codigos_restantes: 0 } });
});

function emOutraAba(link) {
  expect(link).toHaveAttribute('href', '/privacidade');
  expect(link).toHaveAttribute('target', '_blank');
  // Sem `noopener`, a aba aberta teria acesso à janela de origem.
  expect(link.getAttribute('rel')).toMatch(/noopener/);
}

describe('Aviso de privacidade apontado nas telas', () => {
  it('no cadastro: antes do botão que entrega os dados, com o que será guardado', () => {
    render(
      <AuthProvider>
        <MemoryRouter>
          <Cadastro />
        </MemoryRouter>
      </AuthProvider>
    );

    const link = screen.getByRole('link', { name: 'aviso de privacidade (abre em outra aba)' });
    emOutraAba(link);
    expect(screen.getByText(/Guardamos seu nome, seu e-mail e o que você escrever nos chamados/)).toBeInTheDocument();

    // O aviso vem ANTES do botão: depois dele, a pessoa já teria cadastrado.
    const botao = screen.getByRole('button', { name: 'Cadastrar' });
    expect(link.compareDocumentPosition(botao) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('na entrada: um link que cobre também quem cria a conta pelo Google', () => {
    render(
      <AuthProvider>
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      </AuthProvider>
    );

    emOutraAba(screen.getByRole('link', { name: 'Aviso de privacidade (abre em outra aba)' }));
  });

  it('na conta: para quem já está dentro', async () => {
    localStorage.setItem('smp_usuario', JSON.stringify(USUARIO));
    render(
      <AuthProvider>
        <MemoryRouter>
          <MinhaConta />
        </MemoryRouter>
      </AuthProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Seus dados' })).toBeInTheDocument();
    emOutraAba(screen.getByRole('link', { name: 'Ler o aviso de privacidade (abre em outra aba)' }));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../src/api/client', async () => {
  const real = await vi.importActual('../src/api/client');
  return { ...real, default: { get: vi.fn(), post: vi.fn() } };
});

import api from '../src/api/client';
import { AuthProvider } from '../src/context/AuthContext';
import Login from '../src/pages/Login';

/**
 * Entrar com Google, pela tela. O Google de verdade não roda aqui: o teste
 * põe no lugar o objeto que o script do Google cria (`google.accounts.id`) e
 * guarda a função que o botão chamaria com a credencial.
 */

let devolverCredencial;
const googleFalso = {
  accounts: {
    id: {
      initialize: vi.fn(({ callback }) => {
        devolverCredencial = callback;
      }),
      renderButton: vi.fn((lugar) => {
        lugar.textContent = 'Fazer login com o Google';
      }),
    },
  },
};

function abrir() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { de: '/chamados/novo' } }]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/chamados/novo" element={<p>Formulário</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

const USUARIO = { id: 3, nome: 'Rita', email: 'rita@gmail.com', perfil: 'solicitante' };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  devolverCredencial = undefined;
  window.google = googleFalso;
});

afterEach(() => {
  delete window.google;
  document.head.querySelectorAll('script[src*="accounts.google.com"]').forEach((s) => s.remove());
});

describe('Botão do Google', () => {
  it('sem o ID do cliente no servidor, não aparece e o script do Google nem é pedido', async () => {
    delete window.google;
    api.get.mockResolvedValue({ data: { client_id: null } });
    abrir();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/google'));
    expect(screen.queryByTestId('botao-google')).not.toBeInTheDocument();
    expect(document.head.querySelector('script[src*="accounts.google.com"]')).toBeNull();
  });

  it('com o ID, carrega o botão com ele', async () => {
    api.get.mockResolvedValue({ data: { client_id: 'abc.apps.googleusercontent.com' } });
    abrir();
    expect(await screen.findByText('Fazer login com o Google')).toBeInTheDocument();
    expect(googleFalso.accounts.id.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 'abc.apps.googleusercontent.com', ux_mode: 'popup' })
    );
  });

  it('a credencial vai ao servidor e, com a conta pronta, entra e volta para onde ia', async () => {
    api.get.mockResolvedValue({ data: { client_id: 'abc' } });
    api.post.mockResolvedValue({ data: { token: 't', usuario: USUARIO } });
    abrir();
    await screen.findByText('Fazer login com o Google');

    await act(async () => devolverCredencial({ credential: 'credencial-do-google' }));
    expect(api.post).toHaveBeenCalledWith('/auth/google', { credencial: 'credencial-do-google' });
    expect(await screen.findByText('Formulário')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('smp_usuario'))).toEqual(USUARIO);
  });

  it('conta nova com a aprovação ligada: avisa que espera a gestão e não entra', async () => {
    api.get.mockResolvedValue({ data: { client_id: 'abc' } });
    api.post.mockResolvedValue({ data: { aguardando_aprovacao: true } });
    abrir();
    await screen.findByText('Fazer login com o Google');

    await act(async () => devolverCredencial({ credential: 'c' }));
    expect(await screen.findByText(/aguarda a aprovação da gestão/)).toBeInTheDocument();
    expect(screen.queryByText('Formulário')).not.toBeInTheDocument();
    expect(localStorage.getItem('smp_usuario')).toBeNull();
  });

  it('com duas etapas ligadas, pede o código como no login por senha', async () => {
    api.get.mockResolvedValue({ data: { client_id: 'abc' } });
    api.post.mockResolvedValue({ data: { requer_2fa: true, desafio: 'd-1' } });
    abrir();
    await screen.findByText('Fazer login com o Google');

    await act(async () => devolverCredencial({ credential: 'c' }));
    expect(await screen.findByLabelText('Código')).toBeInTheDocument();
    expect(localStorage.getItem('smp_usuario')).toBeNull();
  });

  it('a recusa do servidor aparece na tela', async () => {
    api.get.mockResolvedValue({ data: { client_id: 'abc' } });
    api.post.mockRejectedValue({
      response: { data: { erro: { mensagem: 'O Google não confirma este e-mail como seu. Entre com e-mail e senha.' } } },
    });
    abrir();
    await screen.findByText('Fazer login com o Google');

    await act(async () => devolverCredencial({ credential: 'c' }));
    expect(await screen.findByText(/não confirma este e-mail/)).toBeInTheDocument();
  });
});

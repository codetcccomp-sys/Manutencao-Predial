import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

vi.mock('../src/api/client', async () => {
  const real = await vi.importActual('../src/api/client');
  return { ...real, default: { get: vi.fn(), post: vi.fn(() => Promise.resolve({ data: {} })) } };
});

import { AuthProvider, useAuth } from '../src/context/AuthContext';
import RotaProtegida from '../src/components/RotaProtegida';

function EstadoDoLogin() {
  return <p>login, volta para: {useLocation().state?.de ?? 'nenhum lugar'}</p>;
}

function BotaoSair() {
  const { logout } = useAuth();
  return <button onClick={logout}>Sair</button>;
}

function abrir(caminho) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route path="/login" element={<EstadoDoLogin />} />
          <Route path="/chamados/:id" element={<RotaProtegida><BotaoSair /></RotaProtegida>} />
          <Route path="/chamados/novo" element={<RotaProtegida><p>formulário</p></RotaProtegida>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

beforeEach(() => localStorage.clear());

describe('RotaProtegida', () => {
  it('sem sessão, o login guarda o endereço pedido (o QR Code volta ao formulário)', () => {
    abrir('/chamados/novo?equipamento=BOMBA-01');
    expect(screen.getByText('login, volta para: /chamados/novo?equipamento=BOMBA-01')).toBeInTheDocument();
  });

  it('quem clica em Sair não deixa o endereço para o próximo que entrar no aparelho', async () => {
    localStorage.setItem('smp_usuario', JSON.stringify({ id: 1, nome: 'Jorge', perfil: 'solicitante' }));
    abrir('/chamados/42');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sair' }));
    expect(screen.getByText('login, volta para: nenhum lugar')).toBeInTheDocument();
  });
});

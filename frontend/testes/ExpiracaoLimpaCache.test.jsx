import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('../src/api/client', async () => {
  const real = await vi.importActual('../src/api/client');
  return { ...real, default: { get: vi.fn(), post: vi.fn(() => Promise.resolve({ data: {} })) } };
});
vi.mock('../src/pwa', () => ({ limparDadosOffline: vi.fn() }));

import { EVENTO_SESSAO_EXPIRADA } from '../src/api/client';
import { limparDadosOffline } from '../src/pwa';
import { AuthProvider, useAuth } from '../src/context/AuthContext';

/**
 * Sessão vencida num aparelho compartilhado.
 *
 * O service worker guarda a fila e os chamados da pessoa que estava logada, para
 * o técnico consultá-los sem sinal. O login e o logout já apagam essas leituras;
 * o terceiro caminho é a sessão que vence sozinha (401 de quem tinha sessão).
 * Se ele não apagasse, a fila de quem foi derrubado ficaria no aparelho até
 * alguém entrar — e o aparelho abre sem conexão, sem passar por login nenhum.
 */

function Quem() {
  const { usuario, sessaoExpirada } = useAuth();
  return (
    <p>
      {usuario ? `logado: ${usuario.nome}` : 'sem sessão'}
      {sessaoExpirada ? ' (expirou)' : ''}
    </p>
  );
}

const abrir = () =>
  render(
    <AuthProvider>
      <Quem />
    </AuthProvider>
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('smp_usuario', JSON.stringify({ id: 7, nome: 'Paulo', perfil: 'tecnico' }));
  vi.mocked(limparDadosOffline).mockClear();
});
afterEach(() => localStorage.clear());

describe('Sessão que vence', () => {
  it('apaga as leituras guardadas para uso sem conexão, como o login e o logout', () => {
    abrir();
    expect(screen.getByText('logado: Paulo')).toBeInTheDocument();
    expect(limparDadosOffline).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
    });

    expect(limparDadosOffline).toHaveBeenCalledTimes(1);
  });

  it('derruba a sessão em memória e avisa que expirou', () => {
    abrir();

    act(() => {
      window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
    });

    expect(screen.getByText('sem sessão (expirou)')).toBeInTheDocument();
  });
});

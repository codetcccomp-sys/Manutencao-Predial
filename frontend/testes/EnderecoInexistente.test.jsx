import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: {}, headers: {} }), post: vi.fn(), patch: vi.fn() },
  CHAVE_USUARIO: 'smp_usuario',
  EVENTO_2FA_OBRIGATORIO: 'smp:2fa-obrigatorio',
  EVENTO_SESSAO_EXPIRADA: 'smp:sessao-expirada',
}));
vi.mock('../src/pwa', () => ({ limparDadosOffline: vi.fn(), registrarServiceWorker: vi.fn() }));

import App from '../src/App';

/**
 * O App inteiro, com o roteador de verdade, num endereço que não existe.
 *
 * A página "não encontrada" tem os próprios testes; o que só o App prova é que a
 * rota coringa existe, vem DEPOIS das outras e fica fora do login: com ela dentro
 * da rota protegida, quem digitou um endereço errado e não tem sessão cairia na
 * tela de entrada sem saber o que houve.
 */

beforeEach(() => localStorage.clear());
afterEach(() => window.history.pushState({}, '', '/'));

function abrirEm(caminho) {
  window.history.pushState({}, '', caminho);
  return render(<App />);
}

describe('Endereço que não existe, no App', () => {
  it('sem sessão, mostra a página não encontrada e não manda para o login', async () => {
    abrirEm('/isto-nao-existe');

    expect(await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/isto-nao-existe');
    expect(document.title).toBe('Página não encontrada — Conserva Predial');
  });

  it('endereço que parece de uma tela interna, mas não é, também cai nela', async () => {
    abrirEm('/relatorios/semanal');

    expect(await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeInTheDocument();
  });

  it('as páginas de informação abrem sem sessão', async () => {
    abrirEm('/termos');

    expect(await screen.findByRole('heading', { level: 1, name: 'Termos de uso' })).toBeInTheDocument();
    expect(document.title).toBe('Termos de uso — Conserva Predial');
  });
});

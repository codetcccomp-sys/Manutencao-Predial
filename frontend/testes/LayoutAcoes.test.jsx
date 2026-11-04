import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: {}, headers: {} }), post: vi.fn(), patch: vi.fn() },
}));

const sessao = { usuario: null };
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ usuario: sessao.usuario, logout: vi.fn() }),
}));
vi.mock('../src/components/Avisos', () => ({ default: () => null }));

import Layout from '../src/components/Layout';

/**
 * As ações que ficam à vista em toda tela autenticada: "Novo chamado" no cabeçalho
 * e o rodapé com as páginas de informação.
 */

const abrir = (rota = '/relatorios') =>
  render(
    <MemoryRouter initialEntries={[rota]}>
      <Layout />
    </MemoryRouter>
  );

const novoChamado = () => screen.queryByRole('link', { name: '+ Novo chamado' });

beforeEach(() => {
  sessao.usuario = { id: 1, nome: 'Ana', perfil: 'gestor' };
});

describe('"Novo chamado" no cabeçalho', () => {
  it.each(['solicitante', 'gestor', 'administrador'])('o perfil %s o vê em qualquer tela, e ele leva ao formulário', (perfil) => {
    sessao.usuario = { id: 1, nome: 'Ana', perfil };
    abrir('/conta');

    expect(novoChamado()).toHaveAttribute('href', '/chamados/novo');
  });

  it('o técnico não o vê: a API recusa a abertura para esse perfil', () => {
    sessao.usuario = { id: 2, nome: 'João', perfil: 'tecnico' };
    abrir('/conta');

    expect(novoChamado()).toBeNull();
  });

  it('não repete o botão que a tela inicial e o formulário já têm', () => {
    abrir('/');
    expect(novoChamado()).toBeNull();
  });

  it('nem no próprio formulário de abertura', () => {
    abrir('/chamados/novo');
    expect(novoChamado()).toBeNull();
  });

  it('com a verificação em duas etapas pendente, não leva a uma tela que a API recusa', () => {
    sessao.usuario = { id: 1, nome: 'Ana', perfil: 'gestor', dois_fatores_pendente: true };
    abrir('/conta');

    expect(novoChamado()).toBeNull();
  });
});

describe('Rodapé das telas autenticadas', () => {
  it('leva às quatro páginas de informação', () => {
    abrir('/relatorios');
    const rodape = screen.getByRole('navigation', { name: 'Informações do sistema' });

    expect(within(rodape).getByRole('link', { name: 'Termos de uso' })).toHaveAttribute('href', '/termos');
    expect(within(rodape).getByRole('link', { name: 'Privacidade' })).toHaveAttribute('href', '/privacidade');
    expect(within(rodape).getByRole('link', { name: 'Cookies e armazenamento' })).toHaveAttribute('href', '/cookies');
    expect(within(rodape).getByRole('link', { name: 'Ajuda e suporte' })).toHaveAttribute('href', '/suporte');
  });

  it('fica fora do papel, como o cabeçalho', () => {
    abrir('/relatorios');

    expect(screen.getByRole('contentinfo').className).toMatch(/print:hidden/);
  });
});

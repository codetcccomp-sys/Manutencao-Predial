import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn() },
}));

import api from '../src/api/client';
import ErrosDoSistema from '../src/components/ErrosDoSistema';

/**
 * Os erros de servidor guardados, na tela do administrador.
 *
 * Na Vercel Hobby os logs de execução duram 1 hora; sem esta lista, um erro das 2h
 * da manhã não existia mais às 9h. A tela fica recolhida e só consulta ao abrir.
 */

const ERRO = {
  id: 7,
  ocorrido_em: '2026-10-21T22:40:00Z',
  metodo: 'POST',
  rota: '/auth/login',
  status: 500,
  codigo: null,
  mensagem: 'banco caiu',
  pilha: '    at login (auth.service.js:10:5)',
};

beforeEach(() => {
  api.get.mockReset();
});

describe('Erros do sistema', () => {
  it('começa recolhida e não consulta a API antes de abrir', () => {
    render(<ErrosDoSistema />);

    expect(api.get).not.toHaveBeenCalled();
    expect(screen.getByText('Ver os erros recentes')).toBeInTheDocument();
  });

  it('ao abrir, consulta uma vez e mostra a contagem e a lista', async () => {
    api.get.mockResolvedValue({ data: { erros: [ERRO], ultimas_24h: 1, retencao_dias: 30 } });
    const usuario = userEvent.setup();
    render(<ErrosDoSistema />);

    await usuario.click(screen.getByText('Ver os erros recentes'));

    expect(await screen.findByText('1 erro nas últimas 24 horas.')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/operacao/erros');
    const tabela = screen.getByRole('table', { name: /Erros de servidor/ });
    expect(within(tabela).getByText('POST /auth/login')).toBeInTheDocument();
    expect(within(tabela).getByText('banco caiu')).toBeInTheDocument();
    expect(within(tabela).getByText('Ver pilha')).toBeInTheDocument();

    // Fechar e abrir de novo não repete a consulta: a lista já está na tela.
    await usuario.click(screen.getByText('Ver os erros recentes'));
    await usuario.click(screen.getByText('Ver os erros recentes'));
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('o plural da contagem concorda', async () => {
    api.get.mockResolvedValue({ data: { erros: [ERRO, { ...ERRO, id: 8 }], ultimas_24h: 2, retencao_dias: 30 } });
    const usuario = userEvent.setup();
    render(<ErrosDoSistema />);

    await usuario.click(screen.getByText('Ver os erros recentes'));

    expect(await screen.findByText('2 erros nas últimas 24 horas.')).toBeInTheDocument();
  });

  it('sem erros, diz que não há, em vez de mostrar uma tabela vazia', async () => {
    api.get.mockResolvedValue({ data: { erros: [], ultimas_24h: 0, retencao_dias: 30 } });
    const usuario = userEvent.setup();
    render(<ErrosDoSistema />);

    await usuario.click(screen.getByText('Ver os erros recentes'));

    expect(await screen.findByText('Nenhum erro guardado nos últimos 30 dias.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('se a consulta falhar, diz isso', async () => {
    api.get.mockRejectedValue(new Error('rede'));
    const usuario = userEvent.setup();
    render(<ErrosDoSistema />);

    await usuario.click(screen.getByText('Ver os erros recentes'));

    expect(await screen.findByText('Não foi possível carregar os erros do sistema.')).toBeInTheDocument();
  });
});

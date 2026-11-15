import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../src/api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

import api from '../src/api/client';
import MateriaisDoChamado from '../src/components/chamados/MateriaisDoChamado';

/**
 * RF07: o técnico lança, na tela do chamado, o material que usou. A API já existia; faltava a
 * tela (achado da varredura de 13/11/2026).
 */
const CATALOGO = [
  { id: 1, nome: 'Cabo flexível', unidade_medida: 'm' },
  { id: 2, nome: 'Disjuntor 20 A', unidade_medida: 'un' },
];
const CABO_LANCADO = { material_id: 1, nome: 'Cabo flexível', unidade_medida: 'm', quantidade: '2.50' };

function montar({ lancados = [], catalogo = CATALOGO, podeLancar = true, ehGestao = false, aoRegistrar } = {}) {
  api.get.mockImplementation(async (caminho) => {
    if (caminho === '/chamados/7/materiais') return { data: { materiais: lancados } };
    if (caminho === '/materiais') return { data: { materiais: catalogo } };
    throw new Error(`caminho inesperado: ${caminho}`);
  });
  return render(
    <MemoryRouter>
      <MateriaisDoChamado chamadoId={7} podeLancar={podeLancar} ehGestao={ehGestao} aoRegistrar={aoRegistrar} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
});

describe('Materiais do chamado (RF07)', () => {
  it('mostra o que foi lançado, com quantidade e unidade', async () => {
    montar({ lancados: [CABO_LANCADO] });

    expect(await screen.findByText('Cabo flexível')).toBeInTheDocument();
    expect(screen.getByText('· 2,5 m')).toBeInTheDocument();
  });

  it('lança o material escolhido, com a quantidade como número, e recarrega o chamado', async () => {
    const user = userEvent.setup();
    const aoRegistrar = vi.fn();
    api.post.mockResolvedValue({ data: { materiais: [{ ...CABO_LANCADO, quantidade: '3.50' }] } });
    montar({ aoRegistrar });

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Material' }), '1');
    const quantidade = screen.getByRole('spinbutton', { name: /Quantidade/ });
    expect(screen.getByText('Em m.')).toBeInTheDocument();
    await user.type(quantidade, '3.5');
    await user.click(screen.getByRole('button', { name: 'Lançar' }));

    expect(api.post).toHaveBeenCalledWith('/chamados/7/materiais', { material_id: 1, quantidade: 3.5 });
    expect(await screen.findByText('· 3,5 m')).toBeInTheDocument();
    // A linha do tempo ganhou um evento: o chamado é recarregado para mostrá-lo.
    expect(aoRegistrar).toHaveBeenCalled();
  });

  it('material já lançado: o botão diz que corrige, e a ajuda diz que substitui', async () => {
    const user = userEvent.setup();
    montar({ lancados: [CABO_LANCADO] });

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Material' }), '1');

    expect(screen.getByRole('button', { name: 'Corrigir' })).toBeInTheDocument();
    expect(screen.getByText('Substitui a quantidade já lançada.')).toBeInTheDocument();
  });

  it('retira o lançamento', async () => {
    const user = userEvent.setup();
    api.delete.mockResolvedValue({ data: { materiais: [] } });
    montar({ lancados: [CABO_LANCADO] });

    await user.click(await screen.findByRole('button', { name: 'Retirar Cabo flexível' }));

    expect(api.delete).toHaveBeenCalledWith('/chamados/7/materiais/1');
    expect(await screen.findByText('Nenhum material lançado.')).toBeInTheDocument();
  });

  it('a recusa do servidor aparece na tela', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue({
      response: { data: { erro: { mensagem: 'Não é possível lançar ou retirar material de chamado concluído ou cancelado.' } } },
    });
    montar();

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Material' }), '2');
    await user.type(screen.getByRole('spinbutton', { name: /Quantidade/ }), '1');
    await user.click(screen.getByRole('button', { name: 'Lançar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/chamado concluído ou cancelado/);
  });

  it('quem não executa vê o que foi lançado, sem formulário nem botão de retirar, e nem pede o catálogo', async () => {
    montar({ lancados: [CABO_LANCADO], podeLancar: false });

    const secao = await screen.findByRole('region', { name: 'Materiais' });
    expect(within(secao).getByText('Cabo flexível')).toBeInTheDocument();
    expect(within(secao).queryByRole('button')).toBeNull();
    expect(within(secao).queryByRole('combobox')).toBeNull();
    expect(api.get).not.toHaveBeenCalledWith('/materiais');
  });

  it('quem não executa e não tem nada a ver não ganha uma seção vazia', async () => {
    montar({ podeLancar: false });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/chamados/7/materiais'));
    expect(screen.queryByRole('region', { name: 'Materiais' })).toBeNull();
  });

  it('catálogo vazio: a gestão ganha o caminho para cadastrar; o técnico, a quem pedir', async () => {
    const { unmount } = montar({ catalogo: [], ehGestao: true });
    expect(await screen.findByRole('link', { name: 'Cadastrar materiais' })).toHaveAttribute(
      'href',
      '/cadastros?aba=materiais'
    );
    unmount();

    montar({ catalogo: [] });
    expect(await screen.findByText(/Peça à gestão para cadastrar/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cadastrar materiais' })).toBeNull();
  });
});

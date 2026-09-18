import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const usuarioAtual = { valor: { id: 1, nome: 'Gestor', perfil: 'gestor' } };
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ usuario: usuarioAtual.valor }),
}));

import api from '../src/api/client';
import Cadastros from '../src/pages/Cadastros';

const LOCAIS = [
  { id: 1, unidade: 'Bloco A', bloco: null, pavimento: null, setor: null, ambiente: 'Sala 101', ativo: true },
  { id: 2, unidade: 'Bloco B', bloco: '2', pavimento: 'Térreo', setor: null, ambiente: null, ativo: true },
  { id: 3, unidade: 'Anexo', bloco: null, pavimento: null, setor: null, ambiente: null, ativo: false },
];

function preparar({ locais = LOCAIS } = {}) {
  api.get.mockImplementation(async (caminho) => {
    if (caminho === '/locais') return { data: { locais } };
    if (caminho === '/categorias') return { data: { categorias: [{ id: 1, nome: 'Elétrica' }] } };
    if (caminho === '/equipes') return { data: { equipes: [] } };
    if (caminho === '/usuarios') return { data: { usuarios: [] } };
    return { data: {} };
  });
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });

  return render(
    <MemoryRouter>
      <Cadastros />
    </MemoryRouter>
  );
}

const filtro = () => screen.getByPlaceholderText('Filtrar locais');

describe('Lista de locais', () => {
  it('monta o rótulo hierárquico sem deixar buraco dos níveis vazios', async () => {
    preparar();

    await waitFor(() => expect(screen.getByText('Bloco A / Sala 101')).toBeInTheDocument());
    expect(screen.getByText('Bloco B / 2 / Térreo')).toBeInTheDocument();
    // Sem cuidado, o rótulo sairia como "Bloco A /  /  /  / Sala 101".
    expect(screen.queryByText(/\/\s+\//)).toBeNull();
  });

  it('diz quantos locais estão à vista do total', async () => {
    preparar();
    await waitFor(() => expect(screen.getByText('3 de 3 locais.')).toBeInTheDocument());
  });

  it('marca com texto o que está desativado', async () => {
    preparar();

    // Cor sozinha não comunica estado (RNF02).
    await waitFor(() => expect(screen.getByText('Desativado')).toBeInTheDocument());
  });
});

describe('Filtro de locais', () => {
  it('reduz a lista ao que casa com o termo', async () => {
    const usuario = userEvent.setup();
    preparar();
    await waitFor(() => expect(screen.getByText('Bloco A / Sala 101')).toBeInTheDocument());

    await usuario.type(filtro(), 'anexo');

    // Uma instituição tem centenas de ambientes: sem filtro, achar um local
    // para desativar vira rolagem de página inteira.
    await waitFor(() => expect(screen.getByText('1 de 3 locais.')).toBeInTheDocument());
    expect(screen.queryByText('Bloco A / Sala 101')).toBeNull();
    expect(screen.getByText('Anexo')).toBeInTheDocument();
  });

  it('ignora maiúsculas e acha por nível intermediário', async () => {
    const usuario = userEvent.setup();
    preparar();
    await waitFor(() => expect(screen.getByText('Bloco B / 2 / Térreo')).toBeInTheDocument());

    await usuario.type(filtro(), 'TÉRREO');

    await waitFor(() => expect(screen.getByText('1 de 3 locais.')).toBeInTheDocument());
  });

  it('sem resultado, avisa em vez de mostrar lista vazia', async () => {
    const usuario = userEvent.setup();
    preparar();
    await waitFor(() => expect(screen.getByText('3 de 3 locais.')).toBeInTheDocument());

    await usuario.type(filtro(), 'zzzz');

    expect(screen.getByText('Nenhum local corresponde ao filtro.')).toBeInTheDocument();
  });

  it('limpar o filtro devolve a lista inteira', async () => {
    const usuario = userEvent.setup();
    preparar();
    await waitFor(() => expect(screen.getByText('3 de 3 locais.')).toBeInTheDocument());

    await usuario.type(filtro(), 'anexo');
    await waitFor(() => expect(screen.getByText('1 de 3 locais.')).toBeInTheDocument());

    await usuario.clear(filtro());
    await waitFor(() => expect(screen.getByText('3 de 3 locais.')).toBeInTheDocument());
  });
});

describe('Quem entra na tela', () => {
  it('a tela pede a lista completa, inclusive os inativos', async () => {
    preparar();

    // A tela de cadastros é o único lugar onde o desativado precisa aparecer:
    // é por ela que se reativa.
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/locais', { params: { incluir_inativos: 'true' } })
    );
  });

  it('solicitante é mandado para fora', async () => {
    usuarioAtual.valor = { id: 2, nome: 'Solicitante', perfil: 'solicitante' };
    preparar();

    expect(screen.queryByText('Cadastros')).toBeNull();
    // Nem chega a pedir os dados: a rota é da gestão.
    expect(api.get).not.toHaveBeenCalled();

    usuarioAtual.valor = { id: 1, nome: 'Gestor', perfil: 'gestor' };
  });
});

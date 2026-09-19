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
import { conferirCabecalhos } from './apoio/cabecalhos';

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

describe('Importação de planilha de locais', () => {
  const entrada = () => screen.getByLabelText('Planilha de locais');

  function arquivo(conteudo, nome = 'locais.csv') {
    return new File([conteudo], nome, { type: 'text/csv' });
  }

  it('manda o conteúdo do arquivo e conta o que entrou', async () => {
    const usuario = userEvent.setup();
    preparar();
    await waitFor(() => expect(screen.getByText('3 de 3 locais.')).toBeInTheDocument());

    api.post.mockResolvedValue({
      data: { relatorio: { linhas: 3, criados: 2, ja_existiam: 1, desativados: [] } },
    });

    await usuario.upload(entrada(), arquivo('unidade;ambiente\nPrédio;Sala 1'));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/locais/importar', {
        csv: 'unidade;ambiente\nPrédio;Sala 1',
      })
    );
    expect(await screen.findByText('2 locais criados; 1 já existia de 3 linhas.')).toBeInTheDocument();
  });

  it('recarrega a lista depois de importar', async () => {
    const usuario = userEvent.setup();
    preparar();
    await waitFor(() => expect(screen.getByText('3 de 3 locais.')).toBeInTheDocument());
    const antes = api.get.mock.calls.length;

    api.post.mockResolvedValue({
      data: { relatorio: { linhas: 1, criados: 1, ja_existiam: 0, desativados: [] } },
    });
    await usuario.upload(entrada(), arquivo('unidade\nPrédio'));

    // Sem recarregar, os locais importados só apareceriam no próximo F5 — e
    // quem importou ficaria sem saber se funcionou.
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(antes));
  });

  it('lista os problemas linha a linha quando o arquivo é recusado', async () => {
    const usuario = userEvent.setup();
    preparar();
    await waitFor(() => expect(screen.getByText('3 de 3 locais.')).toBeInTheDocument());

    api.post.mockRejectedValue({
      response: {
        data: {
          erro: {
            mensagem: 'O arquivo não foi importado: 2 problemas encontrados.',
            codigo: 'ARQUIVO_INVALIDO',
            detalhes: ['Linha 3: "unidade" é obrigatória.', 'Linha 7: repete a linha 4.'],
          },
        },
      },
    });

    await usuario.upload(entrada(), arquivo('unidade\n\n'));

    expect(await screen.findByText('Linha 3: "unidade" é obrigatória.')).toBeInTheDocument();
    expect(screen.getByText('Linha 7: repete a linha 4.')).toBeInTheDocument();
    // A frase importa tanto quanto a lista: sem ela, quem importou não sabe se
    // as linhas boas entraram.
    const resumo = screen.getByText(/Nada foi importado/);
    expect(resumo).toBeInTheDocument();

    // E precisa ser anunciada na hora: quem usa leitor de tela mandou o
    // arquivo e não tem como ver que a tela mudou. `role="status"` esperaria a
    // leitura em curso terminar — aqui a pessoa já está indo corrigir o
    // arquivo errado.
    expect(resumo.closest('[role]')).toHaveAttribute('role', 'alert');
  });

  it('avisa quais locais do arquivo estão desativados', async () => {
    const usuario = userEvent.setup();
    preparar();
    await waitFor(() => expect(screen.getByText('3 de 3 locais.')).toBeInTheDocument());

    api.post.mockResolvedValue({
      data: {
        relatorio: {
          linhas: 2,
          criados: 1,
          ja_existiam: 1,
          desativados: [{ id: 9, rotulo: 'Prédio Central / Almoxarifado' }],
        },
      },
    });

    await usuario.upload(entrada(), arquivo('unidade;ambiente\nPrédio Central;Almoxarifado'));

    expect(await screen.findByText('Prédio Central / Almoxarifado')).toBeInTheDocument();
  });

  it('lê planilha salva pelo Excel em Windows-1252 sem corromper o acento', async () => {
    const usuario = userEvent.setup();
    preparar();
    await waitFor(() => expect(screen.getByText('3 de 3 locais.')).toBeInTheDocument());

    api.post.mockResolvedValue({
      data: { relatorio: { linhas: 1, criados: 1, ja_existiam: 0, desativados: [] } },
    });

    // "unidade\nTérreo" nos bytes que o Excel do Windows grava: o É é um único
    // byte 0xE9, que não é UTF-8 válido.
    const bytes = new Uint8Array([
      117, 110, 105, 100, 97, 100, 101, 10, 84, 0xe9, 114, 114, 101, 111,
    ]);
    await usuario.upload(entrada(), arquivo(bytes));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/locais/importar', { csv: 'unidade\nTérreo' })
    );
  });
});

describe('Hierarquia de cabeçalhos', () => {
  it('a tela tem um h1 e os painéis ficam um nível abaixo', async () => {
    const { container } = preparar();
    await screen.findByRole('heading', { level: 1, name: 'Cadastros' });

    const niveis = conferirCabecalhos(container);

    expect(
      niveis.filter((h) => h.nivel > 2),
      'nenhum painel de cadastro é subdivisão de outro: todos ficam em h2'
    ).toEqual([]);
  });
});

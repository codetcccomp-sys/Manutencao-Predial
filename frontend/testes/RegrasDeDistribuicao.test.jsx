import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

import api from '../src/api/client';
import RegrasDeDistribuicao, { descreverAlcance } from '../src/components/RegrasDeDistribuicao';

const CATEGORIAS = [
  { id: 1, nome: 'Elétrica' },
  { id: 2, nome: 'Hidráulica' },
];
const EQUIPES = [
  { id: 10, nome: 'Elétrica e climatização', ativo: true },
  { id: 11, nome: 'Equipe antiga', ativo: false },
];
const LOCAIS = [
  { id: 1, unidade: 'Sede', bloco: 'A', ativo: true },
  { id: 2, unidade: 'Sede', bloco: 'B', ativo: true },
  { id: 3, unidade: 'Anexo', bloco: null, ativo: true },
  { id: 4, unidade: 'Fechada', bloco: 'Z', ativo: false },
];

const REGRA = {
  id: 5,
  categoria_nome: 'Elétrica',
  equipe_nome: 'Elétrica e climatização',
  equipe_ativa: true,
  unidade: 'Sede',
  bloco: 'A',
  tecnico_nome: 'Rita',
  prioridade: 'baixa',
  ativo: true,
  tecnicos_ativos: 2,
};

function preparar(regras = [REGRA]) {
  api.get.mockImplementation(async (caminho) => {
    if (caminho === '/regras-distribuicao') return { data: { regras } };
    if (caminho === '/equipes/10') {
      return {
        data: {
          equipe: {
            tecnicos: [
              { id: 7, nome: 'Rita', ativo: true },
              { id: 8, nome: 'Inativo', ativo: false },
            ],
          },
        },
      };
    }
    return { data: {} };
  });
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });
  return render(<RegrasDeDistribuicao categorias={CATEGORIAS} equipes={EQUIPES} locais={LOCAIS} />);
}

beforeEach(() => vi.clearAllMocks());

describe('Lista de regras', () => {
  it('diz para onde vai, onde vale, com que prioridade e quem está de plantão', async () => {
    preparar();
    expect(await screen.findByText('Elétrica → Elétrica e climatização')).toBeInTheDocument();
    expect(screen.getByText('Sede / bloco A · prioridade Baixa · plantão: Rita')).toBeInTheDocument();
  });

  it('avisa quando a equipe não tem técnico ativo para receber', async () => {
    preparar([{ ...REGRA, tecnicos_ativos: 0, tecnico_nome: null }]);
    expect(await screen.findByText(/não tem técnico ativo/)).toBeInTheDocument();
    expect(screen.getByText(/divide pela carga/)).toBeInTheDocument();
  });

  it('sem regra, diz que tudo passa pela triagem', async () => {
    preparar([]);
    expect(await screen.findByText(/Sem regra, todo chamado passa pela triagem/)).toBeInTheDocument();
  });

  it('desligar manda só o "ativo" para a regra certa', async () => {
    preparar();
    const botao = await screen.findByRole('button', { name: /Desligar a regra de Elétrica \(Sede \/ bloco A\)/ });
    await userEvent.click(botao);
    expect(api.patch).toHaveBeenCalledWith('/regras-distribuicao/5', { ativo: false });
    expect(await screen.findByText('Regra desligada.')).toBeInTheDocument();
  });
});

describe('Nova regra', () => {
  it('envia números e só os campos escolhidos, com o plantonista da equipe', async () => {
    preparar([]);
    const u = userEvent.setup();

    await u.selectOptions(screen.getByLabelText('Categoria'), '1');
    await u.selectOptions(screen.getByLabelText('Vai para a equipe'), '10');
    // Só os ativos da equipe escolhida aparecem como plantonista.
    await waitFor(() => expect(screen.getByRole('option', { name: 'Rita' })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Inativo' })).toBeNull();
    await u.selectOptions(screen.getByLabelText('Técnico de plantão'), '7');
    await u.selectOptions(screen.getByLabelText('Unidade'), 'Sede');
    await u.selectOptions(screen.getByLabelText('Bloco'), 'B');
    await u.selectOptions(screen.getByLabelText('Prioridade'), 'media');
    await u.click(screen.getByRole('button', { name: 'Criar regra' }));

    expect(api.post).toHaveBeenCalledWith('/regras-distribuicao', {
      categoria_id: 1,
      equipe_id: 10,
      unidade: 'Sede',
      bloco: 'B',
      tecnico_id: 7,
      prioridade: 'media',
    });
  });

  it('sem unidade, não manda alcance nem plantonista: vale para todo lugar e divide pela carga', async () => {
    preparar([]);
    const u = userEvent.setup();
    await u.selectOptions(screen.getByLabelText('Categoria'), '2');
    await u.selectOptions(screen.getByLabelText('Vai para a equipe'), '10');
    await u.click(screen.getByRole('button', { name: 'Criar regra' }));

    expect(api.post).toHaveBeenCalledWith('/regras-distribuicao', {
      categoria_id: 2,
      equipe_id: 10,
      prioridade: 'baixa',
    });
  });

  it('bloco depende da unidade: fechado sem ela, e solto quando ela muda', async () => {
    preparar([]);
    const u = userEvent.setup();
    const bloco = () => screen.getByLabelText('Bloco');

    expect(bloco()).toBeDisabled();
    await u.selectOptions(screen.getByLabelText('Unidade'), 'Sede');
    expect(bloco()).toBeEnabled();
    expect(within(bloco()).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos os blocos', 'A', 'B']);

    await u.selectOptions(bloco(), 'A');
    await u.selectOptions(screen.getByLabelText('Unidade'), 'Anexo');
    expect(bloco()).toHaveValue('');
    expect(bloco()).toBeDisabled();
  });

  it('só oferece equipes e unidades ativas', async () => {
    preparar([]);
    await screen.findByText(/Sem regra/);
    expect(within(screen.getByLabelText('Vai para a equipe')).queryByRole('option', { name: 'Equipe antiga' })).toBeNull();
    expect(within(screen.getByLabelText('Unidade')).queryByRole('option', { name: 'Fechada' })).toBeNull();
  });

  it('mostra a recusa da API como ela veio', async () => {
    preparar([]);
    api.post.mockRejectedValue({
      response: { data: { erro: { mensagem: 'Já existe uma regra ligada para esta categoria com o mesmo alcance.' } } },
    });
    const u = userEvent.setup();
    await u.selectOptions(screen.getByLabelText('Categoria'), '1');
    await u.selectOptions(screen.getByLabelText('Vai para a equipe'), '10');
    await u.click(screen.getByRole('button', { name: 'Criar regra' }));

    expect(await screen.findByText(/Já existe uma regra ligada/)).toBeInTheDocument();
  });
});

describe('descreverAlcance', () => {
  it('lê do mais específico para o mais geral', () => {
    expect(descreverAlcance({ unidade: 'Sede', bloco: 'A' })).toBe('Sede / bloco A');
    expect(descreverAlcance({ unidade: 'Sede', bloco: null })).toBe('Sede');
    expect(descreverAlcance({ unidade: null, bloco: null })).toBe('Toda a instituição');
  });
});

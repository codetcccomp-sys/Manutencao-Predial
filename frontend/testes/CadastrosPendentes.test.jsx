import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const registrar = vi.fn();
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ registrar }),
}));

import api from '../src/api/client';
import CadastrosPendentes from '../src/components/CadastrosPendentes';
import Cadastro from '../src/pages/Cadastro';

const PEDIDOS = [
  { id: 11, nome: 'Ana Souza', email: 'ana@exemplo.com', cadastro_pendente_desde: '2026-10-08T12:00:00Z' },
  { id: 12, nome: 'Bruno Lima', email: 'bruno@exemplo.com', cadastro_pendente_desde: '2026-10-08T13:00:00Z' },
];

function preparar({ pedidos = PEDIDOS, exige = true } = {}) {
  api.get.mockImplementation(async (caminho, config) => {
    if (caminho === '/usuarios' && config?.params?.situacao === 'pendentes') return { data: { usuarios: pedidos } };
    if (caminho === '/configuracoes') return { data: { configuracoes: { cadastro_exige_aprovacao: exige } } };
    return { data: {} };
  });
  api.post.mockImplementation(async (caminho, corpo) =>
    caminho === '/usuarios/aprovar'
      ? { data: { aprovados: corpo.ids.map((id) => ({ id })) } }
      : { data: { recusados: corpo.ids } }
  );
  api.patch.mockImplementation(async (_, corpo) => ({ data: { configuracoes: corpo } }));
}

beforeEach(() => vi.clearAllMocks());

describe('Pedidos de cadastro no painel', () => {
  it('sem pedido, não ocupa espaço', async () => {
    preparar({ pedidos: [] });
    const { container } = render(<CadastrosPendentes />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    // No painel não se mexe na exigência: nem a lê.
    expect(api.get).not.toHaveBeenCalledWith('/configuracoes');
  });

  it('diz quantos esperam, e aprovar um manda só aquele', async () => {
    preparar();
    const u = userEvent.setup();
    render(<CadastrosPendentes />);

    expect(await screen.findByText('2 cadastros aguardando aprovação')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Aprovar Ana Souza' }));

    expect(api.post).toHaveBeenCalledWith('/usuarios/aprovar', { ids: [11] });
    expect(await screen.findByText('1 cadastro aprovado. A pessoa já pode entrar.')).toBeInTheDocument();
  });

  it('selecionar todos aprova o lote de uma vez', async () => {
    preparar();
    const u = userEvent.setup();
    render(<CadastrosPendentes />);

    const lote = await screen.findByRole('button', { name: /Aprovar selecionados/ });
    expect(lote).toBeDisabled();
    await u.click(screen.getByLabelText('Selecionar todos'));
    expect(lote).toHaveTextContent('(2)');
    await u.click(lote);

    expect(api.post).toHaveBeenCalledWith('/usuarios/aprovar', { ids: [11, 12] });
  });

  it('recusar pergunta antes, porque apaga o pedido', async () => {
    preparar();
    const u = userEvent.setup();
    render(<CadastrosPendentes />);

    await u.click(await screen.findByRole('button', { name: 'Recusar Bruno Lima' }));
    const dialogo = screen.getByRole('dialog', { name: 'Recusar este cadastro?' });
    expect(dialogo).toHaveTextContent('Bruno Lima');

    await u.click(within(dialogo).getByRole('button', { name: 'Voltar' }));
    expect(api.post).not.toHaveBeenCalled();

    await u.click(screen.getByRole('button', { name: 'Recusar Bruno Lima' }));
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Recusar e apagar' }));
    expect(api.post).toHaveBeenCalledWith('/usuarios/recusar', { ids: [12] });
    expect(await screen.findByText('1 pedido recusado e apagado.')).toBeInTheDocument();
  });
});

describe('Pedidos de cadastro na tela de Usuários', () => {
  it('mostra a exigência e a desliga pela caixa', async () => {
    preparar({ pedidos: [] });
    const u = userEvent.setup();
    render(<CadastrosPendentes comConfiguracao />);

    const caixa = await screen.findByRole('checkbox', { name: /Novos cadastros precisam de aprovação/ });
    expect(caixa).toBeChecked();
    expect(screen.getByText('Nenhum pedido aguardando.')).toBeInTheDocument();

    await u.click(caixa);
    expect(api.patch).toHaveBeenCalledWith('/configuracoes', { cadastro_exige_aprovacao: false });
    expect(await screen.findByText(/passam a entrar direto/)).toBeInTheDocument();
    expect(caixa).not.toBeChecked();
  });
});

describe('Tela de cadastro', () => {
  async function cadastrar() {
    const u = userEvent.setup();
    render(
      <MemoryRouter>
        <Cadastro />
      </MemoryRouter>
    );
    await u.type(screen.getByLabelText('Nome'), 'Ana Souza');
    await u.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await u.type(screen.getByLabelText('Senha'), 'senha123');
    await u.click(screen.getByRole('button', { name: 'Cadastrar' }));
  }

  it('com aprovação, diz que o pedido espera a gestão em vez de mandar ao login', async () => {
    registrar.mockResolvedValue({ aguardando_aprovacao: true });
    await cadastrar();
    expect(await screen.findByRole('heading', { name: 'Pedido enviado' })).toBeInTheDocument();
    expect(screen.getByText(/aguarda a aprovação da gestão/)).toBeInTheDocument();
  });

  it('sem aprovação, segue como antes: conta criada', async () => {
    registrar.mockResolvedValue({ aguardando_aprovacao: false });
    await cadastrar();
    expect(await screen.findByText(/Conta criada!/)).toBeInTheDocument();
  });
});

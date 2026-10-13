import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter } from 'react-router';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const usuarioAtual = { valor: null };
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ usuario: usuarioAtual.valor, logout: vi.fn() }),
}));

// Peças do Layout e do painel que têm as próprias chamadas à API e nada a ver
// com o alerta: ficam de fora para os testes contarem só o que importa.
vi.mock('../src/components/Avisos', () => ({ default: () => null }));
vi.mock('../src/components/AvisoDoAgendador', () => ({ default: () => null }));
vi.mock('../src/components/CadastrosPendentes', () => ({ default: () => null }));

import api from '../src/api/client';
import AlertaDeCriticos from '../src/components/AlertaDeCriticos';
import CartaoDeChamado from '../src/components/chamados/CartaoDeChamado';
import Layout from '../src/components/Layout';
import Dashboard from '../src/pages/Dashboard';

/**
 * Crítico sem atendimento: o que a gestão vê.
 *
 * A regra (15 minutos, só crítico corretivo, só em "aberto") é do servidor e é
 * provada nos testes do backend. Aqui se prova o que a tela faz com a resposta:
 * a faixa, o selo no cartão, o recorte no painel e que ninguém além da gestão
 * recebe o alerta.
 */

const resposta = (total, minutos = 15) => ({
  data: { chamados: [], paginacao: { pagina: 1, limite: 1, total, paginas: total }, atendimento_critico_minutos: minutos },
  headers: {},
});

const minutosAtras = (n) => new Date(Date.now() - n * 60_000).toISOString();

function chamadoCritico(extra = {}) {
  return {
    id: 5,
    protocolo: 'SMP-005',
    titulo: 'Quadro geral sem energia',
    estado: 'aberto',
    prioridade: 'critica',
    prazo_estimado: null,
    em_atraso: false,
    sem_atendimento_critico: true,
    data_abertura: minutosAtras(23),
    tecnico_id: null,
    ...extra,
  };
}

const abrirFaixa = (entrada = '/') =>
  render(
    <MemoryRouter initialEntries={[entrada]}>
      <AlertaDeCriticos />
    </MemoryRouter>
  );

beforeEach(() => {
  api.get.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Faixa de alerta', () => {
  it('sem chamado crítico parado, não aparece', async () => {
    api.get.mockResolvedValue(resposta(0));
    abrirFaixa();
    await act(async () => {});

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('com chamados parados, diz quantos, há quanto tempo vale o limite e leva ao painel filtrado', async () => {
    api.get.mockResolvedValue(resposta(2, 15));
    abrirFaixa();

    const faixa = await screen.findByRole('alert');
    expect(faixa).toHaveTextContent('2 chamados críticos sem atendimento há mais de 15 minutos.');
    expect(within(faixa).getByRole('link', { name: 'Ver os chamados' })).toHaveAttribute('href', '/?recorte=criticos');
  });

  it('no singular, a frase concorda', async () => {
    api.get.mockResolvedValue(resposta(1, 15));
    abrirFaixa();

    const faixa = await screen.findByRole('alert');
    expect(faixa).toHaveTextContent('1 chamado crítico sem atendimento há mais de 15 minutos.');
    expect(within(faixa).getByRole('link', { name: 'Ver o chamado' })).toBeInTheDocument();
  });

  it('pede só a contagem, com uma consulta leve', async () => {
    api.get.mockResolvedValue(resposta(1));
    abrirFaixa();
    await screen.findByRole('alert');

    expect(api.get).toHaveBeenCalledWith('/chamados', { params: { sem_atendimento: 'true', limite: 1 } });
  });

  it('o minuto vem do servidor: se ele mudar o limite, a faixa acompanha', async () => {
    api.get.mockResolvedValue(resposta(1, 30));
    abrirFaixa();

    expect(await screen.findByRole('alert')).toHaveTextContent('há mais de 30 minutos');
  });

  it('refaz a consulta a cada minuto, e a faixa some quando o chamado deixa de estar parado', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.get.mockResolvedValueOnce(resposta(1)).mockResolvedValue(resposta(0));
    abrirFaixa();
    await screen.findByRole('alert');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refaz a consulta ao navegar: quem acabou de fazer a triagem não vê o chamado de volta', async () => {
    api.get.mockResolvedValueOnce(resposta(1)).mockResolvedValue(resposta(0));
    const u = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/chamados/9']}>
        <AlertaDeCriticos />
        <Link to="/">Voltar ao painel</Link>
      </MemoryRouter>
    );
    await screen.findByRole('alert');

    await u.click(screen.getByRole('link', { name: 'Voltar ao painel' }));

    expect(api.get).toHaveBeenCalledTimes(2);
    await act(async () => {});
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('se a consulta falhar, mantém o último número conhecido', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.get.mockResolvedValueOnce(resposta(3)).mockRejectedValue(new Error('rede'));
    abrirFaixa();
    await screen.findByRole('alert');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent('3 chamados críticos');
  });

  it('resposta guardada pelo service worker não vale como "agora"', async () => {
    api.get.mockResolvedValue({ ...resposta(4), headers: { 'x-servido-do-cache': '1' } });
    abrirFaixa();
    await act(async () => {});

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('com a aba escondida, não consulta', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    api.get.mockResolvedValue(resposta(1));
    abrirFaixa();
    await act(async () => {});

    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('No Layout', () => {
  const abrirLayout = (usuario) => {
    usuarioAtual.valor = usuario;
    api.get.mockResolvedValue(resposta(1));
    return render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>
    );
  };
  const pediuOAlerta = () =>
    api.get.mock.calls.some(([, config]) => config?.params?.sem_atendimento === 'true');

  it.each([['gestor'], ['administrador']])('%s recebe a faixa', async (perfil) => {
    abrirLayout({ id: 1, nome: 'Ana', perfil });

    expect(await screen.findByRole('alert')).toHaveTextContent('chamado crítico sem atendimento');
  });

  it.each([['tecnico'], ['solicitante']])('%s não recebe a faixa nem a consulta', async (perfil) => {
    abrirLayout({ id: 2, nome: 'Davi', perfil });
    await act(async () => {});

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(pediuOAlerta()).toBe(false);
  });

  it('gestão com a verificação exigida e ainda desligada não consulta: a API só atende Minha conta', async () => {
    abrirLayout({ id: 3, nome: 'Bia', perfil: 'gestor', dois_fatores_pendente: true });
    await act(async () => {});

    expect(pediuOAlerta()).toBe(false);
  });
});

describe('Selo no cartão', () => {
  const cartao = (props, chamado = chamadoCritico()) =>
    render(
      <MemoryRouter>
        <ul>
          <CartaoDeChamado chamado={chamado} {...props} />
        </ul>
      </MemoryRouter>
    );

  it('na tela da gestão, mostra há quanto tempo o chamado está sem atendimento', () => {
    cartao({ alertarSemAtendimento: true });
    expect(screen.getByText('Sem atendimento há 23 min')).toBeInTheDocument();
  });

  it('o tempo passa de uma hora em horas e minutos', () => {
    cartao({ alertarSemAtendimento: true }, chamadoCritico({ data_abertura: minutosAtras(125) }));
    expect(screen.getByText('Sem atendimento há 2 h 05 min')).toBeInTheDocument();
  });

  it('nas telas de quem pediu e de quem executa, não aparece', () => {
    cartao({});
    expect(screen.queryByText(/Sem atendimento/)).not.toBeInTheDocument();
  });

  it('chamado sem o alerta não ganha selo, mesmo na tela da gestão', () => {
    cartao({ alertarSemAtendimento: true }, chamadoCritico({ sem_atendimento_critico: false }));
    expect(screen.queryByText(/Sem atendimento/)).not.toBeInTheDocument();
  });
});

describe('Painel da gestão', () => {
  const GESTOR = { id: 1, nome: 'Ana', perfil: 'gestor' };
  const PARADO = chamadoCritico();
  const OUTRO = chamadoCritico({ id: 6, protocolo: 'SMP-006', titulo: 'Lâmpada queimada', prioridade: 'baixa', sem_atendimento_critico: false });

  function servidor(url, config = {}) {
    const p = config.params || {};
    let lista = [PARADO, OUTRO];
    if (p.sem_atendimento === 'true') lista = lista.filter((c) => c.sem_atendimento_critico);
    return Promise.resolve({
      data: {
        chamados: lista,
        paginacao: { pagina: 1, limite: Number(p.limite) || 20, total: lista.length, paginas: 1 },
        atendimento_critico_minutos: 15,
      },
      headers: {},
    });
  }

  function abrirPainel(entrada = '/') {
    usuarioAtual.valor = GESTOR;
    api.get.mockImplementation(servidor);
    return render(
      <MemoryRouter initialEntries={[entrada]}>
        <Dashboard />
      </MemoryRouter>
    );
  }

  const pedidosDaLista = () =>
    api.get.mock.calls.filter(([url, config]) => url === '/chamados' && config?.params?.limite !== 1);

  it('os cartões da lista mostram o selo', async () => {
    abrirPainel();
    expect(await screen.findByText('Sem atendimento há 23 min')).toBeInTheDocument();
  });

  it('chegando pela faixa (?recorte=criticos), já filtra pelos críticos sem atendimento', async () => {
    abrirPainel('/?recorte=criticos');

    expect(await screen.findByText('Quadro geral sem energia')).toBeInTheDocument();
    expect(screen.queryByText('Lâmpada queimada')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Críticos sem atendimento' })).toBeChecked();
    expect(pedidosDaLista().some(([, c]) => c.params.sem_atendimento === 'true')).toBe(true);
  });

  it('a caixa liga e desliga o recorte, e "Limpar filtros" o desfaz', async () => {
    const u = userEvent.setup();
    abrirPainel();
    await screen.findByText('Lâmpada queimada');

    const caixa = screen.getByRole('checkbox', { name: 'Críticos sem atendimento' });
    expect(caixa).not.toBeChecked();
    await u.click(caixa);
    expect(await screen.findByText('Quadro geral sem energia')).toBeInTheDocument();
    expect(screen.queryByText('Lâmpada queimada')).not.toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByText('Lâmpada queimada')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Críticos sem atendimento' })).not.toBeChecked();
  });

  it('sem o parâmetro, a lista abre sem o recorte', async () => {
    abrirPainel();
    await screen.findByText('Lâmpada queimada');

    expect(pedidosDaLista().every(([, c]) => c.params.sem_atendimento === undefined)).toBe(true);
  });
});

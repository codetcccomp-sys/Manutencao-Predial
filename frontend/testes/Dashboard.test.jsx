import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../src/api/client', () => ({ default: { get: vi.fn() } }));

import api from '../src/api/client';
import Dashboard from '../src/pages/Dashboard';

function chamado(extra = {}) {
  return {
    id: 1,
    titulo: 'Lâmpada queimada no corredor',
    protocolo: 'SMP-20260101-ABCDEF',
    estado: 'aberto',
    em_atraso: false,
    ...extra,
  };
}

/**
 * O duplê ecoa a página pedida, como o servidor faz.
 *
 * Com um `pagina` fixo na resposta, o componente e o duplê discordariam sobre
 * em que página se está, e o teste de paginação mediria a mentira do duplê em
 * vez do comportamento da tela.
 */
function responder(chamados, paginacao = {}) {
  api.get.mockImplementation(async (_caminho, config) => ({
    data: {
      chamados,
      paginacao: {
        pagina: config?.params?.pagina ?? 1,
        limite: 20,
        total: chamados.length,
        paginas: 1,
        ...paginacao,
      },
    },
  }));
}

const montar = () =>
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );

/** Os parâmetros do último GET /chamados. */
const ultimosParams = () => api.get.mock.calls.at(-1)[1].params;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Busca (RF03)', () => {
  it('espera a digitação parar antes de consultar', async () => {
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    responder([chamado()]);
    montar();
    await waitFor(() => expect(api.get).toHaveBeenCalled());

    const chamadasIniciais = api.get.mock.calls.length;
    await usuario.type(screen.getByLabelText('Buscar'), 'SMP');

    // Uma consulta por tecla afogaria o banco e faria a lista piscar a cada
    // letra: até a espera terminar, nada novo é pedido.
    expect(api.get.mock.calls.length).toBe(chamadasIniciais);

    vi.advanceTimersByTime(400);
    await waitFor(() => expect(ultimosParams().busca).toBe('SMP'));
  });

  it('manda o termo sem espaços nas pontas', async () => {
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    responder([chamado()]);
    montar();
    await waitFor(() => expect(api.get).toHaveBeenCalled());

    await usuario.type(screen.getByLabelText('Buscar'), '  SMP-1  ');
    vi.advanceTimersByTime(400);

    await waitFor(() => expect(ultimosParams().busca).toBe('SMP-1'));
  });

  it('busca vazia não vira parâmetro', async () => {
    responder([chamado()]);
    montar();

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(ultimosParams()).not.toHaveProperty('busca');
  });

  it('sem resultado, a mensagem repete o que foi procurado', async () => {
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    responder([chamado()]);
    montar();
    await waitFor(() => expect(screen.getByText(/Lâmpada queimada/)).toBeInTheDocument());

    responder([], { total: 0, paginas: 0 });
    await usuario.type(screen.getByLabelText('Buscar'), 'inexistente');
    vi.advanceTimersByTime(400);

    // Repetir o termo evita a dúvida de sempre: "não achou, ou eu digitei
    // errado?"
    await waitFor(() =>
      expect(screen.getByText('Nenhum chamado encontrado para "inexistente".')).toBeInTheDocument()
    );
  });

  it('volta para a primeira página ao mudar a busca', async () => {
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    responder([chamado()], { paginas: 3, total: 50 });
    montar();
    await waitFor(() => expect(api.get).toHaveBeenCalled());

    await usuario.click(screen.getByText('Próxima'));
    await waitFor(() => expect(ultimosParams().pagina).toBe(2));

    await usuario.type(screen.getByLabelText('Buscar'), 'x');
    vi.advanceTimersByTime(400);

    // Um filtro novo com a página 3 aberta pediria uma página que o novo
    // filtro pode nem ter.
    await waitFor(() => expect(ultimosParams().pagina).toBe(1));
  });
});

describe('Filtros', () => {
  it('filtrar por estado manda o estado e volta à primeira página', async () => {
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    responder([chamado()]);
    montar();
    await waitFor(() => expect(api.get).toHaveBeenCalled());

    await usuario.selectOptions(screen.getByLabelText('Estado'), 'concluido');

    await waitFor(() => {
      expect(ultimosParams().estado).toBe('concluido');
      expect(ultimosParams().pagina).toBe(1);
    });
  });

  it('"somente atrasados" vira parâmetro só quando marcado', async () => {
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    responder([chamado()]);
    montar();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(ultimosParams()).not.toHaveProperty('atrasados');

    await usuario.click(screen.getByLabelText('Somente atrasados'));
    await waitFor(() => expect(ultimosParams().atrasados).toBe('true'));
  });
});

describe('Lista', () => {
  it('marca o chamado em atraso com texto, não só com cor', async () => {
    responder([chamado({ em_atraso: true })]);
    montar();

    // A RNF02 pede não depender apenas de cor para comunicar estado.
    await waitFor(() => expect(screen.getByText('Em atraso')).toBeInTheDocument());
  });

  it('traduz o estado em vez de mostrar o valor do banco', async () => {
    responder([chamado({ estado: 'aguardando_material' })]);
    montar();

    await waitFor(() => expect(screen.getByText('Aguardando material')).toBeInTheDocument());
    expect(screen.queryByText('aguardando_material')).toBeNull();
  });

  it('falha de rede vira mensagem na tela', async () => {
    api.get.mockRejectedValue(new Error('sem rede'));
    montar();

    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar os chamados.')).toBeInTheDocument()
    );
  });
});

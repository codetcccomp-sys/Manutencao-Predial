import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../src/api/client', () => ({ default: { get: vi.fn() } }));

import api from '../src/api/client';
import Dashboard from '../src/pages/Dashboard';
import { conferirCabecalhos } from './apoio/cabecalhos';

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
  api.get.mockImplementation(async (caminho, config) => {
    // A tela pede o resumo para o número de "em aberto" no topo; devolver a
    // forma de uma listagem faria o componente ler `totais` de onde não há.
    if (caminho === '/relatorios/resumo') {
      return { data: { totais: { em_aberto: chamados.length } } };
    }
    return {
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
    };
  });
}

const montar = () =>
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );

/**
 * Os parâmetros do último GET de `/chamados`.
 *
 * O filtro por caminho não é zelo: a tela passou a pedir também
 * `/relatorios/resumo`, para o número de "em aberto" no topo, e mais dois
 * GET de `/chamados` com `limite: 1` só para contar os cartões do topo.
 *
 * Sem o filtro, o helper pegava a última chamada qualquer — ora a do resumo,
 * sem `params`, ora uma contagem com `atrasados: 'true'` fixo. Os testes
 * passavam a medir a chamada errada e acusavam filtro onde não havia.
 *
 * `pagina` é o que separa: só a consulta da LISTA pagina. As de contagem
 * pedem uma linha e leem o total.
 */
const ultimosParams = () =>
  api.get.mock.calls
    .filter(([caminho, config]) => caminho === '/chamados' && config?.params?.pagina !== undefined)
    .at(-1)[1].params;

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

describe('Estado vazio e carregamento', () => {
  it('distingue "ainda não há nada" de "o filtro não achou nada"', async () => {
    const usuario = userEvent.setup();
    responder([]);
    montar();

    // Sem filtro: a saída é abrir um chamado, não mexer em filtro nenhum.
    await waitFor(() =>
      expect(screen.getByText('Nenhum chamado encontrado.')).toBeInTheDocument()
    );
    expect(screen.getByText(/Quando alguém abrir um chamado/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull();

    // Com filtro: a saída provável é afrouxar o filtro, e o botão fica ali.
    await usuario.click(screen.getByLabelText('Somente atrasados'));
    await waitFor(() =>
      expect(screen.getByText(/filtros ativos podem estar estreitando/)).toBeInTheDocument()
    );
    expect(screen.getAllByRole('button', { name: 'Limpar filtros' }).length).toBeGreaterThan(0);
  });

  it('limpar filtros devolve a lista inteira', async () => {
    const usuario = userEvent.setup();
    responder([chamado()]);
    montar();

    await waitFor(() => expect(screen.getByText('Lâmpada queimada no corredor')).toBeInTheDocument());

    // Os três filtros juntos: limpar um só e conferir um só deixaria passar
    // um "limpar" que esquece os outros dois.
    await usuario.type(screen.getByLabelText('Buscar'), 'torneira');
    await usuario.selectOptions(screen.getByLabelText('Estado'), 'em_triagem');
    await usuario.click(screen.getByLabelText('Somente atrasados'));

    await waitFor(() => {
      const params = api.get.mock.calls.at(-1)[1].params;
      expect(params.atrasados).toBe('true');
      expect(params.estado).toBe('em_triagem');
      expect(params.busca).toBe('torneira');
    });

    await usuario.click(screen.getAllByRole('button', { name: 'Limpar filtros' })[0]);

    await waitFor(() => {
      const ultima = api.get.mock.calls.at(-1)[1].params;
      expect(ultima.atrasados).toBeUndefined();
      expect(ultima.estado).toBeUndefined();
      expect(ultima.busca).toBeUndefined();
    });
  });

  it('a região anuncia que está carregando, e o esqueleto fica fora disso', async () => {
    // Uma lista de resolvedores, e não um só.
    //
    // A tela dispara quatro requisições ao abrir: a lista e as três contagens
    // do topo. Com uma variável única, cada chamada sobrescrevia a anterior e
    // `liberar()` resolvia apenas a última — a promessa da lista ficava
    // pendente para sempre, e a região nunca parava de anunciar carregamento.
    const pendentes = [];
    const liberar = () =>
      pendentes.forEach((resolve) =>
        resolve({
          data: {
            chamados: [],
            paginacao: { pagina: 1, limite: 20, total: 0, paginas: 0 },
            totais: { em_aberto: 0 },
          },
        })
      );
    api.get.mockImplementation(() => new Promise((resolve) => pendentes.push(resolve)));

    const { container } = montar();

    // O esqueleto é decoração: quem usa leitor de tela não ganha nada ouvindo
    // a descrição de um retângulo cinza. Quem anuncia é a região.
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(screen.getByText('Carregando...')).toHaveClass('sr-only');
    // aria-hidden fica no invólucro do esqueleto; as barras herdam dele.
    expect(container.querySelector('.animate-pulse').closest('[aria-hidden="true"]')).not.toBeNull();

    liberar();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
  });
});

describe('Hierarquia de cabeçalhos', () => {
  it('a tela tem um h1, e não começa no segundo nível', async () => {
    responder([]);
    const { container } = montar();

    // As telas internas começavam em h2 sem h1 nenhum na página: quem navega
    // por cabeçalhos encontrava uma árvore sem raiz.
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Chamados' })).toBeInTheDocument()
    );

    conferirCabecalhos(container);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  baixarArquivo: vi.fn(),
}));

vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ usuario: { id: 1, nome: 'Gestora', perfil: 'gestor' } }),
}));

import api from '../src/api/client';
import AvisoDoAgendador from '../src/components/AvisoDoAgendador';
import ExpedienteEFeriados from '../src/components/ExpedienteEFeriados';
import Relatorios from '../src/pages/Relatorios';

describe('Aviso de agendador parado', () => {
  it('em dia, não ocupa espaço nenhum', async () => {
    api.get.mockResolvedValue({
      data: { tarefas: [{ tarefa: 'notificar-atrasos', rotulo: 'Aviso de atraso', situacao: 'ok' }] },
    });
    const { container } = render(<AvisoDoAgendador />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/operacao/agendador'));
    expect(container).toBeEmptyDOMElement();
  });

  it('diz qual tarefa parou, qual falhou e qual nunca rodou', async () => {
    api.get.mockResolvedValue({
      data: {
        tarefas: [
          { tarefa: 'notificar-atrasos', rotulo: 'Aviso de atraso', situacao: 'parada', ultimo_sucesso: '2026-10-07T09:00:00Z' },
          { tarefa: 'gerar-preventivas', rotulo: 'Manutenção preventiva', situacao: 'falhando', ultimo_erro: 'timeout' },
        ],
      },
    });
    render(<AvisoDoAgendador />);
    expect(await screen.findByText('Tarefas automáticas paradas')).toBeInTheDocument();
    expect(screen.getByText(/Aviso de atraso: a última passagem com sucesso foi 07\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText('Manutenção preventiva: a última passagem falhou (timeout).')).toBeInTheDocument();
  });

  it('se a consulta falha, não inventa alarme', async () => {
    api.get.mockRejectedValue(new Error('rede'));
    const { container } = render(<AvisoDoAgendador />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Expediente e feriados', () => {
  function abrir() {
    api.get.mockImplementation(async (caminho) => {
      if (caminho === '/sla/expediente') {
        return {
          data: {
            expediente: [1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, inicio: '08:00', fim: '18:00' })),
          },
        };
      }
      if (caminho === '/sla/feriados') return { data: { feriados: [{ data: '2026-11-15', descricao: 'Proclamação' }] } };
      return { data: {} };
    });
    api.put.mockResolvedValue({ data: {} });
    api.post.mockResolvedValue({ data: {} });
    api.delete.mockResolvedValue({ data: {} });
    return render(<ExpedienteEFeriados />);
  }

  it('salva a semana inteira, só com os dias marcados', async () => {
    const usuario = userEvent.setup();
    abrir();
    const sexta = await screen.findByRole('checkbox', { name: 'Sexta' });
    expect(sexta).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Sábado' })).not.toBeChecked();

    await usuario.click(sexta);
    await usuario.click(screen.getByRole('checkbox', { name: 'Sábado' }));
    const fimSabado = screen.getByLabelText('Fim do expediente: Sábado');
    await usuario.clear(fimSabado);
    await usuario.type(fimSabado, '12:00');
    await usuario.click(screen.getByRole('button', { name: 'Salvar expediente' }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const { dias } = api.put.mock.calls[0][1];
    expect(dias.map((d) => d.dia_semana)).toEqual([1, 2, 3, 4, 6]);
    expect(dias.find((d) => d.dia_semana === 6)).toEqual({ dia_semana: 6, inicio: '08:00', fim: '12:00' });
  });

  it('sem nenhum dia, avisa que a régua volta a ser a corrida', async () => {
    const usuario = userEvent.setup();
    abrir();
    for (const dia of ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta']) {
      await usuario.click(await screen.findByRole('checkbox', { name: dia }));
    }
    expect(screen.getByText(/passam a correr como horas corridas/)).toBeInTheDocument();
  });

  it('lista, cadastra e remove feriado', async () => {
    const usuario = userEvent.setup();
    abrir();
    expect(await screen.findByText('15/11/2026')).toBeInTheDocument();

    await usuario.type(screen.getByLabelText('Data'), '2026-12-25');
    await usuario.type(screen.getByLabelText('Descrição'), 'Natal');
    await usuario.click(screen.getByRole('button', { name: 'Adicionar' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/sla/feriados', { data: '2026-12-25', descricao: 'Natal' })
    );

    await usuario.click(screen.getByRole('button', { name: 'Remover feriado de 15/11/2026' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/sla/feriados/2026-11-15'));
  });
});


// As respostas mínimas para a tela de Relatórios abrir; `historico` responde /sla/historico.
function respostasDeRelatorios(historico = []) {
    api.get.mockImplementation(async (caminho) => {
    if (caminho === '/sla') {
      return { data: { sla: [{ prioridade: 'media', prazo_horas: 72, contagem: 'corridas' }] } };
    }
    if (caminho === '/relatorios/resumo') {
      return {
        data: {
          totais: { total: 0, em_aberto: 0, concluidos: 0, cancelados: 0 },
          por_estado: [],
          por_categoria: [],
          por_prioridade: [],
          por_local: [],
        },
      };
    }
    if (caminho === '/relatorios/desempenho') {
      return {
        data: {
          geral: {},
          marcos: {},
          por_categoria: [],
          avaliacoes: {},
          prazo: { percentual_no_prazo: null, concluidos_no_prazo: 0, concluidos_com_prazo: 0, em_aberto: 0, em_aberto_atrasados: 0 },
        },
      };
    }
    if (caminho === '/relatorios/tecnicos') return { data: { tecnicos: [] } };
    if (caminho === '/sla/historico') return { data: { versoes: historico } };
    throw new Error('fora do teste');
  });
}

describe('Régua do prazo nos relatórios', () => {
  it('trocar para horas úteis grava a contagem da prioridade', async () => {
    const usuario = userEvent.setup();
    respostasDeRelatorios();
    api.patch.mockResolvedValue({ data: {} });

    render(
      <MemoryRouter>
        <Relatorios />
      </MemoryRouter>
    );

    const regua = await screen.findByLabelText('Contagem do prazo Média');
    expect(regua).toHaveValue('corridas');
    await usuario.selectOptions(regua, 'uteis');
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/sla/media', { contagem: 'uteis' }));
    expect(
      within(regua.closest('label').parentElement.parentElement).getByRole('link', {
        name: 'ajustar expediente e feriados',
      })
    ).toHaveAttribute('href', '/cadastros?aba=expediente');
  });
  // RN12: o histórico de versões fica junto dos campos de prazo, e uma alteração
  // feita com ele aberto aparece sem recarregar a página.
  it('o histórico de prazos abre na tela de Relatórios e se atualiza quando um prazo muda', async () => {
    const usuario = userEvent.setup();
    respostasDeRelatorios([
      { id: 1, prioridade: 'media', prazo_horas: 72, contagem: 'corridas', vigente_desde: '2026-09-17T12:00:00Z', vigente_ate: null, alterado_por: null },
    ]);
    api.patch.mockResolvedValue({ data: {} });
    render(
      <MemoryRouter>
        <Relatorios />
      </MemoryRouter>
    );

    await usuario.click(await screen.findByText('Histórico de alterações dos prazos'));
    expect(await screen.findByText('Média: 72 h corridas')).toBeInTheDocument();
    const consultas = () => api.get.mock.calls.filter(([caminho]) => caminho === '/sla/historico').length;
    const antes = consultas();

    const regua = screen.getByLabelText('Contagem do prazo Média');
    await usuario.selectOptions(regua, 'uteis');

    await waitFor(() => expect(consultas()).toBe(antes + 1));
    // Alterar um prazo não recarrega a tela: o campo em que a pessoa estava
    // continua sendo o mesmo, com o foco e a posição da página.
    expect(regua.isConnected).toBe(true);
    expect(screen.queryByText('Carregando...')).toBeNull();
  });
});

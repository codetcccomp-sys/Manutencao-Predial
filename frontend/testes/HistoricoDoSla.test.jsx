import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api/client', () => ({ default: { get: vi.fn() } }));

import api from '../src/api/client';
import HistoricoDoSla from '../src/components/HistoricoDoSla';

/**
 * RN12: as versões da política de prazos, com vigência e autor, na tela onde
 * o prazo é alterado.
 */
const VERSOES = [
  { id: 3, prioridade: 'alta', prazo_horas: 16, contagem: 'uteis', vigente_desde: '2026-10-09T13:00:00Z', vigente_ate: null, alterado_por: 'Ana Gestora' },
  { id: 1, prioridade: 'alta', prazo_horas: 24, contagem: 'corridas', vigente_desde: '2026-09-17T12:00:00Z', vigente_ate: '2026-10-09T13:00:00Z', alterado_por: null },
];

const abrir = (user) => user.click(screen.getByText('Histórico de alterações dos prazos'));

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({ data: { versoes: VERSOES } });
});

describe('Histórico de versões do SLA (RN12)', () => {
  it('fechado, não consulta nada', () => {
    render(<HistoricoDoSla versao={0} />);

    expect(api.get).not.toHaveBeenCalled();
  });

  it('aberto, mostra a versão em vigor com o prazo, a régua, desde quando e quem alterou', async () => {
    const user = userEvent.setup();
    render(<HistoricoDoSla versao={0} />);

    await abrir(user);

    // O evento `toggle` do <details> é assíncrono: a consulta sai depois do clique.
    expect(await screen.findByText('Alta: 16 h úteis')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/sla/historico');
    expect(screen.getByText(/^Em vigor desde .*2026.*, por Ana Gestora$/)).toBeInTheDocument();
  });

  it('a versão antiga mostra o intervalo em que valeu, sem inventar autor', async () => {
    const user = userEvent.setup();
    render(<HistoricoDoSla versao={0} />);

    await abrir(user);

    expect(await screen.findByText('Alta: 24 h corridas')).toBeInTheDocument();
    const intervalo = screen.getByText(/^De .* a .*$/);
    expect(intervalo.textContent).not.toMatch(/por /);
  });

  it('consulta de novo quando um prazo muda com o histórico aberto', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<HistoricoDoSla versao={0} />);
    await abrir(user);
    await screen.findByText('Alta: 16 h úteis');

    rerender(<HistoricoDoSla versao={1} />);

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('falha ao carregar aparece como erro, e não como lista vazia', async () => {
    api.get.mockRejectedValue(new Error('rede'));
    const user = userEvent.setup();
    render(<HistoricoDoSla versao={0} />);

    await abrir(user);

    expect(await screen.findByText('Não foi possível carregar o histórico.')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma alteração registrada.')).toBeNull();
  });
});

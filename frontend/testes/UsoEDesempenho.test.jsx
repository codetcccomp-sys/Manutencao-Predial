import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api/client', () => ({ default: { get: vi.fn() } }));

import api from '../src/api/client';
import UsoEDesempenho from '../src/components/UsoEDesempenho';

/** O painel de uso e desempenho do administrador (migração 031). */

const RESUMO = {
  dias: 7,
  retencao_dias: 90,
  limites: { LCP: 2500, FCP: 1800, CLS: 0.1, INP: 200 },
  erros_da_tela_24h: 3,
  telas: [
    {
      tela: '/relatorios',
      aberturas: 1240,
      desempenho: {
        LCP: { medidas: 100, media: 1240, percentual_acima_do_limite: 12, maximo: 5000 },
        FCP: { medidas: 100, media: 800, percentual_acima_do_limite: 0, maximo: 1500 },
        CLS: { medidas: 100, media: 0.034, percentual_acima_do_limite: 4, maximo: 0.3 },
      },
    },
    { tela: '/chamados/:id', aberturas: 90, desempenho: {} },
  ],
  acoes: [
    { acao: 'chamado_aberto', total: 31 },
    { acao: 'relatorio_baixado', total: 4 },
  ],
};

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({ data: RESUMO });
});

async function abrir() {
  const usuario = userEvent.setup();
  render(<UsoEDesempenho />);
  await usuario.click(screen.getByText('Ver o uso dos últimos dias'));
  return usuario;
}

describe('Uso e desempenho', () => {
  it('só consulta a API quando o painel é aberto', async () => {
    render(<UsoEDesempenho />);
    expect(api.get).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByText('Ver o uso dos últimos dias'));

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/operacao/telemetria'));
  });

  it('mostra por tela as aberturas e a média de cada medida, com quantas passaram do limite', async () => {
    await abrir();

    const tabela = await screen.findByRole('table', { name: 'Uso e desempenho de cada tela' });
    const linha = within(tabela).getByRole('row', { name: /Relatórios/ });
    expect(linha).toHaveTextContent('1.240');
    expect(linha).toHaveTextContent('1.240 ms (12% acima)');
    expect(linha).toHaveTextContent('800 ms');
    expect(linha).not.toHaveTextContent('800 ms (');
    expect(linha).toHaveTextContent('0,034 (4% acima)');
    // Medida que não houve aparece como traço, e não como zero.
    expect(within(tabela).getByRole('row', { name: /Chamado/ })).toHaveTextContent('—');
  });

  it('lista as ações e explica o limite de cada medida', async () => {
    await abrir();

    expect(await screen.findByText('Chamados abertos:')).toBeInTheDocument();
    expect(screen.getByText('Relatórios baixados:')).toBeInTheDocument();
    expect(screen.getByText(/2\.500 ms \(LCP\)/)).toBeInTheDocument();
    expect(screen.getByText(/Mede a carga da página/)).toBeInTheDocument();
  });

  it('diz que não há dado de pessoa e que "Não rastrear" é respeitado', async () => {
    await abrir();

    expect(await screen.findByText(/sem dado de pessoa/i)).toBeInTheDocument();
    expect(screen.getByText(/quem liga “Não rastrear” no navegador não entra nelas/)).toBeInTheDocument();
    expect(screen.getByText(/3 erros de tela nas últimas 24 horas/)).toBeInTheDocument();
  });

  it('sem medidas no período, diz isso em vez de mostrar uma tabela vazia', async () => {
    api.get.mockResolvedValue({ data: { ...RESUMO, telas: [], acoes: [], erros_da_tela_24h: 1 } });
    await abrir();

    expect(await screen.findByText('Ainda não há medidas neste período.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/1 erro de tela nas últimas 24 horas/)).toBeInTheDocument();
  });

  it('se a consulta falha, diz que não foi possível carregar', async () => {
    api.get.mockRejectedValue(new Error('rede'));
    await abrir();

    expect(await screen.findByText('Não foi possível carregar o uso e o desempenho.')).toBeInTheDocument();
  });
});

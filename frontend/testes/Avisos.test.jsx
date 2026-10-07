import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const navegar = vi.fn();
vi.mock('react-router', async () => {
  const real = await vi.importActual('react-router');
  return { ...real, useNavigate: () => navegar };
});

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn(), patch: vi.fn() },
}));

import api from '../src/api/client';
import Avisos from '../src/components/Avisos';

function aviso(extra = {}) {
  return {
    id: 1,
    tipo: 'atraso',
    mensagem: 'O chamado SMP-1 passou do prazo em 3 horas.',
    lida: false,
    data: new Date().toISOString(),
    protocolo: 'SMP-1',
    chamado_id: 7,
    ...extra,
  };
}

/**
 * Duplê com estado, e não um `mockResolvedValue` fixo.
 *
 * O componente recarrega a lista depois de marcar como lida — de propósito,
 * para que uma marcação que falhou no servidor volte a aparecer como não
 * lida. Um duplê que devolvesse sempre a mesma resposta desfaria a marcação a
 * cada recarga e faria o teste acusar um defeito que não existe.
 */
function montar(lista) {
  const estado = lista.map((a) => ({ ...a }));

  api.get.mockImplementation(async () => ({
    data: { notificacoes: estado.map((a) => ({ ...a })) },
  }));
  api.patch.mockImplementation(async (caminho) => {
    const id = Number(caminho.match(/\/notificacoes\/(\d+)\/lida/)[1]);
    const alvo = estado.find((a) => a.id === id);
    if (alvo) alvo.lida = true;
    return {};
  });

  const resultado = render(
    <MemoryRouter>
      <Avisos />
    </MemoryRouter>
  );
  return { ...resultado, estado };
}

const sino = () => screen.getByRole('button', { name: /avisos/i });

beforeEach(() => {
  navegar.mockClear();
});

describe('Contador do sino', () => {
  it('mostra quantos avisos não lidos existem', async () => {
    montar([aviso({ id: 1 }), aviso({ id: 2 }), aviso({ id: 3, lida: true })]);

    await waitFor(() => expect(sino()).toHaveAccessibleName('Avisos: 2 não lidos'));
    expect(within(sino()).getByText('2')).toBeInTheDocument();
  });

  it('sem nada por ler, não anuncia número', async () => {
    montar([aviso({ lida: true })]);

    await waitFor(() => expect(sino()).toHaveAccessibleName('Avisos'));
    expect(within(sino()).queryByText(/^\d+$/)).toBeNull();
  });

  it('acima de nove mostra 9+, para o número não estourar o selo', async () => {
    montar(Array.from({ length: 12 }, (_, i) => aviso({ id: i + 1 })));

    await waitFor(() => expect(within(sino()).getByText('9+')).toBeInTheDocument());
    // O rótulo acessível continua exato: quem usa leitor de tela recebe o
    // número real, não a abreviação visual.
    expect(sino()).toHaveAccessibleName('Avisos: 12 não lidos');
  });

  it('falha de rede não quebra o cabeçalho', async () => {
    api.get.mockRejectedValue(new Error('sem rede'));
    render(
      <MemoryRouter>
        <Avisos />
      </MemoryRouter>
    );

    // Aviso é acessório: uma faixa de erro no cabeçalho a cada oscilação de
    // rede atrapalharia o trabalho em vez de ajudar.
    await waitFor(() => expect(sino()).toBeInTheDocument());
    expect(sino()).toHaveAccessibleName('Avisos');
  });
});

describe('Painel', () => {
  it('abre com a lista e fecha ao clicar de novo', async () => {
    const usuario = userEvent.setup();
    montar([aviso()]);
    await waitFor(() => expect(sino()).toHaveAccessibleName(/2 não lidos|1 não lidos/));

    await usuario.click(sino());
    expect(screen.getByText(/passou do prazo/)).toBeInTheDocument();

    await usuario.click(sino());
    expect(screen.queryByText(/passou do prazo/)).toBeNull();
  });

  it('classifica o aviso pelo tipo, em português', async () => {
    const usuario = userEvent.setup();
    montar([aviso({ tipo: 'comentario' })]);
    await waitFor(() => expect(sino()).toHaveAccessibleName(/não lidos/));

    await usuario.click(sino());
    // O rótulo escrito é o que carrega a informação: a RNF02 pede não
    // depender só de cor para comunicar estado.
    expect(screen.getByText('Comentário')).toBeInTheDocument();
  });

  it('sem avisos, diz que não há em vez de mostrar lista vazia', async () => {
    const usuario = userEvent.setup();
    montar([]);
    await waitFor(() => expect(sino()).toBeInTheDocument());

    await usuario.click(sino());
    expect(screen.getByText('Nenhum aviso por aqui.')).toBeInTheDocument();
  });

  it('não oferece "marcar todos" quando está tudo lido', async () => {
    const usuario = userEvent.setup();
    montar([aviso({ lida: true })]);
    await waitFor(() => expect(sino()).toBeInTheDocument());

    await usuario.click(sino());
    expect(screen.queryByText('Marcar todos como lidos')).toBeNull();
  });
});

describe('Ações', () => {
  it('clicar no aviso marca como lido e abre o chamado', async () => {
    const usuario = userEvent.setup();
    montar([aviso({ id: 42, chamado_id: 7 })]);
    await waitFor(() => expect(sino()).toHaveAccessibleName(/não lidos/));

    await usuario.click(sino());
    await usuario.click(screen.getByText(/passou do prazo/));

    expect(api.patch).toHaveBeenCalledWith('/notificacoes/42/lida');
    expect(navegar).toHaveBeenCalledWith('/chamados/7');
  });

  it('aviso já lido não é marcado de novo', async () => {
    const usuario = userEvent.setup();
    montar([aviso({ lida: true })]);
    await waitFor(() => expect(sino()).toBeInTheDocument());

    await usuario.click(sino());
    await usuario.click(screen.getByText(/passou do prazo/));

    expect(api.patch).not.toHaveBeenCalled();
    expect(navegar).toHaveBeenCalled();
  });

  it('falha ao marcar não impede a navegação', async () => {
    const usuario = userEvent.setup();
    montar([aviso({ chamado_id: 9 })]);
    api.patch.mockRejectedValue(new Error('falhou'));
    await waitFor(() => expect(sino()).toHaveAccessibleName(/não lidos/));

    await usuario.click(sino());
    await usuario.click(screen.getByText(/passou do prazo/));

    // Marcar como lida é conveniência; travar a navegação por causa dela
    // seria trocar um problema pequeno por um grande.
    await waitFor(() => expect(navegar).toHaveBeenCalledWith('/chamados/9'));
  });

  it('"marcar todos" zera o contador e chama uma vez por aviso pendente', async () => {
    const usuario = userEvent.setup();
    montar([aviso({ id: 1 }), aviso({ id: 2 }), aviso({ id: 3, lida: true })]);
    await waitFor(() => expect(sino()).toHaveAccessibleName('Avisos: 2 não lidos'));

    await usuario.click(sino());
    await usuario.click(screen.getByText('Marcar todos como lidos'));

    await waitFor(() => expect(sino()).toHaveAccessibleName('Avisos'));
    expect(api.patch).toHaveBeenCalledTimes(2);
  });
});

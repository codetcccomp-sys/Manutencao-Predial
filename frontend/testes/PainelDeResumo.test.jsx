import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import CartaoDeChamado from '../src/components/chamados/CartaoDeChamado';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn() },
}));
import api from '../src/api/client';

/**
 * O painel de resumo existe para espiar um chamado sem sair da lista. Se ele
 * abrir sem foco, não fechar no Esc, prender a página, ou levar a pessoa a uma
 * tela que ela não pediu, é pior que a navegação direta que já existia.
 */

const CHAMADO = {
  id: 7,
  protocolo: 'SMP-2026-0007',
  titulo: 'Vazamento no banheiro do bloco A',
  estado: 'aberto',
  prioridade: 'alta',
  em_atraso: false,
};

const DETALHE = {
  ...CHAMADO,
  descricao: 'A torneira da pia está pingando há dois dias.',
  local_rotulo: 'Bloco A · 1º andar',
  categoria_nome: 'Hidráulica',
  prazo_estimado: null,
};

function Palco() {
  return (
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <ul>
              <CartaoDeChamado chamado={CHAMADO} />
            </ul>
          }
        />
        <Route path="/chamados/:id" element={<p>Tela cheia do chamado</p>} />
      </Routes>
    </MemoryRouter>
  );
}

const botaoResumo = () => screen.getByRole('button', { name: /ver resumo/i });
const painel = () => screen.queryByRole('dialog');

describe('Painel lateral de resumo do chamado', () => {
  it('não existe na página enquanto ninguém pede', () => {
    render(<Palco />);
    expect(painel()).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('abre ao clicar, busca o chamado e mostra descrição, local e categoria', async () => {
    api.get.mockResolvedValue({ data: { chamado: DETALHE } });
    render(<Palco />);

    await userEvent.click(botaoResumo());

    expect(painel()).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/chamados/7');
    expect(await screen.findByText('A torneira da pia está pingando há dois dias.')).toBeInTheDocument();
    expect(screen.getByText('Bloco A · 1º andar')).toBeInTheDocument();
    expect(screen.getByText('Hidráulica')).toBeInTheDocument();
  });

  it('o foco entra no painel e Esc fecha devolvendo o foco ao botão', async () => {
    api.get.mockResolvedValue({ data: { chamado: DETALHE } });
    render(<Palco />);
    const abrir = botaoResumo();

    await userEvent.click(abrir);
    expect(screen.getByRole('button', { name: 'Fechar resumo' })).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    expect(painel()).toBeNull();
    expect(abrir).toHaveFocus();
  });

  it('clicar no fundo escurecido fecha, clicar dentro do painel não', async () => {
    api.get.mockResolvedValue({ data: { chamado: DETALHE } });
    render(<Palco />);
    await userEvent.click(botaoResumo());

    await userEvent.click(screen.getByText('Resumo do chamado'));
    expect(painel()).toBeInTheDocument();

    await userEvent.click(painel().parentElement);
    expect(painel()).toBeNull();
  });

  it('a página atrás não rola enquanto está aberto, e volta a rolar depois', async () => {
    api.get.mockResolvedValue({ data: { chamado: DETALHE } });
    render(<Palco />);

    await userEvent.click(botaoResumo());
    expect(document.body.style.overflow).toBe('hidden');

    await userEvent.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('"Abrir chamado completo" leva à tela cheia do chamado', async () => {
    api.get.mockResolvedValue({ data: { chamado: DETALHE } });
    render(<Palco />);
    await userEvent.click(botaoResumo());

    await userEvent.click(screen.getByRole('link', { name: 'Abrir chamado completo' }));
    expect(await screen.findByText('Tela cheia do chamado')).toBeInTheDocument();
  });

  it('diz o que houve quando o chamado não carrega, sem prender a pessoa', async () => {
    api.get.mockRejectedValue(new Error('falhou'));
    render(<Palco />);
    await userEvent.click(botaoResumo());

    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível carregar o resumo/i);
    // Fechar continua possível: o erro não pode ser uma armadilha.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(painel()).toBeNull());
  });

  it('o cartão continua sendo um link para a tela cheia, e o botão é irmão dele', () => {
    render(<Palco />);
    const link = screen.getByRole('link', { name: /vazamento no banheiro/i });

    expect(link).toHaveAttribute('href', '/chamados/7');
    // Botão dentro de âncora é interativo dentro de interativo.
    expect(link.contains(botaoResumo())).toBe(false);
  });
});

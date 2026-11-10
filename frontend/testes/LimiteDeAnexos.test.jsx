import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api/client', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));

import api from '../src/api/client';
import LimiteDeAnexos from '../src/components/LimiteDeAnexos';

/**
 * RF03: a administração define quantos anexos cabem num chamado (tela de Usuários).
 */
const campo = () => screen.findByRole('spinbutton', { name: 'Limite de anexos por chamado' });

beforeEach(() => {
  api.get.mockReset();
  api.patch.mockReset();
  api.get.mockResolvedValue({ data: { configuracoes: { anexos_por_chamado: 10 } } });
  api.patch.mockImplementation(async (_, corpo) => ({ data: { configuracoes: corpo } }));
});

async function trocarPara(user, texto) {
  const entrada = await campo();
  await user.clear(entrada);
  if (texto) await user.type(entrada, texto);
  await user.click(screen.getByRole('button', { name: 'Salvar limite' }));
}

describe('Limite de anexos por chamado (RF03)', () => {
  it('mostra o limite em vigor e a faixa aceita', async () => {
    render(<LimiteDeAnexos />);

    expect(await campo()).toHaveValue(10);
    expect(api.get).toHaveBeenCalledWith('/configuracoes');
    expect(screen.getByText(/De 1 a 20\./)).toBeInTheDocument();
  });

  it('salva o número novo e confirma o que passou a valer', async () => {
    const user = userEvent.setup();
    render(<LimiteDeAnexos />);

    await trocarPara(user, '15');

    expect(api.patch).toHaveBeenCalledWith('/configuracoes', { anexos_por_chamado: 15 });
    expect(await screen.findByText('Limite alterado: cada chamado aceita até 15 anexos.')).toBeInTheDocument();
    expect(await campo()).toHaveValue(15);
  });

  it('com limite de um, a confirmação fala em "1 anexo"', async () => {
    const user = userEvent.setup();
    render(<LimiteDeAnexos />);

    await trocarPara(user, '1');

    expect(await screen.findByText('Limite alterado: cada chamado aceita até 1 anexo.')).toBeInTheDocument();
  });

  it.each(['0', '21', '2.5', ''])('"%s" é recusado na tela, sem chamar o servidor', async (texto) => {
    const user = userEvent.setup();
    render(<LimiteDeAnexos />);

    await trocarPara(user, texto);

    expect(await screen.findByText('Informe um número inteiro de 1 a 20.')).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('salvar o mesmo valor não chama o servidor, e diz que nada mudou', async () => {
    const user = userEvent.setup();
    render(<LimiteDeAnexos />);

    await trocarPara(user, '10');

    expect(await screen.findByText('O limite já é de 10 anexos por chamado.')).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('a recusa do servidor aparece com a mensagem dele, e o limite em vigor não muda', async () => {
    api.patch.mockRejectedValue({ response: { data: { erro: { mensagem: 'Acesso negado para o seu perfil.' } } } });
    const user = userEvent.setup();
    render(<LimiteDeAnexos />);

    await trocarPara(user, '5');
    expect(await screen.findByText('Acesso negado para o seu perfil.')).toBeInTheDocument();

    // O limite gravado continua 10: salvar 10 agora não manda nada.
    api.patch.mockClear();
    await trocarPara(user, '10');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('se a configuração não carrega, mostra o erro e não oferece um campo vazio', async () => {
    api.get.mockRejectedValue(new Error('rede'));
    render(<LimiteDeAnexos />);

    expect(await screen.findByText('Não foi possível carregar o limite de anexos.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('spinbutton')).toBeNull());
  });
});

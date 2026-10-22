import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn() },
}));

import api from '../src/api/client';
import AvisoDeEspaco from '../src/components/AvisoDeEspaco';

const MB = 1024 * 1024;

function uso(extra = {}) {
  return {
    banco_bytes: 360 * MB,
    limite_bytes: 500 * MB,
    percentual: 72,
    alerta: true,
    anexos_no_banco: 240,
    anexos_no_banco_bytes: 180 * MB,
    anexos_no_storage: 0,
    modo: 'banco',
    ...extra,
  };
}

beforeEach(() => {
  api.get.mockReset();
});

describe('Aviso de espaço do banco', () => {
  it('passando do limiar, diz quanto está usado e o que fazer', async () => {
    api.get.mockResolvedValue({ data: uso() });

    render(<AvisoDeEspaco />);

    expect(await screen.findByText('O espaço do banco está acabando')).toBeInTheDocument();
    expect(screen.getByText(/360 MB de 500 MB/)).toBeInTheDocument();
    expect(screen.getByText(/72%/)).toBeInTheDocument();
    expect(screen.getByText(/240 anexos guardados no banco ocupam 180 MB/)).toBeInTheDocument();
    expect(screen.getByText(/Ligue o Storage/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/operacao/armazenamento');
  });

  it('com o Storage já ligado, não manda ligar de novo', async () => {
    api.get.mockResolvedValue({ data: uso({ modo: 'supabase', anexos_no_banco: 0 }) });

    render(<AvisoDeEspaco />);

    expect(await screen.findByText(/anexos novos já vão para o Storage/)).toBeInTheDocument();
    expect(screen.queryByText(/Ligue o Storage/)).toBeNull();
  });

  it('com espaço folgado, não ocupa lugar nenhum', async () => {
    api.get.mockResolvedValue({ data: uso({ alerta: false, percentual: 12 }) });

    const { container } = render(<AvisoDeEspaco />);

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('se a consulta falhar, também não aparece: aviso de espaço não pode quebrar o painel', async () => {
    api.get.mockRejectedValue({ response: { status: 500 } });

    const { container } = render(<AvisoDeEspaco />);

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

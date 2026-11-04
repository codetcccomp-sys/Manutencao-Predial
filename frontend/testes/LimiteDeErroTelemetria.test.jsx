import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../src/monitoramento', () => ({ registrarErro: vi.fn() }));

import LimiteDeErro from '../src/components/LimiteDeErro';
import { registrarErro } from '../src/monitoramento';

/** O erro que derruba uma tela chega à administração, e a pessoa vê onde pedir ajuda. */

function Quebrada() {
  throw new Error('falha ao desenhar a tela');
}

describe('Erro de tela', () => {
  it('avisa a administração e mostra a mensagem com o caminho para o suporte', () => {
    const console_ = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <LimiteDeErro>
        <Quebrada />
      </LimiteDeErro>
    );
    console_.mockRestore();

    expect(registrarErro).toHaveBeenCalledWith(expect.objectContaining({ message: 'falha ao desenhar a tela' }));
    expect(screen.getByText(/Não foi possível abrir esta tela/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ajuda e suporte' })).toHaveAttribute('href', '/suporte');
  });
});

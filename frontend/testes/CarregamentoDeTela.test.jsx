import { lazy } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CarregamentoDeTela, { ehFalhaDeCarregamento } from '../src/components/CarregamentoDeTela';

/**
 * Cada teste cria o seu próprio React.lazy: o componente guarda a promessa
 * (resolvida ou rejeitada) para sempre, então um lazy compartilhado carregaria
 * o resultado de um teste para o seguinte.
 */

const MENSAGEM_DO_CHROME =
  'Failed to fetch dynamically imported module: https://app.teste/assets/Relatorios-AbC123.js';

// O React escreve o erro capturado no console; nos testes de falha isso só
// polui a saída.
function silenciarConsole() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CarregamentoDeTela', () => {
  it('enquanto o pedaço chega, anuncia o carregamento e marca a região como ocupada', () => {
    const Tela = lazy(() => new Promise(() => {}));
    const { container } = render(
      <CarregamentoDeTela>
        <Tela />
      </CarregamentoDeTela>
    );

    // O esqueleto é só visual: quem avisa o leitor de tela é o texto reservado.
    expect(screen.getByText('Carregando a tela...')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('quando o pedaço chega, mostra a tela no lugar do esqueleto', async () => {
    const Tela = lazy(() => Promise.resolve({ default: () => <p>Relatório pronto</p> }));
    render(
      <CarregamentoDeTela>
        <Tela />
      </CarregamentoDeTela>
    );

    expect(await screen.findByText('Relatório pronto')).toBeInTheDocument();
    expect(screen.queryByText('Carregando a tela...')).not.toBeInTheDocument();
  });

  it('quando o pedaço não chega, explica o que houve e recarrega a página inteira', async () => {
    silenciarConsole();
    const recarregar = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: recarregar });
    const Tela = lazy(() => Promise.reject(new TypeError(MENSAGEM_DO_CHROME)));
    render(
      <CarregamentoDeTela>
        <Tela />
      </CarregamentoDeTela>
    );

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Não foi possível abrir esta tela');
    expect(aviso).toHaveTextContent('O sistema pode ter sido atualizado');

    // Recarregar de verdade: renderizar de novo repetiria a promessa rejeitada.
    await userEvent.click(screen.getByRole('button', { name: 'Recarregar a página' }));
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it('sem conexão, diz que a tela precisa de conexão na primeira abertura', async () => {
    silenciarConsole();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const Tela = lazy(() => Promise.reject(new TypeError(MENSAGEM_DO_CHROME)));
    render(
      <CarregamentoDeTela>
        <Tela />
      </CarregamentoDeTela>
    );

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('precisa de conexão na primeira vez');
    expect(aviso).not.toHaveTextContent('foi atualizado');
  });

  it('outro erro de renderização não vira o aviso de recarregar: segue adiante', () => {
    silenciarConsole();
    function Quebrada() {
      throw new Error('boom');
    }

    expect(() =>
      render(
        <CarregamentoDeTela>
          <Quebrada />
        </CarregamentoDeTela>
      )
    ).toThrow('boom');
    expect(screen.queryByRole('button', { name: 'Recarregar a página' })).not.toBeInTheDocument();
  });
});

describe('ehFalhaDeCarregamento', () => {
  it.each([
    ['Chrome', new TypeError(MENSAGEM_DO_CHROME)],
    ['Firefox', new TypeError('error loading dynamically imported module: https://app.teste/x.js')],
    ['Safari', new TypeError('Importing a module script failed.')],
    ['pré-carga do Vite', new Error('Unable to preload CSS for /assets/Relatorios.css')],
  ])('reconhece a mensagem do %s', (_navegador, erro) => {
    expect(ehFalhaDeCarregamento(erro)).toBe(true);
  });

  it('não confunde com um defeito comum da tela', () => {
    expect(ehFalhaDeCarregamento(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(ehFalhaDeCarregamento(null)).toBe(false);
  });
});

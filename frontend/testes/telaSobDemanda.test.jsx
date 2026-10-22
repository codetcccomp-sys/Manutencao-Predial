import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import LimiteDeErro from '../src/components/LimiteDeErro';
import { MARCA_DE_RECARGA, telaSobDemanda } from '../src/dominio/telaSobDemanda';

/**
 * As telas de gestão vêm sob demanda (o arquivo principal caiu de 509 para 410 kB).
 *
 * O defeito novo que isso traz: depois de uma publicação os arquivos com hash da
 * versão antiga somem, e uma aba já aberta pede um pedaço que não existe mais. A
 * tela ficaria em branco. Recarregar uma vez resolve; em laço, não.
 */

const Tela = () => <h1>Tela carregada</h1>;

function abrir(Componente) {
  return render(
    <LimiteDeErro>
      <Suspense fallback={<p>Carregando...</p>}>
        <Componente />
      </Suspense>
    </LimiteDeErro>
  );
}

let recarregar;
beforeEach(() => {
  sessionStorage.clear();
  recarregar = vi.fn();
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload: recarregar });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('Tela sob demanda', () => {
  it('carrega a tela e limpa a marca de recarga', async () => {
    sessionStorage.setItem(MARCA_DE_RECARGA, '1');
    const Lazy = telaSobDemanda(() => Promise.resolve({ default: Tela }));

    abrir(Lazy);

    expect(await screen.findByRole('heading', { name: 'Tela carregada' })).toBeInTheDocument();
    expect(sessionStorage.getItem(MARCA_DE_RECARGA)).toBeNull();
  });

  it('se o pedaço sumiu (publicação nova), recarrega a página uma vez e não pisca erro', async () => {
    const Lazy = telaSobDemanda(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));

    abrir(Lazy);

    await waitFor(() => expect(recarregar).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(MARCA_DE_RECARGA)).toBe('1');
    expect(screen.queryByText(/Não foi possível abrir esta tela/)).toBeNull();
  });

  it('se já recarregou e continua falhando, mostra o erro em vez de recarregar em laço', async () => {
    sessionStorage.setItem(MARCA_DE_RECARGA, '1');
    const Lazy = telaSobDemanda(() => Promise.reject(new Error('sem rede')));

    abrir(Lazy);

    expect(await screen.findByText(/Não foi possível abrir esta tela/)).toBeInTheDocument();
    expect(recarregar).not.toHaveBeenCalled();
  });

  it('sem como lembrar que já recarregou, não arrisca o laço', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('sem armazenamento');
    });
    const Lazy = telaSobDemanda(() => Promise.reject(new Error('sem rede')));

    abrir(Lazy);

    expect(await screen.findByText(/Não foi possível abrir esta tela/)).toBeInTheDocument();
    expect(recarregar).not.toHaveBeenCalled();
  });

  it('o botão do erro recarrega a página', async () => {
    sessionStorage.setItem(MARCA_DE_RECARGA, '1');
    const usuario = userEvent.setup();
    abrir(telaSobDemanda(() => Promise.reject(new Error('sem rede'))));

    await usuario.click(await screen.findByRole('button', { name: 'Recarregar a página' }));

    expect(recarregar).toHaveBeenCalledTimes(1);
  });
});

describe('O que fica no arquivo principal', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');

  it('as telas de gestão vêm sob demanda', () => {
    for (const tela of ['Relatorios', 'Usuarios', 'Cadastros', 'Preventiva', 'Equipamento', 'Etiquetas', 'MinhaConta']) {
      expect(app, tela).toMatch(new RegExp(`const ${tela} = telaSobDemanda\\(\\(\\) => import\\('\\./pages/${tela}'\\)\\)`));
      expect(app, `${tela} não pode também ser importada direto`).not.toMatch(
        new RegExp(`^import ${tela} from`, 'm')
      );
    }
  });

  it('o que o técnico usa sem conexão fica no arquivo principal, não sob demanda', () => {
    // O service worker guarda a casca e as leituras da fila e do chamado. Um pedaço
    // que só é baixado ao abrir a rota não estaria guardado no subsolo.
    for (const tela of ['Inicio', 'NovoChamado', 'ChamadoDetalhe', 'Login']) {
      expect(app, tela).toMatch(new RegExp(`^import ${tela} from`, 'm'));
    }
  });
});

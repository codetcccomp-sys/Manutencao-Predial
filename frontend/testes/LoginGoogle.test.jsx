import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../src/api/client', async () => {
  const real = await vi.importActual('../src/api/client');
  return { ...real, default: { get: vi.fn(), post: vi.fn() } };
});

import api from '../src/api/client';
import { AuthProvider } from '../src/context/AuthContext';
import Login from '../src/pages/Login';

/**
 * Entrar com Google, pela tela. O Google de verdade não roda aqui: o teste
 * põe no lugar o objeto que o script do Google cria (`google.accounts.id`) e
 * guarda a função que o botão chamaria com a credencial.
 */

let devolverCredencial;
const googleFalso = {
  accounts: {
    id: {
      initialize: vi.fn(({ callback }) => {
        devolverCredencial = callback;
      }),
      // Como o do Google: acrescenta o botão ao contêiner, não o substitui. Um
      // fake que sobrescrevesse o conteúdo esconderia o botão antigo ficando
      // para trás, ao lado do novo.
      renderButton: vi.fn((lugar) => {
        const botao = document.createElement('div');
        botao.textContent = 'Fazer login com o Google';
        lugar.appendChild(botao);
      }),
    },
  },
};

function abrir() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { de: '/chamados/novo' } }]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/chamados/novo" element={<p>Formulário</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

const USUARIO = { id: 3, nome: 'Rita', email: 'rita@gmail.com', perfil: 'solicitante' };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  devolverCredencial = undefined;
  window.google = googleFalso;
});

afterEach(() => {
  delete window.google;
  document.head.querySelectorAll('script[src*="accounts.google.com"]').forEach((s) => s.remove());
});

describe('Botão do Google', () => {
  it('sem o ID do cliente no servidor, não aparece e o script do Google nem é pedido', async () => {
    delete window.google;
    api.get.mockResolvedValue({ data: { client_id: null } });
    abrir();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/google'));
    expect(screen.queryByTestId('botao-google')).not.toBeInTheDocument();
    expect(document.head.querySelector('script[src*="accounts.google.com"]')).toBeNull();
  });

  it('com o ID, carrega o botão com ele', async () => {
    api.get.mockResolvedValue({ data: { client_id: 'abc.apps.googleusercontent.com' } });
    abrir();
    expect(await screen.findByText('Fazer login com o Google')).toBeInTheDocument();
    expect(googleFalso.accounts.id.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 'abc.apps.googleusercontent.com', ux_mode: 'popup' })
    );
  });

  it('a credencial vai ao servidor e, com a conta pronta, entra e volta para onde ia', async () => {
    api.get.mockResolvedValue({ data: { client_id: 'abc' } });
    api.post.mockResolvedValue({ data: { token: 't', usuario: USUARIO } });
    abrir();
    await screen.findByText('Fazer login com o Google');

    await act(async () => devolverCredencial({ credential: 'credencial-do-google' }));
    expect(api.post).toHaveBeenCalledWith('/auth/google', { credencial: 'credencial-do-google' });
    expect(await screen.findByText('Formulário')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('smp_usuario'))).toEqual(USUARIO);
  });

  it('conta nova com a aprovação ligada: mostra a tela "Pedido enviado" e não entra', async () => {
    api.get.mockResolvedValue({ data: { client_id: 'abc' } });
    api.post.mockResolvedValue({ data: { aguardando_aprovacao: true } });
    abrir();
    await screen.findByText('Fazer login com o Google');

    await act(async () => devolverCredencial({ credential: 'c' }));
    // A mesma tela do cadastro por e-mail, e não um aviso sobre um formulário
    // que parece continuar valendo.
    const titulo = await screen.findByRole('heading', { level: 1, name: 'Pedido enviado' });
    expect(screen.getByText(/aguarda a aprovação da gestão/)).toBeInTheDocument();
    expect(screen.getByText(/entrar com o Google assim que ele for aprovado/)).toBeInTheDocument();
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument();
    expect(screen.queryByText('Formulário')).not.toBeInTheDocument();
    expect(localStorage.getItem('smp_usuario')).toBeNull();
    // O foco acompanha a troca de tela: o formulário que o tinha sumiu.
    expect(titulo).toHaveFocus();
  });

  it('"Voltar para o login" devolve o formulário', async () => {
    api.get.mockResolvedValue({ data: { client_id: 'abc' } });
    api.post.mockResolvedValue({ data: { aguardando_aprovacao: true } });
    abrir();
    await screen.findByText('Fazer login com o Google');
    await act(async () => devolverCredencial({ credential: 'c' }));
    await screen.findByRole('heading', { level: 1, name: 'Pedido enviado' });

    await userEvent.click(screen.getByRole('button', { name: 'Voltar para o login' }));
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pedido enviado' })).not.toBeInTheDocument();
  });

  it('com duas etapas ligadas, pede o código como no login por senha e diz de qual conta', async () => {
    api.get.mockResolvedValue({ data: { client_id: 'abc' } });
    api.post.mockResolvedValue({ data: { requer_2fa: true, desafio: 'd-1', email: 'bia@exemplo.com' } });
    abrir();
    await screen.findByText('Fazer login com o Google');

    await act(async () => devolverCredencial({ credential: 'c' }));
    expect(await screen.findByLabelText('Código')).toBeInTheDocument();
    // Pelo Google ninguém digitou o e-mail: a tela é quem diz em qual conta se está.
    expect(screen.getByText('bia@exemplo.com')).toBeInTheDocument();
    expect(localStorage.getItem('smp_usuario')).toBeNull();
  });

  it('a recusa do servidor aparece na tela', async () => {
    api.get.mockResolvedValue({ data: { client_id: 'abc' } });
    api.post.mockRejectedValue({
      response: { data: { erro: { mensagem: 'O Google não confirma este e-mail como seu. Entre com e-mail e senha.' } } },
    });
    abrir();
    await screen.findByText('Fazer login com o Google');

    await act(async () => devolverCredencial({ credential: 'c' }));
    expect(await screen.findByText(/não confirma este e-mail/)).toBeInTheDocument();
  });
});

describe('O botão do Google acompanha o espaço que tem', () => {
  // O jsdom não mede layout: a largura do contêiner e o aviso de que ele mudou
  // (ResizeObserver) são trocados por versões controladas. O que vale aqui é a
  // decisão do componente; o layout de verdade está em e2e/google.spec.js.
  let largura;
  let avisarMudanca;

  beforeEach(() => {
    largura = 300;
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => largura);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb) {
          avisarMudanca = cb;
        }
        observe() {}
        disconnect() {}
      }
    );
    api.get.mockResolvedValue({ data: { client_id: 'abc' } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const largurasDesenhadas = () => googleFalso.accounts.id.renderButton.mock.calls.map(([, opcoes]) => opcoes.width);
  const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

  it('desenha com a largura do contêiner', async () => {
    abrir();
    await screen.findByText('Fazer login com o Google');
    expect(largurasDesenhadas()).toEqual([300]);
  });

  it('desenha de novo quando o contêiner muda (o celular girou), trocando o botão em vez de empilhar', async () => {
    abrir();
    await screen.findByText('Fazer login com o Google');

    largura = 224;
    avisarMudanca();
    await waitFor(() => expect(largurasDesenhadas()).toEqual([300, 224]));
    // O botão antigo saiu: um só no contêiner.
    expect(screen.getAllByText('Fazer login com o Google')).toHaveLength(1);
  });

  it('muitas medições seguidas (arrastar a janela) viram um redesenho só, na largura final', async () => {
    abrir();
    await screen.findByText('Fazer login com o Google');

    for (const l of [280, 260, 240, 224]) {
      largura = l;
      avisarMudanca();
    }
    await waitFor(() => expect(largurasDesenhadas()).toEqual([300, 224]));
    await esperar(300);
    expect(largurasDesenhadas()).toEqual([300, 224]);
  });

  it('largura que não mudou não recarrega o iframe do Google', async () => {
    abrir();
    await screen.findByText('Fazer login com o Google');
    avisarMudanca();
    await esperar(300);
    expect(largurasDesenhadas()).toEqual([300]);
  });

  it.each([
    [120, 200],
    [999, 400],
  ])('respeita os limites do Google: contêiner de %i px vira botão de %i px', async (medida, esperada) => {
    largura = medida;
    abrir();
    await screen.findByText('Fazer login com o Google');
    expect(largurasDesenhadas()).toEqual([esperada]);
  });

  it('o contêiner não deixa uma largura fixa esticar a coluna do formulário', async () => {
    abrir();
    const lugar = await screen.findByTestId('botao-google');
    // Item de grade tem largura mínima igual ao conteúdo; o conteúdo é um
    // iframe de largura fixa. Sem min-w-0 nos dois níveis, o botão alargava o
    // formulário inteiro (campos e "Entrar" saíam do cartão). O jsdom não mede
    // isso; o e2e mede.
    expect(lugar).toHaveClass('min-w-0', 'overflow-hidden');
    expect(lugar.parentElement).toHaveClass('min-w-0');
  });

  it('sai da tela sem deixar o observador de largura para trás', async () => {
    const desconectar = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb) {
          avisarMudanca = cb;
        }
        observe() {}
        disconnect() {
          desconectar();
        }
      }
    );
    const { unmount } = abrir();
    await screen.findByText('Fazer login com o Google');
    unmount();
    expect(desconectar).toHaveBeenCalled();
  });
});

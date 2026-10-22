import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../src/api/client', async () => {
  const real = await vi.importActual('../src/api/client');
  return {
    ...real,
    default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

import api from '../src/api/client';
import { AuthProvider } from '../src/context/AuthContext';
import Login from '../src/pages/Login';
import MinhaConta from '../src/pages/MinhaConta';

function abrirLogin() {
  // A tela pergunta se o login com Google está ligado; aqui, não está.
  api.get.mockResolvedValue({ data: { client_id: null } });
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { de: '/chamados/novo?equipamento=AC-1' } }]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/chamados/novo" element={<p>Formulário</p>} />
          <Route path="/" element={<p>Início</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

const USUARIO = { id: 9, nome: 'Ana', email: 'ana@exemplo.com', perfil: 'gestor' };

beforeEach(() => {
  localStorage.clear();
});

describe('Login com verificação em duas etapas', () => {
  it('sem 2FA, entra direto e guarda só o perfil — nunca o token', async () => {
    const usuario = userEvent.setup();
    api.post.mockResolvedValueOnce({ data: { token: 'segredo-que-nao-se-guarda', usuario: USUARIO } });
    abrirLogin();

    await usuario.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await usuario.type(screen.getByLabelText('Senha'), 'senha-teste-123');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('Formulário')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('smp_usuario'))).toEqual(USUARIO);
    expect(JSON.stringify({ ...localStorage })).not.toContain('segredo-que-nao-se-guarda');
  });

  it('o token que versões anteriores guardavam no aparelho é apagado na primeira carga', () => {
    localStorage.setItem('smp_token', 'token-esquecido');
    abrirLogin();
    expect(localStorage.getItem('smp_token')).toBeNull();
  });

  it('com 2FA, pede o código, confirma com o desafio, e só então entra', async () => {
    const usuario = userEvent.setup();
    api.post
      .mockResolvedValueOnce({ data: { requer_2fa: true, desafio: 'desafio-1' } })
      .mockResolvedValueOnce({ data: { token: 't', usuario: USUARIO } });
    abrirLogin();

    await usuario.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await usuario.type(screen.getByLabelText('Senha'), 'senha-teste-123');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

    const campo = await screen.findByLabelText('Código');
    expect(localStorage.getItem('smp_usuario')).toBeNull();
    await usuario.type(campo, '123456');
    await usuario.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('Formulário')).toBeInTheDocument();
    expect(api.post).toHaveBeenLastCalledWith('/auth/login/2fa', { desafio: 'desafio-1', codigo: '123456' });
  });

  it('código errado mostra o erro e deixa tentar de novo', async () => {
    const usuario = userEvent.setup();
    api.post
      .mockResolvedValueOnce({ data: { requer_2fa: true, desafio: 'desafio-1' } })
      .mockRejectedValueOnce({ response: { status: 401, data: { erro: { mensagem: 'Código inválido ou já usado.', codigo: 'CODIGO_INVALIDO' } } } });
    abrirLogin();

    await usuario.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await usuario.type(screen.getByLabelText('Senha'), 'senha-teste-123');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));
    await usuario.type(await screen.findByLabelText('Código'), '000000');
    await usuario.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('Código inválido ou já usado.')).toBeInTheDocument();
    expect(screen.getByLabelText('Código')).toBeInTheDocument();
  });

  it('o passo do código diz de qual conta se trata, pelo e-mail que o servidor confirmou', async () => {
    const usuario = userEvent.setup();
    api.post.mockResolvedValueOnce({ data: { requer_2fa: true, desafio: 'desafio-1', email: 'ana@exemplo.com' } });
    abrirLogin();

    // Digitado com outra caixa: a conta é a que o servidor devolveu.
    await usuario.type(screen.getByLabelText('E-mail'), 'ANA@Exemplo.com');
    await usuario.type(screen.getByLabelText('Senha'), 'senha-teste-123');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByLabelText('Código')).toBeInTheDocument();
    expect(screen.getByText('ana@exemplo.com')).toBeInTheDocument();
    expect(screen.queryByText('ANA@Exemplo.com')).not.toBeInTheDocument();
  });

  it('se o servidor não mandar o e-mail, mostra o que a pessoa digitou', async () => {
    const usuario = userEvent.setup();
    api.post.mockResolvedValueOnce({ data: { requer_2fa: true, desafio: 'desafio-1' } });
    abrirLogin();

    await usuario.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await usuario.type(screen.getByLabelText('Senha'), 'senha-teste-123');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByLabelText('Código')).toBeInTheDocument();
    expect(screen.getByText('ana@exemplo.com')).toBeInTheDocument();
  });

  it('desafio vencido volta para o e-mail e a senha', async () => {
    const usuario = userEvent.setup();
    api.post
      .mockResolvedValueOnce({ data: { requer_2fa: true, desafio: 'desafio-1' } })
      .mockRejectedValueOnce({
        response: { status: 401, data: { erro: { mensagem: 'A verificação expirou.', codigo: 'DESAFIO_INVALIDO' } } },
      });
    abrirLogin();

    await usuario.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await usuario.type(screen.getByLabelText('Senha'), 'senha-teste-123');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));
    await usuario.type(await screen.findByLabelText('Código'), '123456');
    await usuario.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByLabelText('Senha')).toBeInTheDocument();
    expect(screen.getByText('A verificação expirou.')).toBeInTheDocument();
  });
});

function abrirConta(situacao) {
  localStorage.setItem('smp_usuario', JSON.stringify(USUARIO));
  api.get.mockResolvedValue({ data: situacao });
  return render(
    <AuthProvider>
      <MemoryRouter>
        <MinhaConta />
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('Minha conta', () => {
  it('ligar: mostra o QR do aplicativo, confere o código e mostra os códigos de recuperação uma vez', async () => {
    const usuario = userEvent.setup();
    abrirConta({ ativo: false, codigos_restantes: 0 });
    api.post
      .mockResolvedValueOnce({
        data: { segredo: 'JBSWY3DPEHPK3PXP', endereco: 'otpauth://totp/Conserva%20Predial%3Aana?secret=JBSWY3DPEHPK3PXP' },
      })
      .mockResolvedValueOnce({ data: { codigos_recuperacao: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] } });

    expect(await screen.findByText(/Recomendada para o seu perfil/)).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Ligar a verificação em duas etapas' }));

    expect(await screen.findByRole('img', { name: /cadastrar a conta no aplicativo/ })).toBeInTheDocument();
    // A chave aparece em grupos de 4, para ler e digitar sem se perder.
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();

    api.get.mockResolvedValue({ data: { ativo: true, ativado_em: '2026-10-07T12:00:00Z', codigos_restantes: 2 } });
    await usuario.type(screen.getByLabelText('Código do aplicativo'), '123456');
    await usuario.type(screen.getByLabelText('Senha'), 'senha-teste-123');
    await usuario.click(screen.getByRole('button', { name: 'Ligar' }));

    expect(await screen.findByText('AAAAA-BBBBB')).toBeInTheDocument();
    expect(screen.getByText(/não aparecem de novo/)).toBeInTheDocument();
    expect(api.post).toHaveBeenLastCalledWith('/auth/2fa/ativar', { senha: 'senha-teste-123', codigo: '123456' });
  });

  it('desligar pede a senha e um código', async () => {
    const usuario = userEvent.setup();
    abrirConta({ ativo: true, ativado_em: '2026-10-07T12:00:00Z', codigos_restantes: 8 });
    api.post.mockResolvedValueOnce({ data: {} });

    await usuario.click(await screen.findByRole('button', { name: 'Desligar' }));
    await usuario.type(screen.getByLabelText('Senha'), 'senha-teste-123');
    await usuario.type(screen.getByLabelText('Código do aplicativo'), '654321');
    await usuario.click(screen.getByRole('button', { name: 'Confirmar e desligar' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/auth/2fa/desativar', { senha: 'senha-teste-123', codigo: '654321' })
    );
  });

  it('"sair de todos" encerra também esta sessão', async () => {
    const usuario = userEvent.setup();
    abrirConta({ ativo: false, codigos_restantes: 0 });
    api.post.mockResolvedValue({ data: {} });

    await usuario.click(await screen.findByRole('button', { name: 'Sair de todos os aparelhos' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/sair-de-todos'));
    await waitFor(() => expect(localStorage.getItem('smp_usuario')).toBeNull());
    expect(api.post).toHaveBeenCalledWith('/auth/sair');
  });
});

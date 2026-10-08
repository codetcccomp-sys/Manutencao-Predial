import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../src/api/client', async () => {
  const real = await vi.importActual('../src/api/client');
  return { ...real, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

import api, { EVENTO_2FA_OBRIGATORIO } from '../src/api/client';
import { AuthProvider } from '../src/context/AuthContext';
import RotaProtegida from '../src/components/RotaProtegida';
import MinhaConta from '../src/pages/MinhaConta';
import ExigenciaDoisFatores from '../src/components/ExigenciaDoisFatores';

/**
 * A verificação em duas etapas exigida da gestão, vista pela tela: quem ainda
 * não ligou só alcança Minha conta, e a administração liga a exigência na tela
 * de Usuários.
 */

const GESTOR = { id: 7, nome: 'Bia', email: 'bia@exemplo.com', perfil: 'gestor' };

function abrir(caminho) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route path="/conta" element={<RotaProtegida><MinhaConta /></RotaProtegida>} />
          <Route path="/relatorios" element={<RotaProtegida><p>Relatórios</p></RotaProtegida>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: { ativo: false, codigos_restantes: 0 } });
});

describe('Gestão com a verificação exigida e desligada', () => {
  it('qualquer tela leva a Minha conta, que diz o porquê', async () => {
    localStorage.setItem('smp_usuario', JSON.stringify({ ...GESTOR, dois_fatores_pendente: true }));
    abrir('/relatorios');
    expect(await screen.findByText('Falta ligar a verificação em duas etapas')).toBeInTheDocument();
    expect(screen.queryByText('Relatórios')).not.toBeInTheDocument();
  });

  it('quem já estava dentro quando a exigência foi ligada é levado no primeiro 403', async () => {
    localStorage.setItem('smp_usuario', JSON.stringify(GESTOR));
    abrir('/relatorios');
    expect(screen.getByText('Relatórios')).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event(EVENTO_2FA_OBRIGATORIO)));
    expect(await screen.findByText('Falta ligar a verificação em duas etapas')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('smp_usuario')).dois_fatores_pendente).toBe(true);
  });

  it('ligar a verificação tira a restrição', async () => {
    localStorage.setItem('smp_usuario', JSON.stringify({ ...GESTOR, dois_fatores_pendente: true }));
    const u = userEvent.setup();
    api.post.mockImplementation(async (caminho) =>
      caminho === '/auth/2fa/iniciar'
        ? { data: { segredo: 'JBSWY3DPEHPK3PXP', endereco: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' } }
        : { data: { codigos_recuperacao: ['AAAAA-BBBBB'] } }
    );
    abrir('/conta');

    await u.click(await screen.findByRole('button', { name: /Ligar/ }));
    await u.type(screen.getByLabelText('Código do aplicativo'), '123456');
    await u.type(screen.getByLabelText('Senha'), 'senha123');
    await u.click(screen.getByRole('button', { name: 'Ligar' }));

    await waitFor(() =>
      expect(screen.queryByText('Falta ligar a verificação em duas etapas')).not.toBeInTheDocument()
    );
    expect(JSON.parse(localStorage.getItem('smp_usuario')).dois_fatores_pendente).toBe(false);
  });
});

describe('A chave na tela de Usuários', () => {
  const PESSOAS = [
    { id: 1, nome: 'Admin', perfil: 'administrador', ativo: true, dois_fatores: true },
    { id: 2, nome: 'Bia', perfil: 'gestor', ativo: true, dois_fatores: false },
    { id: 3, nome: 'Caio', perfil: 'gestor', ativo: false, dois_fatores: false },
    { id: 4, nome: 'Davi', perfil: 'tecnico', ativo: true, dois_fatores: false },
  ];

  it('mostra quem da gestão ativa ainda não ligou, e liga a exigência', async () => {
    api.get.mockResolvedValue({ data: { configuracoes: { exigir_2fa_gestao: false } } });
    api.patch.mockResolvedValue({ data: { configuracoes: { exigir_2fa_gestao: true } } });
    const u = userEvent.setup();
    render(<ExigenciaDoisFatores usuarios={PESSOAS} />);

    // Só Bia: Caio está desativado e Davi não é da gestão.
    expect(screen.getByText(/Ainda sem a verificação: Bia\./)).toBeInTheDocument();

    const caixa = await screen.findByRole('checkbox', { name: /Exigir a verificação em duas etapas/ });
    expect(caixa).not.toBeChecked();
    await u.click(caixa);
    expect(api.patch).toHaveBeenCalledWith('/configuracoes', { exigir_2fa_gestao: true });
    expect(await screen.findByText(/Exigência ligada/)).toBeInTheDocument();
    expect(caixa).toBeChecked();
  });

  it('a recusa do servidor aparece e a caixa não muda', async () => {
    api.get.mockResolvedValue({ data: { configuracoes: { exigir_2fa_gestao: false } } });
    api.patch.mockRejectedValue({
      response: { data: { erro: { mensagem: 'Ligue a sua verificação em duas etapas em Minha conta antes de exigir da gestão.' } } },
    });
    const u = userEvent.setup();
    render(<ExigenciaDoisFatores usuarios={PESSOAS} />);

    const caixa = await screen.findByRole('checkbox', { name: /Exigir a verificação/ });
    await u.click(caixa);
    expect(await screen.findByText(/antes de exigir da gestão/)).toBeInTheDocument();
    expect(caixa).not.toBeChecked();
  });
});

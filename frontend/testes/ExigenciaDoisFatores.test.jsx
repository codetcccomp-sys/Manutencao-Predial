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
import Layout from '../src/components/Layout';
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
    await u.type(screen.getByLabelText('Senha'), 'senha-teste-123');
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
    { id: 2, nome: 'Bia', email: 'bia@exemplo.com', perfil: 'gestor', ativo: true, dois_fatores: false },
    { id: 3, nome: 'Caio', perfil: 'gestor', ativo: false, dois_fatores: false },
    { id: 4, nome: 'Davi', perfil: 'tecnico', ativo: true, dois_fatores: false },
  ];

  // O cartão tem um link para Minha conta, então precisa de um roteador.
  const abrirCartao = (usuarios) =>
    render(
      <MemoryRouter>
        <ExigenciaDoisFatores usuarios={usuarios} />
      </MemoryRouter>
    );

  // Gestores ativos sem verificação, com e-mail próprio.
  const gestores = (quantidade) =>
    Array.from({ length: quantidade }, (_, i) => ({
      id: 100 + i,
      nome: `Gestor ${i + 1}`,
      email: `gestor${i + 1}@exemplo.com`,
      perfil: 'gestor',
      ativo: true,
      dois_fatores: false,
    }));

  it('mostra quem da gestão ativa ainda não ligou, e liga a exigência', async () => {
    api.get.mockResolvedValue({ data: { configuracoes: { exigir_2fa_gestao: false } } });
    api.patch.mockResolvedValue({ data: { configuracoes: { exigir_2fa_gestao: true } } });
    const u = userEvent.setup();
    abrirCartao(PESSOAS);

    // Só Bia: Caio está desativado e Davi não é da gestão.
    expect(screen.getByText('Ainda sem a verificação:')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('listitem')).toHaveTextContent('Bia (bia@exemplo.com)');

    const caixa = await screen.findByRole('checkbox', { name: /Exigir a verificação em duas etapas/ });
    expect(caixa).not.toBeChecked();
    await u.click(caixa);
    expect(api.patch).toHaveBeenCalledWith('/configuracoes', { exigir_2fa_gestao: true });
    expect(await screen.findByText(/Exigência ligada/)).toBeInTheDocument();
    expect(caixa).toBeChecked();
  });

  it('o rótulo da caixa diz quantas contas ela restringe, antes de alguém apertar', async () => {
    api.get.mockResolvedValue({ data: { configuracoes: { exigir_2fa_gestao: false } } });
    abrirCartao(gestores(2));

    const caixa = await screen.findByRole('checkbox', { name: /Exigir a verificação em duas etapas/ });
    expect(caixa).toHaveAccessibleName(/Ao ligar, 2 contas ficam restritas a Minha conta até elas ligarem a verificação/);
  });

  it('no singular, a frase concorda', async () => {
    api.get.mockResolvedValue({ data: { configuracoes: { exigir_2fa_gestao: false } } });
    abrirCartao(gestores(1));

    const caixa = await screen.findByRole('checkbox', { name: /Exigir a verificação em duas etapas/ });
    expect(caixa).toHaveAccessibleName(/Ao ligar, 1 conta fica restrita a Minha conta até ela ligar a verificação\. Ela continua entrando\./);
  });

  it('com a exigência ligada, diz quantas contas estão restritas agora', async () => {
    api.get.mockResolvedValue({ data: { configuracoes: { exigir_2fa_gestao: true } } });
    abrirCartao(gestores(3));

    const caixa = await screen.findByRole('checkbox', { name: /Exigir a verificação em duas etapas/ });
    expect(caixa).toHaveAccessibleName(/3 contas estão restritas a Minha conta/);
  });

  it('sem ninguém faltando, não promete restrição nenhuma', async () => {
    api.get.mockResolvedValue({ data: { configuracoes: { exigir_2fa_gestao: false } } });
    abrirCartao([PESSOAS[0]]);

    const caixa = await screen.findByRole('checkbox', { name: /Exigir a verificação em duas etapas/ });
    expect(caixa).not.toHaveAccessibleName(/Ao ligar/);
    expect(screen.getByText('Toda a gestão ativa já tem a verificação ligada.')).toBeInTheDocument();
  });

  it('a lista para em cinco e diz quantas faltam ver', async () => {
    api.get.mockResolvedValue({ data: { configuracoes: { exigir_2fa_gestao: false } } });
    abrirCartao(gestores(8));
    await screen.findByRole('checkbox', { name: /Exigir a verificação/ });

    expect(screen.getByText('8 contas ainda sem a verificação:')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('e mais 3.')).toBeInTheDocument();
    expect(screen.queryByText(/Gestor 6/)).not.toBeInTheDocument();
  });

  it('homônimos se distinguem pelo e-mail', async () => {
    api.get.mockResolvedValue({ data: { configuracoes: { exigir_2fa_gestao: false } } });
    abrirCartao([
      { id: 10, nome: 'Ana', email: 'ana.a@exemplo.com', perfil: 'gestor', ativo: true, dois_fatores: false },
      { id: 11, nome: 'Ana', email: 'ana.b@exemplo.com', perfil: 'gestor', ativo: true, dois_fatores: false },
    ]);
    await screen.findByRole('checkbox', { name: /Exigir a verificação/ });

    expect(screen.getByText(/ana\.a@exemplo\.com/)).toBeInTheDocument();
    expect(screen.getByText(/ana\.b@exemplo\.com/)).toBeInTheDocument();
  });

  it('a recusa do servidor aparece, a caixa não muda e há caminho para Minha conta', async () => {
    api.get.mockResolvedValue({ data: { configuracoes: { exigir_2fa_gestao: false } } });
    api.patch.mockRejectedValue({
      response: {
        data: {
          erro: {
            mensagem: 'Ligue a sua verificação em duas etapas em Minha conta antes de exigir da gestão.',
            codigo: 'SEM_2FA_PROPRIO',
          },
        },
      },
    });
    const u = userEvent.setup();
    abrirCartao(PESSOAS);

    const caixa = await screen.findByRole('checkbox', { name: /Exigir a verificação/ });
    await u.click(caixa);
    expect(await screen.findByText(/antes de exigir da gestão/)).toBeInTheDocument();
    expect(caixa).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'Abrir Minha conta' })).toHaveAttribute('href', '/conta');
  });

  it('outra recusa não manda para Minha conta', async () => {
    api.get.mockResolvedValue({ data: { configuracoes: { exigir_2fa_gestao: false } } });
    api.patch.mockRejectedValue({
      response: { data: { erro: { mensagem: 'Não foi possível salvar agora.', codigo: 'ERRO_INTERNO' } } },
    });
    const u = userEvent.setup();
    abrirCartao(PESSOAS);

    await u.click(await screen.findByRole('checkbox', { name: /Exigir a verificação/ }));
    expect(await screen.findByText('Não foi possível salvar agora.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Abrir Minha conta' })).not.toBeInTheDocument();
  });
});

describe('Texto da conta quando a verificação é exigida', () => {
  const cenarios = [
    ['exigida da gestão: diz "Obrigatória", não "Recomendada"', { ...GESTOR, dois_fatores_pendente: true }, /Obrigatória para o seu perfil/, /Recomendada/],
    ['gestão sem exigência: segue "Recomendada"', GESTOR, /Recomendada para o seu perfil/, /Obrigatória/],
    ['quem não é da gestão: "Opcional"', { ...GESTOR, perfil: 'solicitante' }, /Opcional para o seu perfil/, /Obrigatória|Recomendada/],
  ];
  it.each(cenarios)('%s', async (_, usuario, deve, nao) => {
    localStorage.setItem('smp_usuario', JSON.stringify(usuario));
    abrir('/conta');
    expect(await screen.findByText(deve)).toBeInTheDocument();
    expect(screen.queryByText(nao)).not.toBeInTheDocument();
  });
});

describe('Foco acompanha a ativação da verificação', () => {
  const SEGREDO = 'JBSWY3DPEHPK3PXP';

  async function aberta() {
    localStorage.setItem('smp_usuario', JSON.stringify({ ...GESTOR, dois_fatores_pendente: true }));
    api.post.mockImplementation(async (caminho) =>
      caminho === '/auth/2fa/iniciar'
        ? { data: { segredo: SEGREDO, endereco: `otpauth://totp/Conserva%20Predial:bia?secret=${SEGREDO}` } }
        : { data: { codigos_recuperacao: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] } }
    );
    const u = userEvent.setup();
    abrir('/conta');
    await u.click(await screen.findByRole('button', { name: 'Ligar a verificação em duas etapas' }));
    return u;
  }

  it('ao abrir os passos, o foco vai para o começo deles — não para o campo, que subiria o teclado do celular', async () => {
    await aberta();
    const passos = await screen.findByRole('form', { name: /Passos para ligar a verificação/ });
    expect(passos).toHaveFocus();
    expect(screen.getByLabelText('Código do aplicativo')).not.toHaveFocus();
  });

  it('ao cancelar, o foco volta para o botão que abriu os passos', async () => {
    const u = await aberta();
    await u.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('button', { name: 'Ligar a verificação em duas etapas' })).toHaveFocus();
  });

  it('ao ligar, o foco vai para os códigos de recuperação, que aparecem uma vez só', async () => {
    const u = await aberta();
    await u.type(screen.getByLabelText('Código do aplicativo'), '123456');
    await u.type(screen.getByLabelText('Senha'), 'senha-teste-123');
    await u.click(screen.getByRole('button', { name: 'Ligar' }));
    expect(await screen.findByRole('region', { name: 'Códigos de recuperação' })).toHaveFocus();
  });
});

describe('Ajuda de quem entrou só pelo Google e não tem senha', () => {
  async function aberta() {
    localStorage.setItem('smp_usuario', JSON.stringify({ ...GESTOR, dois_fatores_pendente: true }));
    api.post.mockResolvedValue({ data: { segredo: 'JBSWY3DPEHPK3PXP', endereco: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' } });
    const u = userEvent.setup();
    abrir('/conta');
    await u.click(await screen.findByRole('button', { name: 'Ligar a verificação em duas etapas' }));
    await screen.findByRole('form', { name: /Passos para ligar/ });
    return u;
  }

  it('fica recolhida: quem tem senha não lê um aviso que não é para si', async () => {
    await aberta();

    expect(screen.getByLabelText('Senha')).not.toHaveAccessibleDescription(/Google/);
    expect(screen.getByText('Não tenho senha').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText(/Saia da conta e crie uma/)).not.toBeVisible();
  });

  it('aberta, diz o caminho inteiro, inclusive que é preciso sair da conta', async () => {
    const u = await aberta();
    await u.click(screen.getByText('Não tenho senha'));

    const texto = screen.getByText(/Saia da conta e crie uma/);
    expect(texto).toBeVisible();
    expect(texto).toHaveTextContent('"Esqueci minha senha"');
    expect(texto).toHaveTextContent('depois volte para ligar a verificação');
  });
});

describe('Ativação num celular, onde o QR Code da própria tela não se lê', () => {
  const SEGREDO = 'JBSWY3DPEHPK3PXP';
  const ENDERECO = `otpauth://totp/Conserva%20Predial:bia?secret=${SEGREDO}`;

  async function aberta() {
    localStorage.setItem('smp_usuario', JSON.stringify(GESTOR));
    api.post.mockResolvedValue({ data: { segredo: SEGREDO, endereco: ENDERECO } });
    const u = userEvent.setup();
    abrir('/conta');
    await u.click(await screen.findByRole('button', { name: 'Ligar a verificação em duas etapas' }));
    await screen.findByRole('form', { name: /Passos para ligar/ });
    return u;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('oferece abrir direto no aplicativo autenticador, com o endereço da conta', async () => {
    await aberta();
    expect(screen.getByRole('link', { name: 'Abrir no aplicativo autenticador' })).toHaveAttribute('href', ENDERECO);
  });

  it('mostra a chave em grupos de 4 e copia a chave inteira, sem os espaços', async () => {
    const u = await aberta();
    const escrever = vi.fn().mockResolvedValue();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: escrever } });

    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Copiar chave' }));

    expect(escrever).toHaveBeenCalledWith(SEGREDO);
    expect(await screen.findByText('Chave copiada.')).toBeInTheDocument();
  });

  it('se a cópia for recusada, diz o que fazer em vez de fingir que copiou', async () => {
    const u = await aberta();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('negado')) } });

    await u.click(screen.getByRole('button', { name: 'Copiar chave' }));

    expect(await screen.findByText(/Não foi possível copiar/)).toBeInTheDocument();
    expect(screen.queryByText('Chave copiada.')).not.toBeInTheDocument();
  });

  it('sem a API de área de transferência (conexão sem HTTPS), também cai no aviso', async () => {
    const u = await aberta();
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });

    await u.click(screen.getByRole('button', { name: 'Copiar chave' }));

    expect(await screen.findByText(/Não foi possível copiar/)).toBeInTheDocument();
  });
});

describe('O sino de avisos no estado restrito', () => {
  function abrirLayout() {
    api.get.mockResolvedValue({ data: { notificacoes: [] } });
    return render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/conta']}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/conta" element={<p>conteúdo</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
  }

  it('some enquanto a conta está restrita: a API recusa a rota, e o painel ficaria vazio', async () => {
    localStorage.setItem('smp_usuario', JSON.stringify({ ...GESTOR, dois_fatores_pendente: true }));
    abrirLayout();
    expect(await screen.findByText('conteúdo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Avisos/ })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/notificacoes');
  });

  it('com a conta livre, o sino continua lá (o teste acima não passa por não haver sino nenhum)', async () => {
    localStorage.setItem('smp_usuario', JSON.stringify(GESTOR));
    abrirLayout();
    expect(await screen.findByRole('button', { name: /Avisos/ })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/notificacoes');
  });
});

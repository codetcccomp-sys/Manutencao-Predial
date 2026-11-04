import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../src/pwa', () => ({ limparDadosOffline: vi.fn(), registrarServiceWorker: vi.fn() }));

const sessaoAtual = { usuario: null };
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ usuario: sessaoAtual.usuario }),
  useUsuarioSeHouver: () => sessaoAtual.usuario,
}));

import { limparDadosOffline } from '../src/pwa';
import Cookies from '../src/pages/Cookies';
import NaoEncontrada from '../src/pages/NaoEncontrada';
import Suporte from '../src/pages/Suporte';
import TermosDeUso from '../src/pages/TermosDeUso';
import { CONTATO, linkDeSuporte } from '../src/dominio/contato';
import { conferirCabecalhos } from './apoio/cabecalhos';

/**
 * As páginas de informação (termos, cookies, suporte) e a de endereço inexistente.
 *
 * Como o aviso de privacidade, elas descrevem o sistema como ele é. Aqui se
 * confere o que mais importa que elas digam, e o que elas NÃO podem dizer: um
 * aviso que promete o que o sistema não faz é pior que aviso nenhum.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (relativo) => fs.readFileSync(path.join(raiz, relativo), 'utf8');

const abrir = (Pagina, rota = '/') =>
  render(
    <MemoryRouter initialEntries={[rota]}>
      <Pagina />
    </MemoryRouter>
  );

beforeEach(() => {
  sessaoAtual.usuario = null;
  vi.clearAllMocks();
});

describe('Termos de uso', () => {
  it('é uma página com um título e seções em ordem, dentro de <main>', () => {
    const { container } = abrir(TermosDeUso);

    expect(screen.getByRole('main')).toBeInTheDocument();
    const niveis = conferirCabecalhos(container);
    expect(niveis[0]).toEqual({ nivel: 1, texto: 'Termos de uso' });
    expect(niveis.slice(1).map((h) => h.texto)).toEqual([
      'Para que serve',
      'Quem pode usar',
      'O que esperamos de você',
      'O que o sistema registra',
      'Emergências',
      'Disponibilidade e prazos',
      'Contas e suspensão',
      'Instalações de demonstração',
      'Mudanças e contato',
    ]);
  });

  it('diz que não é canal de emergência e manda para os serviços públicos', () => {
    abrir(TermosDeUso);
    const emergencias = screen.getByRole('heading', { name: 'Emergências' }).closest('section');

    expect(within(emergencias).getByText(/não é um canal de emergência/)).toBeInTheDocument();
    expect(emergencias).toHaveTextContent(/192, 193 e 190/);
    expect(emergencias).toHaveTextContent(/15 minutos/);
  });

  it('não promete o que o sistema não faz: nada de foro, multa, garantia de prazo ou escrita sem conexão', () => {
    abrir(TermosDeUso);
    const texto = document.body.textContent.replace(/\s+/g, ' ');

    expect(texto).not.toMatch(/foro|multa|indeniza|garantimos|24 horas por dia/i);
    expect(texto).toMatch(/metas de acompanhamento/);
    expect(texto).toMatch(/não é salvo: a tela avisa/);
    // Sem instituição formalizada, ela não é nomeada (docs/lgpd.md, seção 4).
    expect(texto).toMatch(/instituição.*ainda|formalizada/);
  });
});

describe('Cookies e armazenamento', () => {
  it('lista o que o código de fato guarda no aparelho', () => {
    abrir(Cookies);
    const lista = screen.getByRole('heading', { name: 'O que fica no seu aparelho' }).closest('section');

    for (const nome of ['conserva_sessao', 'smp_usuario', 'smp_recarga_de_tela']) {
      expect(within(lista).getByText(new RegExp(nome))).toBeInTheDocument();
    }
    // Os nomes que a página afirma existem mesmo no código: a lista não envelhece sozinha.
    expect(ler('backend/src/services/sessao.service.js')).toContain("NOME_COOKIE = 'conserva_sessao'");
    expect(ler('frontend/src/api/client.js')).toContain("CHAVE_USUARIO = 'smp_usuario'");
    expect(ler('frontend/src/dominio/telaSobDemanda.js')).toContain("MARCA = 'smp_recarga_de_tela'");
  });

  it('diz que não há análise de audiência nem publicidade, e por isso não há faixa de consentimento', () => {
    abrir(Cookies);
    const texto = document.body.textContent.replace(/\s+/g, ' ');

    expect(texto).toMatch(/Não há cookie de publicidade, de análise de audiência nem de rastreamento/);
    expect(texto).toMatch(/não usamos o Google Analytics/);
    expect(texto).toMatch(/Por isso não há faixa de consentimento/);
  });

  it('e a promessa é verdadeira: nenhum código de análise nem de publicidade na página nem nas dependências', () => {
    const pagina = ler('frontend/index.html');
    const pacote = JSON.parse(ler('frontend/package.json'));
    const dependencias = Object.keys({ ...pacote.dependencies, ...pacote.devDependencies }).join(' ');

    expect(pagina).not.toMatch(/googletagmanager|google-analytics|gtag\(|analytics\.js|fbevents|hotjar|clarity\.ms/i);
    expect(dependencias).not.toMatch(/analytics|gtag|mixpanel|amplitude|hotjar|segment|sentry|datadog/i);
  });

  it('o controle apaga as consultas guardadas no aparelho e confirma', async () => {
    const usuario = userEvent.setup();
    abrir(Cookies);
    expect(screen.queryByText(/foram apagadas/)).toBeNull();

    await usuario.click(screen.getByRole('button', { name: 'Apagar as consultas guardadas neste aparelho' }));

    expect(limparDadosOffline).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/foram apagadas/)).toBeInTheDocument();
    expect(screen.getByText(/foram apagadas/).closest('[role="status"]')).not.toBeNull();
  });

  it('avisa que o componente do Google é de terceiro e só aparece na entrada', () => {
    abrir(Cookies);
    const google = screen.getByRole('heading', { name: 'Entrar com o Google' }).closest('section');

    expect(google).toHaveTextContent(/pertence ao Google/);
    expect(google).toHaveTextContent(/Só a tela de entrada o carrega/);
  });
});

describe('Ajuda e suporte', () => {
  it('oferece o e-mail do projeto com um roteiro do que contar', () => {
    abrir(Suporte);
    const link = screen.getByRole('link', { name: CONTATO });
    const url = new URL(link.getAttribute('href'));

    expect(url.protocol).toBe('mailto:');
    expect(decodeURIComponent(url.pathname)).toBe(CONTATO);
    expect(url.searchParams.get('subject')).toMatch(/Conserva Predial/);
    expect(url.searchParams.get('body')).toMatch(/O que você estava tentando fazer/);
  });

  it('o rascunho nunca leva a senha, e o texto manda não enviá-la', () => {
    const corpo = new URL(linkDeSuporte()).searchParams.get('body');

    expect(corpo).toMatch(/Não escreva sua senha/);
    expect(corpo).not.toMatch(/senha:\s*\S/i);
    abrir(Suporte);
    expect(screen.getByText(/Nunca envie a sua senha/)).toBeInTheDocument();
  });

  it('é honesta sobre o prazo e sobre emergência', () => {
    abrir(Suporte);
    const texto = document.body.textContent.replace(/\s+/g, ' ');

    expect(texto).toMatch(/não há prazo garantido de resposta/);
    expect(texto).toMatch(/Isto não é um canal de emergência/);
  });

  it('não adiciona canal comercial nem de terceiros', () => {
    abrir(Suporte);

    expect(document.body.innerHTML).not.toMatch(/wa\.me|whatsapp|api\.whatsapp|t\.me|messenger/i);
    // O único link para fora das páginas do sistema é o do e-mail.
    const externos = screen.getAllByRole('link').filter((l) => /^https?:/.test(l.getAttribute('href') ?? ''));
    expect(externos).toHaveLength(0);
  });
});

describe('Caminho de volta das páginas de informação', () => {
  it('quem não está logado vê Entrar e Criar conta', () => {
    abrir(Suporte);
    const volta = screen.getByRole('navigation', { name: 'Voltar ao sistema' });

    expect(within(volta).getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login');
    expect(within(volta).getByRole('link', { name: 'Criar conta' })).toHaveAttribute('href', '/cadastro');
    // As outras páginas de informação, e não a própria.
    expect(within(volta).getByRole('link', { name: 'Termos de uso' })).toHaveAttribute('href', '/termos');
    expect(within(volta).getByRole('link', { name: 'Cookies e armazenamento' })).toHaveAttribute('href', '/cookies');
    expect(within(volta).queryByRole('link', { name: 'Ajuda e suporte' })).toBeNull();
  });

  it('quem já está logado volta para o início, e não para a tela de entrada', () => {
    sessaoAtual.usuario = { id: 1, nome: 'Ana', perfil: 'gestor' };
    abrir(Suporte);
    const volta = screen.getByRole('navigation', { name: 'Voltar ao sistema' });

    expect(within(volta).getByRole('link', { name: 'Ir para o início' })).toHaveAttribute('href', '/');
    expect(within(volta).queryByRole('link', { name: 'Entrar' })).toBeNull();
  });
});

describe('Página não encontrada', () => {
  it('diz o que houve e oferece o caminho de volta à tela de entrada, sem sessão', () => {
    abrir(NaoEncontrada, '/isto-nao-existe');

    expect(screen.getByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para a tela de entrada' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Ajuda e suporte' })).toHaveAttribute('href', '/suporte');
  });

  it('com sessão, o caminho de volta é o início do sistema', () => {
    sessaoAtual.usuario = { id: 1, nome: 'Ana', perfil: 'gestor' };
    abrir(NaoEncontrada, '/isto-nao-existe');

    expect(screen.getByRole('link', { name: 'Ir para o início' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: 'Ir para a tela de entrada' })).toBeNull();
  });

  it('não repete na tela o endereço digitado', () => {
    abrir(NaoEncontrada, '/ola-<script>alert(1)</script>');

    expect(document.body.textContent).not.toMatch(/ola-|script/);
  });
});

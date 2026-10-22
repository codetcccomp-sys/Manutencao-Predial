import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import Privacidade from '../src/pages/Privacidade';
import configuracaoDoBackend from '../../backend/vercel.json';
import { conferirCabecalhos } from './apoio/cabecalhos';

/**
 * O aviso de privacidade diz o que o sistema FAZ (docs/lgpd.md), e este teste
 * existe menos para provar que o texto está lá do que para impedir que ele seja
 * "melhorado" para além da realidade: um aviso que promete o que o sistema não
 * faz é pior que aviso nenhum.
 */

function abrir() {
  return render(
    <MemoryRouter initialEntries={['/privacidade']}>
      <Privacidade />
    </MemoryRouter>
  );
}

const texto = () => document.body.textContent.replace(/\s+/g, ' ');

describe('Aviso de privacidade', () => {
  it('é uma página com um título e seções em ordem, dentro de <main>', () => {
    const { container } = abrir();

    expect(screen.getByRole('main')).toBeInTheDocument();
    const niveis = conferirCabecalhos(container);

    expect(niveis[0]).toEqual({ nivel: 1, texto: 'Aviso de privacidade' });
    expect(niveis.slice(1).map((h) => h.texto)).toEqual([
      'Que dados guardamos',
      'Para que usamos',
      'Quem pode ver',
      'Onde os dados ficam',
      'Por quanto tempo',
      'Seus direitos',
      'Segurança',
    ]);
  });

  it('diz o que é guardado, inclusive o que passa despercebido', () => {
    abrir();
    const dados = screen.getByRole('heading', { name: 'Que dados guardamos' }).closest('section');

    // A foto que pega gente no enquadramento, o IP de quem errou a senha, a chave do 2FA
    // e o que vem do Google: os quatro pontos que o docs/lgpd.md destaca ou que nasceram depois dele.
    expect(within(dados).getByText(/pessoas que estavam por perto/)).toBeInTheDocument();
    expect(within(dados).getByText(/inclusive de quem errou a senha/)).toBeInTheDocument();
    expect(within(dados).getByText(/chave do aplicativo/)).toBeInTheDocument();
    expect(within(dados).getByText(/só o nome e o e-mail que o Google informa/)).toBeInTheDocument();
    expect(within(dados).getByText(/não coletamos dado sensível/)).toBeInTheDocument();
    // O registro de erros (migração 028) guarda rota, código e mensagem, e nenhuma pessoa.
    expect(within(dados).getByText(/sem nome, e-mail nem IP/)).toBeInTheDocument();
  });

  it('diz onde os dados ficam, inclusive o e-mail, que sai por um serviço de fora', () => {
    abrir();
    const onde = screen.getByRole('heading', { name: 'Onde os dados ficam' }).closest('section');

    expect(within(onde).getByText(/banco de dados fica em São Paulo/)).toBeInTheDocument();
    expect(within(onde).getByText(/servidores que executam o sistema também ficam em São Paulo/)).toBeInTheDocument();
    expect(within(onde).getByText(/Gmail/)).toBeInTheDocument();
  });

  // O aviso afirma "São Paulo" para os servidores. A afirmação é verdadeira
  // porque o backend/vercel.json fixa a região das funções em gru1; sem isso a
  // Vercel usa iad1 (Estados Unidos), e o aviso passaria a mentir em silêncio
  // no dia em que alguém mexesse na configuração sem lembrar dele.
  it('só afirma que os servidores ficam em São Paulo enquanto o backend está fixado em gru1', () => {
    expect(configuracaoDoBackend.regions).toEqual(['gru1']);
  });

  it('dá os prazos que o sistema cumpre, e diz que os outros ainda não são automáticos', () => {
    abrir();
    const prazos = screen.getByRole('heading', { name: 'Por quanto tempo' }).closest('section');

    expect(within(prazos).getByText(/apagadas em 24 horas/)).toBeInTheDocument();
    expect(within(prazos).getByText(/em 7 dias/)).toBeInTheDocument();
    expect(within(prazos).getByText(/apagado na hora da recusa/)).toBeInTheDocument();
    expect(within(prazos).getByText(/Erros técnicos do sistema: apagados em 30 dias/)).toBeInTheDocument();
    // Os 5 e os 2 anos são políticas previstas: a rotina que as cumpre não existe.
    expect(within(prazos).getByText(/prevê guardar os chamados por 5 anos/)).toBeInTheDocument();
    expect(within(prazos).getByText(/ainda não faz isso sozinho/)).toBeInTheDocument();
  });

  it('não nomeia controlador, nem cita base legal, nem se apresenta como política adotada', () => {
    abrir();

    expect(screen.getByText(/ainda não foi formalizada/)).toBeInTheDocument();
    // Base legal depende de a instituição ser pública ou privada, e isso ainda não foi decidido.
    expect(texto()).not.toMatch(/legítimo interesse|consentimento|art\.\s*7|execução de política pública/i);
    expect(texto()).not.toMatch(/política institucional/i);
  });

  it('atende o pedido de remoção como o sistema atende: anonimizando', () => {
    abrir();
    const direitos = screen.getByRole('heading', { name: 'Seus direitos' }).closest('section');

    expect(within(direitos).getByText(/Usuário removido/)).toBeInTheDocument();
    expect(within(direitos).getByText(/sem o seu nome, porque são o registro da manutenção/)).toBeInTheDocument();
    // O limite que o próprio procedimento declara: nome citado no texto de outra pessoa.
    expect(within(direitos).getByText(/revisado à mão/)).toBeInTheDocument();
    expect(within(direitos).getByRole('link', { name: 'code.tcc.comp@gmail.com' })).toHaveAttribute(
      'href',
      'mailto:code.tcc.comp@gmail.com'
    );
  });

  it('leva de volta ao sistema', () => {
    abrir();
    const volta = screen.getByRole('navigation', { name: 'Voltar ao sistema' });

    expect(within(volta).getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login');
    expect(within(volta).getByRole('link', { name: 'Criar conta' })).toHaveAttribute('href', '/cadastro');
  });
});

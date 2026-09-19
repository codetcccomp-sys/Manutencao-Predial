import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AreaDeTexto, Campo, Selecao } from '../src/components/ui/Campo';
import Botao from '../src/components/ui/Botao';
import Aviso from '../src/components/ui/Aviso';

describe('Campo', () => {
  it('o rótulo encontra o controle', async () => {
    const usuario = userEvent.setup();
    render(<Campo rotulo="Título" />);

    // Sem o par htmlFor/id o rótulo fica só desenhado ao lado, e quem usa
    // leitor de tela ouve "caixa de edição" sem saber do quê.
    const campo = screen.getByLabelText('Título');
    await usuario.type(campo, 'Porta emperrada');
    expect(campo).toHaveValue('Porta emperrada');
  });

  it('dois campos na mesma tela não colidem de id', () => {
    render(
      <>
        <Campo rotulo="Nova senha" type="password" />
        <Campo rotulo="Repita a nova senha" type="password" />
      </>
    );

    // Ids gerados por useId: id fixo no componente faria o segundo rótulo
    // apontar para o primeiro campo, e digitar num focaria o outro.
    const primeiro = screen.getByLabelText('Nova senha');
    const segundo = screen.getByLabelText('Repita a nova senha');
    expect(primeiro.id).not.toBe(segundo.id);
  });

  /**
   * Este é o ponto da marcação de obrigatoriedade.
   *
   * O texto do rótulo é o nome acessível do campo. Pendurar "(opcional)" ou um
   * asterisco dentro do <label> renomeia o campo — "Bloco" viraria "Bloco
   * (opcional)" — e quebra tanto o leitor de tela quanto a busca por rótulo.
   */
  it('a marca de opcional não entra no nome do campo', () => {
    render(<Campo rotulo="Bloco" opcional />);

    expect(screen.getByLabelText('Bloco')).toBeInTheDocument();
    expect(screen.getByText('(opcional)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Bloco (opcional)')).toBeNull();
  });

  it('campo sem marca de opcional é exigido', () => {
    render(<Campo rotulo="Título" />);
    expect(screen.getByLabelText('Título')).toBeRequired();
  });

  it('campo marcado como opcional não é exigido', () => {
    render(<Campo rotulo="Bloco" opcional />);
    expect(screen.getByLabelText('Bloco')).not.toBeRequired();
  });

  it('o erro fica ligado ao campo e é anunciado', () => {
    render(<Campo rotulo="Repita a nova senha" type="password" erro="As senhas não conferem." />);

    const campo = screen.getByLabelText('Repita a nova senha');
    const erro = screen.getByRole('alert');

    expect(campo).toHaveAttribute('aria-invalid', 'true');
    // aria-describedby é o que faz o leitor de tela ler a mensagem junto do
    // campo. Sem ele, o texto vermelho existe só para quem enxerga.
    expect(campo.getAttribute('aria-describedby')).toContain(erro.id);
    expect(erro).toHaveTextContent('As senhas não conferem.');
  });

  it('a ajuda também é lida junto do campo', () => {
    render(<Campo rotulo="Senha" ajuda="Ao menos 6 caracteres." />);
    const campo = screen.getByLabelText('Senha');
    expect(campo.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Ao menos 6 caracteres.')).toBeInTheDocument();
  });

  it('área de texto e seleção seguem as mesmas regras', () => {
    render(
      <>
        <AreaDeTexto rotulo="Descrição" />
        <Selecao rotulo="Categoria">
          <option value="1">Elétrica</option>
        </Selecao>
      </>
    );

    expect(screen.getByLabelText('Descrição')).toBeRequired();
    expect(screen.getByLabelText('Categoria')).toBeRequired();
  });
});

describe('Botão', () => {
  it('não envia formulário sem pedirem', async () => {
    const enviar = vi.fn((e) => e.preventDefault());
    const usuario = userEvent.setup();

    render(
      <form onSubmit={enviar}>
        <Botao>Cancelar</Botao>
      </form>
    );

    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));

    // Sem `type="button"` explícito, um botão dentro de formulário envia o
    // formulário — foi assim que muito "Cancelar" já salvou dados por aí.
    expect(enviar).not.toHaveBeenCalled();
  });

  it('envia quando é de envio', async () => {
    const enviar = vi.fn((e) => e.preventDefault());
    const usuario = userEvent.setup();

    render(
      <form onSubmit={enviar}>
        <Botao type="submit">Entrar</Botao>
      </form>
    );

    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('carregando desabilita e se anuncia como ocupado', () => {
    render(<Botao carregando>Entrando...</Botao>);
    const botao = screen.getByRole('button', { name: 'Entrando...' });

    // Desabilitar impede o duplo envio; aria-busy é o que comunica o motivo a
    // quem não vê o rótulo mudar.
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Aviso', () => {
  /**
   * A garantia que faltava no sistema inteiro.
   *
   * Eram dezessete faixas de erro escritas à mão, nenhuma com `role`. Na
   * prática: a pessoa apertava "Entrar", errava a senha, e o leitor de tela
   * não dizia nada — a mensagem ficava desenhada para quem pudesse vê-la.
   */
  it('erro interrompe para ser anunciado na hora', () => {
    render(<Aviso tipo="erro">E-mail ou senha inválidos.</Aviso>);
    expect(screen.getByRole('alert')).toHaveTextContent('E-mail ou senha inválidos.');
  });

  it('sucesso espera a leitura em curso terminar', () => {
    render(<Aviso tipo="sucesso">Local cadastrado.</Aviso>);

    // `status` é educado de propósito: confirmar o que já deu certo não
    // justifica atropelar o que a pessoa está ouvindo.
    expect(screen.getByRole('status')).toHaveTextContent('Local cadastrado.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('o tipo tem ícone além da cor', () => {
    const { container } = render(<Aviso tipo="erro">Falhou.</Aviso>);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

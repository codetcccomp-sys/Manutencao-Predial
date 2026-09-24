import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import Confirmacao from '../src/components/ui/Confirmacao';

/**
 * O diálogo substitui um clique único em ações que não têm volta. Se ele
 * vazar foco, não fechar no Esc ou executar sem que a pessoa tenha confirmado,
 * é pior do que não existir: acrescenta um passo sem acrescentar segurança.
 */

/** Uma tela mínima com um botão fora do diálogo, para testar o cerco do foco. */
function Palco({ onConfirmar = () => {}, carregando = false }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button onClick={() => setAberto(true)}>Cancelar chamado</button>
      <button>Outro botão da página</button>
      <Confirmacao
        aberto={aberto}
        titulo="Cancelar este chamado?"
        rotuloConfirmar="Cancelar o chamado"
        carregando={carregando}
        onConfirmar={() => {
          onConfirmar();
          setAberto(false);
        }}
        onCancelar={() => setAberto(false)}
      >
        O chamado sai do fluxo e não pode ser reaberto.
      </Confirmacao>
    </>
  );
}

const abrir = () => screen.getByRole('button', { name: 'Cancelar chamado' });
const dialogo = () => screen.queryByRole('dialog');

describe('Confirmação de ação sem volta', () => {
  it('não existe na página enquanto ninguém pede', () => {
    render(<Palco />);

    expect(dialogo()).toBeNull();
  });

  it('o diálogo se apresenta pelo título e pela consequência', async () => {
    const usuario = userEvent.setup();
    render(<Palco />);
    await usuario.click(abrir());

    // aria-modal diz ao leitor de tela que o resto da página está suspenso; o
    // título e a descrição são o que ele anuncia ao entrar.
    expect(dialogo()).toHaveAttribute('aria-modal', 'true');
    expect(dialogo()).toHaveAccessibleName('Cancelar este chamado?');
    expect(dialogo()).toHaveAccessibleDescription(
      'O chamado sai do fluxo e não pode ser reaberto.'
    );
  });

  it('o foco entra no diálogo, e começa pela recusa', async () => {
    const usuario = userEvent.setup();
    render(<Palco />);
    await usuario.click(abrir());

    // Um Enter repetido por engano não pode executar o que não tem volta.
    expect(document.activeElement).toHaveTextContent('Voltar');
  });

  it('o Tab não escapa do diálogo enquanto ele está aberto', async () => {
    const usuario = userEvent.setup();
    render(<Palco />);
    await usuario.click(abrir());

    // Sem o cerco, o Tab andaria pela página atrás do diálogo e a pessoa
    // acabaria confirmando algo que não consegue mais ler.
    for (let i = 0; i < 6; i += 1) {
      await usuario.tab();
      expect(dialogo()).toContainElement(document.activeElement);
    }

    for (let i = 0; i < 6; i += 1) {
      await usuario.tab({ shift: true });
      expect(dialogo()).toContainElement(document.activeElement);
    }
  });

  it('Esc fecha sem executar: a saída mais fácil é a segura', async () => {
    const usuario = userEvent.setup();
    const onConfirmar = vi.fn();
    render(<Palco onConfirmar={onConfirmar} />);
    await usuario.click(abrir());

    await usuario.keyboard('{Escape}');

    expect(dialogo()).toBeNull();
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  it('clicar fora também é "não"', async () => {
    const usuario = userEvent.setup();
    const onConfirmar = vi.fn();
    const { container } = render(<Palco onConfirmar={onConfirmar} />);
    await usuario.click(abrir());

    await usuario.click(container.querySelector('.fixed.inset-0'));

    expect(dialogo()).toBeNull();
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  it('o foco volta para o botão que abriu o diálogo', async () => {
    const usuario = userEvent.setup();
    render(<Palco />);
    await usuario.click(abrir());
    await usuario.keyboard('{Escape}');

    // Quem usa teclado não pode recomeçar do topo da página a cada resposta.
    expect(document.activeElement).toBe(abrir());
  });

  it('só executa depois da confirmação explícita', async () => {
    const usuario = userEvent.setup();
    const onConfirmar = vi.fn();
    render(<Palco onConfirmar={onConfirmar} />);

    await usuario.click(abrir());
    expect(onConfirmar).not.toHaveBeenCalled();

    await usuario.click(screen.getByRole('button', { name: 'Cancelar o chamado' }));
    expect(onConfirmar).toHaveBeenCalledOnce();
  });

  it('durante a execução nenhum dos dois botões aceita um segundo clique', async () => {
    const usuario = userEvent.setup();
    render(<Palco carregando />);
    await usuario.click(abrir());

    // Dois cliques no botão de confirmar mandariam a mesma exclusão duas
    // vezes; o segundo volta como erro e assusta quem já tinha acertado.
    expect(screen.getByRole('button', { name: 'Cancelar o chamado' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeDisabled();
  });

  it('durante a execução, nem Esc nem clique fora fecham o diálogo', async () => {
    // O "Voltar" já ficava desabilitado aqui, de propósito — mas o Esc e o
    // clique no fundo passavam por cima dele. O diálogo fechava, a pessoa
    // entendia que tinha desistido, e o cancelamento que ela acabara de
    // confirmar terminava de ser gravado mesmo assim.
    const usuario = userEvent.setup();
    render(<Palco carregando />);
    await usuario.click(abrir());

    await usuario.keyboard('{Escape}');
    expect(dialogo()).not.toBeNull();

    // O fundo escuro é o pai do diálogo; o clique nele, e não no diálogo, é
    // o que conta como "clicar fora".
    await usuario.click(dialogo().parentElement);
    expect(dialogo()).not.toBeNull();
  });

  it('fora da execução, Esc e clique fora continuam fechando', async () => {
    // A trava vale só enquanto a ação corre; fechar pelo Esc é o caminho
    // mais curto para "não", e não pode ser tirado de quem ainda não decidiu.
    const usuario = userEvent.setup();
    render(<Palco />);
    await usuario.click(abrir());
    await usuario.keyboard('{Escape}');
    expect(dialogo()).toBeNull();

    await usuario.click(abrir());
    await usuario.click(dialogo().parentElement);
    expect(dialogo()).toBeNull();
  });
});

describe('O foco não escapa ao confirmar', () => {
  it('ao confirmar, o foco não volta para o botão atrás do diálogo', async () => {
    const usuario = userEvent.setup();

    // O caminho exato: a pessoa clica em "Confirmar", o componente entra em
    // `carregando` e redesenha. Se `onCancelar` — uma seta nova a cada render
    // — estiver nas dependências do efeito, a limpeza roda e devolve o foco ao
    // gatilho. O efeito reentra em seguida e tentaria recolocar o foco na
    // recusa, mas durante `carregando` ela está desabilitada e `.focus()` num
    // elemento desabilitado não faz nada. Resultado: o foco fica no botão
    // ATRÁS de um `aria-modal`, enquanto a ação irreversível corre.
    function Tela() {
      const [aberto, setAberto] = useState(false);
      const [carregando, setCarregando] = useState(false);
      return (
        <>
          <button onClick={() => setAberto(true)}>Cancelar chamado</button>
          <Confirmacao
            aberto={aberto}
            carregando={carregando}
            titulo="Tem certeza?"
            rotuloConfirmar="Fazer"
            onConfirmar={() => setCarregando(true)}
            onCancelar={() => setAberto(false)}
          >
            Isto não tem volta.
          </Confirmacao>
        </>
      );
    }

    render(<Tela />);
    const gatilho = screen.getByRole('button', { name: 'Cancelar chamado' });
    await usuario.click(gatilho);
    await usuario.click(screen.getByRole('button', { name: 'Fazer' }));

    expect(screen.getByRole('button', { name: 'Fazer' })).toBeDisabled();
    expect(document.activeElement, 'o foco voltou para trás do diálogo').not.toBe(gatilho);
  });

  it('o Esc continua chamando o onCancelar atual depois de redesenhar', async () => {
    const usuario = userEvent.setup();
    const primeiro = vi.fn();
    const segundo = vi.fn();

    // A ref precisa acompanhar a prop. Guardá-la só no primeiro render faria o
    // Esc chamar uma função velha — que, num componente de verdade, fecharia
    // um estado que já não existe.
    const tela = (aoCancelar) => (
      <Confirmacao aberto titulo="Tem certeza?" onConfirmar={() => {}} onCancelar={aoCancelar}>
        Isto não tem volta.
      </Confirmacao>
    );

    const { rerender } = render(tela(primeiro));
    rerender(tela(segundo));
    await usuario.keyboard('{Escape}');

    expect(segundo).toHaveBeenCalledOnce();
    expect(primeiro).not.toHaveBeenCalled();
  });
});

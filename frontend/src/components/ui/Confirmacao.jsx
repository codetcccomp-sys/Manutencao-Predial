import { useEffect, useId, useRef } from 'react';
import Botao from './Botao';

/**
 * Pergunta antes de fazer o que não tem volta.
 *
 * Hoje nada no sistema pergunta. Cancelar um chamado é um clique, e o §2.4 não
 * prevê saída do estado "cancelado": o chamado acaba ali. Remover um anexo
 * apaga o arquivo. Os dois botões ficam a um toque de distância de botões
 * inofensivos, numa tela de celular, em cima de uma lista que rola.
 *
 * O diálogo NÃO é um freio para toda ação. Desativar um local tem o botão
 * "Reativar" ao lado; interromper alguém para confirmar o que se desfaz em um
 * clique treina a pessoa a responder "sim" sem ler — e aí a pergunta que
 * importa também passa batida. Só o irreversível pergunta.
 *
 * Sobre acessibilidade, três coisas que o `window.confirm` dá de graça e um
 * diálogo escrito à mão precisa reproduzir:
 *
 * 1. O foco entra no diálogo e não sai dele enquanto está aberto. Sem isso, o
 *    Tab continua andando pela página atrás do diálogo e a pessoa confirma
 *    algo que não consegue mais ler.
 * 2. Esc fecha, e fechar é sempre "não". A saída mais fácil é a segura.
 * 3. O foco volta para o botão que abriu o diálogo. Quem usa teclado não
 *    recomeça do topo da página a cada resposta.
 */
function Confirmacao({
  aberto,
  titulo,
  children,
  rotuloConfirmar = 'Confirmar',
  rotuloCancelar = 'Voltar',
  onConfirmar,
  onCancelar,
  carregando = false,
}) {
  const idTitulo = useId();
  const idDescricao = useId();
  const caixa = useRef(null);
  const origemDoFoco = useRef(null);

  // `onCancelar` numa ref, e não na lista de dependências.
  //
  // Quem chama passa uma seta criada na hora — `onCancelar={() => setX(null)}`
  // —, então a função é outra a cada render. Com ela nas dependências, o efeito
  // se refazia a cada render enquanto o diálogo estava aberto, e a limpeza
  // rodava junto: o foco voltava para o botão ATRÁS do diálogo, fora de um
  // `aria-modal`, sem ninguém ter fechado nada. Durante `carregando` o efeito
  // nem reconquistava o foco, porque o botão de recusa está desabilitado e
  // `.focus()` num elemento desabilitado não faz nada.
  const cancelar = useRef(onCancelar);
  cancelar.current = onCancelar;

  useEffect(() => {
    if (!aberto) return undefined;

    origemDoFoco.current = document.activeElement;
    // O foco começa em "Voltar", não em "Confirmar": um Enter repetido por
    // engano não deve executar o que não tem volta.
    caixa.current?.querySelector('[data-recusa]')?.focus();

    function aoTeclar(evento) {
      if (evento.key === 'Escape') {
        evento.preventDefault();
        cancelar.current();
        return;
      }
      if (evento.key !== 'Tab') return;

      const focaveis = caixa.current?.querySelectorAll('button:not([disabled])');
      if (!focaveis?.length) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];

      // A armadilha de foco é só o ciclo entre o primeiro e o último: no meio
      // da lista o Tab do navegador já faz a coisa certa.
      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      // Devolve o foco a quem abriu. O `focus` é condicional porque o botão de
      // origem pode ter sumido junto com o item removido.
      if (origemDoFoco.current?.isConnected) origemDoFoco.current.focus();
    };
  }, [aberto]);

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-4 sm:items-center"
      // Clicar fora fecha, e fechar é "não" — mesma regra do Esc.
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancelar();
      }}
    >
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={idDescricao}
        className="w-full max-w-md rounded-lg border border-borda bg-superficie p-6 shadow-md"
      >
        <h2 id={idTitulo} className="font-bold text-navy">
          {titulo}
        </h2>
        <div id={idDescricao} className="mt-2 text-sm text-tinta">
          {children}
        </div>

        {/* `flex-col-reverse` inverte só o desenho, não a ordem do DOM e do
            teclado: no celular a recusa fica embaixo, ao alcance do polegar,
            e a ação destrutiva em cima, onde é preciso mirar. A leitura e o
            Tab continuam entrando pela recusa. */}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Botao variante="secundaria" data-recusa onClick={onCancelar} disabled={carregando}>
            {rotuloCancelar}
          </Botao>
          <Botao variante="perigo" onClick={onConfirmar} carregando={carregando}>
            {rotuloConfirmar}
          </Botao>
        </div>
      </div>
    </div>
  );
}

export default Confirmacao;

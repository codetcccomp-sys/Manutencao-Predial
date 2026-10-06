import { useId, useRef } from 'react';
import Botao from './Botao';
import { useJanelaModal } from './useJanelaModal';

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

  // Foco, Esc e devolução do foco vivem em useJanelaModal, que o painel lateral
  // também usa. O foco começa em "Voltar", não em "Confirmar": um Enter repetido
  // por engano não deve executar o que não tem volta. Enquanto `carregando`, Esc
  // e clique fora não fecham: a ação já corre, e o diálogo fechado diria à pessoa
  // que ela desistiu de algo que terminará de ser gravado mesmo assim.
  useJanelaModal({
    aberto,
    aoFechar: onCancelar,
    bloqueado: carregando,
    caixa,
    focoInicial: '[data-recusa]',
    focaveis: 'button:not([disabled])',
  });

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fundo-in items-end justify-center bg-navy/40 p-4 backdrop-blur-[2px] sm:items-center"
      // Clicar fora fecha, e fechar é "não" — mesma regra do Esc.
      onClick={(e) => {
        if (e.target === e.currentTarget && !carregando) onCancelar();
      }}
    >
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={idDescricao}
        className="w-full max-w-md animate-modal-in rounded-lg border border-borda bg-superficie p-6 shadow-md"
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

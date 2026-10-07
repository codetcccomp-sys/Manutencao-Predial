import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import api from '../../api/client';
import Aviso from '../ui/Aviso';
import { BadgeAtraso, BadgeEstado, BadgePrioridade } from '../ui/Badge';
import { Esqueleto } from '../ui/Estados';
import Icone from '../ui/Icone';
import { useJanelaModal } from '../ui/useJanelaModal';
import { prazoEmPalavras } from '../../dominio/prazo';

/**
 * Resumo de um chamado num painel que desliza da direita.
 *
 * Quem olha uma lista de vinte chamados quer espiar um deles sem perder o lugar:
 * abrir a tela cheia joga a pessoa para outra página, e voltar recarrega a lista
 * e zera a rolagem. O painel responde "o que é este, em que pé está" e deixa a
 * tela cheia, com histórico e ações, a um clique ("Abrir chamado completo").
 *
 * Os dados vêm de `GET /chamados/:id`, o mesmo da tela de detalhe: a lista traz
 * só as colunas do chamado, sem o rótulo do local nem o nome da categoria, e a
 * permissão é a mesma — quem não pode ver o chamado leva o mesmo 403/404 aqui.
 *
 * Três decisões:
 *
 * - **Portal para o `body`.** O painel é `position: fixed`, e o cartão que o abre
 *   leva `transform` enquanto a lista se reorganiza (FLIP). Um `transform` no
 *   ancestral prende o `fixed` a ele, e o painel apareceria do tamanho do cartão.
 *
 * - **Foco, Esc e Tab** vêm de `useJanelaModal`, o mesmo do diálogo de confirmação:
 *   o foco entra no botão de fechar, não sai enquanto o painel está aberto e volta
 *   ao botão que o abriu.
 *
 * - **A página atrás não rola** enquanto o painel está aberto. Sem isso a roda do
 *   mouse rola a lista por baixo do fundo escurecido, e ao fechar a pessoa está
 *   em outro ponto da lista.
 */
function PainelDeResumo({ chamadoId, aberto, aoFechar }) {
  const idTitulo = useId();
  const caixa = useRef(null);
  const [chamado, setChamado] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useJanelaModal({ aberto, aoFechar, caixa, focoInicial: '[data-foco-inicial]' });

  useEffect(() => {
    if (!aberto) return undefined;
    let cancelado = false;
    setCarregando(true);
    setErro('');
    setChamado(null);

    api
      .get(`/chamados/${chamadoId}`)
      .then(({ data }) => {
        if (!cancelado) setChamado(data.chamado);
      })
      .catch(() => {
        if (!cancelado) setErro('Não foi possível carregar o resumo deste chamado.');
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [aberto, chamadoId]);

  useEffect(() => {
    if (!aberto) return undefined;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [aberto]);

  if (!aberto) return null;

  const prazo = chamado ? prazoEmPalavras(chamado.prazo_estimado) : null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex animate-fundo-in justify-end bg-navy/40 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <aside
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className="flex h-full w-full max-w-md animate-painel-in flex-col overflow-y-auto border-l border-borda bg-superficie shadow-md"
      >
        <div className="flex items-center justify-between gap-3 border-b border-borda px-6 py-4">
          <h2 id={idTitulo} className="font-bold text-navy">
            Resumo do chamado
          </h2>
          <button
            type="button"
            data-foco-inicial
            onClick={aoFechar}
            aria-label="Fechar resumo"
            className="alvo-toque rounded p-1 text-tinta-2 transition-colors hover:bg-fundo hover:text-navy"
          >
            <Icone nome="x" classe="h-5 w-5" />
          </button>
        </div>

        <div className="grid flex-1 content-start gap-5 px-6 py-5">
          {carregando && <Esqueleto linhas={4} altura="h-10" />}

          {erro && <Aviso tipo="erro">{erro}</Aviso>}

          {chamado && (
            <>
              <div className="min-w-0">
                <p className="break-words text-lg font-medium text-navy">{chamado.titulo}</p>
                <p className="mt-0.5 text-xs text-tinta-2">{chamado.protocolo}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <BadgeEstado estado={chamado.estado} />
                <BadgePrioridade prioridade={chamado.prioridade} />
                {chamado.em_atraso && <BadgeAtraso />}
              </div>

              <dl className="grid gap-3 text-sm">
                {chamado.local_rotulo && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-tinta-2">Local</dt>
                    <dd className="text-tinta">{chamado.local_rotulo}</dd>
                  </div>
                )}
                {chamado.categoria_nome && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-tinta-2">Categoria</dt>
                    <dd className="text-tinta">{chamado.categoria_nome}</dd>
                  </div>
                )}
                {prazo && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-tinta-2">Prazo</dt>
                    <dd className={prazo.vencido ? 'font-medium text-erro' : 'text-tinta'}>
                      {prazo.texto}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs uppercase tracking-wide text-tinta-2">Descrição</dt>
                  <dd className="whitespace-pre-wrap break-words text-tinta">{chamado.descricao}</dd>
                </div>
              </dl>
            </>
          )}
        </div>

        <div className="border-t border-borda px-6 py-4">
          <Link
            to={`/chamados/${chamadoId}`}
            className="alvo-toque inline-flex w-full items-center justify-center rounded bg-navy px-4 py-2.5 text-sm font-medium text-white transition hover:bg-navy-2 active:scale-[0.98]"
          >
            Abrir chamado completo
          </Link>
        </div>
      </aside>
    </div>,
    document.body
  );
}

export default PainelDeResumo;

import { Link } from 'react-router-dom';
import { BadgeAtraso, BadgeEstado, BadgePrioridade } from '../ui/Badge';
import { prazoEmPalavras } from '../../dominio/prazo';

/**
 * Um chamado numa lista.
 *
 * Estava embutido no painel, que era a única tela a listar chamados. Com três
 * telas listando — os pedidos de quem abriu, a fila de quem executa e a visão
 * de quem distribui — o cartão passou a ser desenho partilhado, e desenho
 * partilhado que vive copiado diverge: a primeira correção entra numa cópia e
 * as outras duas ficam para trás sem ninguém notar.
 *
 * `linhaExtra` é o que cada tela acrescenta por conta própria. É deliberado
 * que seja texto pronto vindo de fora, e não um `tipo="solicitante"` aqui
 * dentro: assim o cartão não precisa saber quem está olhando, e acrescentar
 * uma quarta tela não significa abrir este arquivo.
 */
function CartaoDeChamado({ chamado, linhaExtra, mostrarPrazo = false }) {
  const prazo = mostrarPrazo ? prazoEmPalavras(chamado.prazo_estimado) : null;

  return (
    <li className="min-w-0">
      <Link
        to={`/chamados/${chamado.id}`}
        className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-borda bg-superficie p-4 shadow-sm transition hover:border-borda-forte"
      >
        <div className="min-w-0">
          <p className="truncate font-medium text-navy">{chamado.titulo}</p>

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-xs text-tinta-2">{chamado.protocolo}</span>
            <BadgePrioridade prioridade={chamado.prioridade} />
            {prazo && (
              // O prazo entra como texto e não como mais um badge colorido:
              // com prioridade, estado e atraso já marcados, um quarto bloco
              // de cor faria os quatro pararem de se destacar.
              <span className={`text-xs ${prazo.vencido ? 'font-medium text-erro' : 'text-tinta-2'}`}>
                {prazo.texto}
              </span>
            )}
          </div>

          {linhaExtra && <p className="mt-1 truncate text-xs text-tinta-2">{linhaExtra}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {chamado.em_atraso && <BadgeAtraso />}
          <BadgeEstado estado={chamado.estado} />
        </div>
      </Link>
    </li>
  );
}

export default CartaoDeChamado;

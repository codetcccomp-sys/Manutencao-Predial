import Icone, { BarrasDePrioridade } from './Icone';
import { ESTADOS, PRIORIDADES } from '../../dominio/rotulos';

/**
 * Etiquetas de estado e de prioridade.
 *
 * Três canais em cada uma — ícone, texto e cor — porque o Termo pede que
 * estado e prioridade sejam reconhecíveis, e cor sozinha não reconhece nada
 * para quem não a distingue, nem num relatório impresso em preto e branco.
 *
 * O padrão de variantes semânticas e o dimensionamento do ícone pelo próprio
 * badge vieram do componente de badge do 21st.dev (coss.com); a implementação
 * é local, sem as cinco dependências que o original traz.
 */

const BASE =
  'inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap';

export function BadgeEstado({ estado, className = '' }) {
  const definicao = ESTADOS[estado];

  // Estado desconhecido ainda aparece, em neutro e com a chave crua: some da
  // tela seria pior que feio na tela.
  if (!definicao) {
    return <span className={`${BASE} bg-neutro-tenue text-neutro ${className}`}>{estado}</span>;
  }

  return (
    <span className={`${BASE} ${definicao.cor} ${className}`}>
      <Icone nome={definicao.icone} classe="h-3.5 w-3.5" />
      {definicao.rotulo}
    </span>
  );
}

export function BadgePrioridade({ prioridade, className = '' }) {
  const definicao = PRIORIDADES[prioridade];

  if (!definicao) {
    return (
      <span className={`${BASE} bg-neutro-tenue text-neutro ${className}`}>{prioridade}</span>
    );
  }

  return (
    <span className={`${BASE} ${definicao.cor} ${className}`}>
      <BarrasDePrioridade nivel={definicao.nivel} classe="h-3.5 w-3.5" />
      {definicao.rotulo}
    </span>
  );
}

/**
 * Etiqueta de atraso.
 *
 * Separada do estado de propósito: atraso não é um estado do fluxo, é uma
 * condição que se soma a ele. Um chamado atrasado continua "em andamento" —
 * juntar as duas coisas num badge só esconderia uma das duas.
 */
export function BadgeAtraso({ className = '' }) {
  return (
    <span className={`${BASE} bg-erro-tenue text-erro ${className}`}>
      <Icone nome="alerta" classe="h-3.5 w-3.5" />
      Em atraso
    </span>
  );
}

/**
 * Chamado crítico que passou do tempo de primeiro atendimento sem sair de
 * "aberto". É outra coisa que "Em atraso": o atraso é do prazo de resolução, e
 * este é de um chamado que ninguém pegou ainda. Os dois podem aparecer juntos.
 */
export function BadgeSemAtendimento({ tempo, className = '' }) {
  return (
    <span className={`${BASE} bg-erro-tenue text-erro ${className}`}>
      <Icone nome="alerta" classe="h-3.5 w-3.5" />
      {tempo ? `Sem atendimento há ${tempo}` : 'Sem atendimento'}
    </span>
  );
}

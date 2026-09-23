/**
 * O prazo em palavras, para quem precisa decidir o que fazer agora.
 *
 * Um carimbo de data e hora responde "quando", e a pergunta de quem está com
 * a lista aberta é outra: "quanto tempo eu tenho". Converter "20/09/2026,
 * 14:00" em "vence em 3 horas" é trabalho que o leitor fazia de cabeça, item
 * por item, com o relógio da parede — e fazia errado quando a data virava o
 * dia, que é justamente quando importa acertar.
 *
 * As faixas são grossas de propósito. "vence em 2 dias" e "vence em 2 dias e
 * 4 horas" levam à mesma decisão, e a segunda pede mais atenção para entregar
 * a mesma informação.
 */

const HORA = 3_600_000;
const DIA = 24 * HORA;

function plural(n, singular, plural_) {
  return `${n} ${n === 1 ? singular : plural_}`;
}

/**
 * Devolve `{ texto, vencido }`, ou `null` quando não há prazo.
 *
 * `null` é resposta legítima e não um caso de erro: chamado sem prazo existe
 * (o SLA pode não cobrir a prioridade), e a tela mostra um traço em vez de
 * inventar urgência.
 */
export function prazoEmPalavras(prazoIso, agora = Date.now()) {
  if (!prazoIso) return null;

  const prazo = new Date(prazoIso).getTime();
  if (Number.isNaN(prazo)) return null;

  const restante = prazo - agora;
  const vencido = restante < 0;
  const distancia = Math.abs(restante);

  let quanto;
  if (distancia < HORA) {
    // Abaixo de uma hora o minuto é a unidade que muda a decisão.
    const minutos = Math.max(1, Math.round(distancia / 60_000));
    quanto = plural(minutos, 'minuto', 'minutos');
  } else if (distancia < DIA) {
    quanto = plural(Math.round(distancia / HORA), 'hora', 'horas');
  } else {
    quanto = plural(Math.round(distancia / DIA), 'dia', 'dias');
  }

  return {
    vencido,
    texto: vencido ? `venceu há ${quanto}` : `vence em ${quanto}`,
  };
}

/**
 * O estado do chamado dito para quem o abriu.
 *
 * `em_triagem` e `aguardando_material` são vocabulário de dentro: descrevem
 * onde o chamado está no fluxo do §2.4, não o que aconteceu com o pedido de
 * quem o fez. Para o solicitante a pergunta é "e aí?", e a resposta tem de
 * caber numa linha lida de passagem.
 *
 * O badge de estado continua ao lado: esta frase não substitui o vocabulário
 * do sistema, traduz. Quem conversar com a equipe da manutenção vai ouvir
 * "está em triagem", e precisa reconhecer o termo quando ouvir.
 */
const EM_PALAVRAS = {
  aberto: 'Recebido. Ainda não foi analisado.',
  em_triagem: 'Em análise para definir a prioridade e quem vai atender.',
  atribuido: 'Um técnico já foi designado e vai iniciar o atendimento.',
  em_andamento: 'O técnico está trabalhando neste chamado agora.',
  aguardando_material: 'Parado à espera de material. O prazo fica suspenso.',
  concluido: 'Atendido e encerrado.',
  cancelado: 'Cancelado. Este chamado não será atendido.',
};

export function estadoEmPalavras(estado) {
  return EM_PALAVRAS[estado] || null;
}

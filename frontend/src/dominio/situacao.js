/**
 * As três perguntas que substituem o seletor de prioridade na abertura (RF04).
 *
 * O seletor deixava o solicitante escolher a prioridade, e "baixa" já vinha marcada:
 * quem abria às pressas um chamado de elevador parado esperava 168 horas sem disparar
 * o alerta de 15 minutos. Agora a pessoa descreve a situação, em palavras que ela sabe
 * responder, e o servidor calcula a prioridade com a regra vigente (urgência, impacto e
 * risco, de 1 a 4), a mesma que a gestão usa na triagem.
 *
 * Nenhuma opção vem marcada: um padrão aqui seria a "baixa" de novo, só que escondida.
 * O valor de cada opção é o fator da regra; a ordem na tela vai do mais leve ao mais grave.
 */
export const PERGUNTAS_DE_SITUACAO = [
  {
    campo: 'risco',
    pergunta: 'Alguém pode se machucar, ou algo pode ser danificado?',
    opcoes: [
      { valor: 1, texto: 'Não' },
      { valor: 2, texto: 'Pode virar risco se demorar' },
      { valor: 3, texto: 'Risco para equipamentos ou para o prédio' },
      { valor: 4, texto: 'Risco para pessoas agora' },
    ],
  },
  {
    campo: 'impacto',
    pergunta: 'O quanto isso atrapalha o uso do espaço?',
    opcoes: [
      { valor: 1, texto: 'Só incomoda; tudo funciona' },
      { valor: 2, texto: 'Atrapalha, mas dá para trabalhar' },
      { valor: 3, texto: 'Uma sala ou um serviço não pode ser usado' },
      { valor: 4, texto: 'Vários ambientes ou um serviço essencial parados' },
    ],
  },
  {
    campo: 'urgencia',
    pergunta: 'Até quando precisa ser resolvido?',
    opcoes: [
      { valor: 1, texto: 'Pode esperar alguns dias' },
      { valor: 2, texto: 'Nesta semana' },
      { valor: 3, texto: 'Hoje' },
      { valor: 4, texto: 'Agora, não pode esperar' },
    ],
  },
];

/** O que a API recebe: só os três fatores, como números. */
export function fatoresDaSituacao(situacao) {
  return {
    urgencia: Number(situacao.urgencia),
    impacto: Number(situacao.impacto),
    risco: Number(situacao.risco),
  };
}

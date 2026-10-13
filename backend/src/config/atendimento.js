/**
 * Relógio de primeiro atendimento da ordem de serviço crítica.
 *
 * É um relógio à parte do prazo de resolução (tabela `sla`): o prazo responde
 * "até quando o serviço precisa estar pronto", e este responde "quanto tempo
 * um chamado crítico pode ficar parado sem que ninguém o tenha pegado". Uma
 * parada elétrica ou um vazamento grave com a fila esquecida por uma hora não
 * estoura o prazo de resolução, mas já é a falha que importa.
 *
 * "Atendido" é o chamado sair de `aberto`: a gestão fez a triagem ou o
 * chamado já nasceu atribuído pela distribuição automática. Definição escolhida
 * por ser objetiva e já estar registrada no histórico, sem depender de
 * comentário nem de uma ação a mais.
 *
 * Diretriz recebida com o valor de 15 minutos. Mora aqui, e não na tabela
 * `sla`, porque ainda não há tela para a instituição ajustá-lo; se a folha de
 * validação pedir outro valor por prioridade, o caminho é uma coluna nova em
 * `sla` (migração aditiva) e esta constante some.
 */
const MINUTOS_ATE_ATENDER_CRITICO = 15;

module.exports = { MINUTOS_ATE_ATENDER_CRITICO };

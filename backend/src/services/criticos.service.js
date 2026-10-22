const { transacao } = require('../config/transacao');
const { MINUTOS_ATE_ATENDER_CRITICO } = require('../config/atendimento');
const notificacoesService = require('./notificacoes.service');

// Mesmos tetos do aviso de atraso (atrasos.service.js), pelo mesmo motivo: a varredura roda
// dentro de uma requisição de função serverless, e o que sobrar fica para a passagem seguinte
// (a reivindicação é persistente). Um crítico parado é raro; o teto só protege do dia em que
// não for.
const MAXIMO_CHAMADOS = 50;
const ORCAMENTO_AVISOS = 500;

/**
 * Reivindica os críticos que passaram do primeiro atendimento sem aviso.
 *
 * A condição é a mesma da faixa do aplicativo (`SEM_ATENDIMENTO_CRITICO`, em
 * chamados.service.js): crítico, corretivo, ainda em `aberto` depois de
 * MINUTOS_ATE_ATENDER_CRITICO. É o relógio corrido, sem horário de expediente: uma parada
 * elétrica no sábado à noite não espera a segunda-feira.
 *
 * A reivindicação é o próprio UPDATE ... RETURNING, e não um SELECT seguido de UPDATE: o banco
 * decide quem pegou cada linha, e duas passagens sobrepostas não avisam o mesmo chamado duas
 * vezes. Como o chamado que sai de `aberto` deixa de casar com a condição, quem foi atendido
 * antes da varredura não gera aviso.
 */
async function reivindicar(client, limite) {
  const { rows } = await client.query(
    `UPDATE chamado c
        SET critico_notificado_em = now()
      WHERE c.id IN (
        SELECT id FROM chamado
         WHERE prioridade = 'critica'
           AND origem = 'corretiva'
           AND estado = 'aberto'
           AND critico_notificado_em IS NULL
           AND now() > data_abertura + interval '${MINUTOS_ATE_ATENDER_CRITICO} minutes'
         ORDER BY data_abertura
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING c.id, c.protocolo, c.titulo, c.data_abertura`,
    [limite]
  );
  return rows;
}

function minutosParado(abertura) {
  return Math.max(MINUTOS_ATE_ATENDER_CRITICO, Math.round((Date.now() - new Date(abertura).getTime()) / 60_000));
}

function mensagemDe(chamado) {
  const minutos = minutosParado(chamado.data_abertura);
  const tempo = minutos < 120 ? `${minutos} minutos` : `${Math.round(minutos / 60)} horas`;
  return (
    `Chamado CRÍTICO sem atendimento: ${chamado.protocolo} ("${chamado.titulo}") está aberto há ` +
    `${tempo} e ninguém o pegou. Abra o chamado e faça a triagem.`
  );
}

/**
 * Avisa a gestão dos críticos que ninguém atendeu.
 *
 * Quem recebe é a gestão ativa (administrador e gestor), no sino e por e-mail. O chamado ainda
 * está em `aberto`, então não há técnico nem equipe a avisar: se houvesse regra de distribuição
 * para ele, já teria nascido atribuído. Quem avisa a gestão é quem ainda pode agir.
 *
 * Devolve o que fez, para o agendador e para o painel de saúde das tarefas.
 */
async function notificarCriticosSemAtendimento() {
  const { chamados, notificacaoIds, limiteUsado } = await transacao(async (client) => {
    const { rows: gestao } = await client.query(
      "SELECT id FROM usuario WHERE perfil IN ('administrador', 'gestor') AND ativo ORDER BY id"
    );
    const limite = Math.min(MAXIMO_CHAMADOS, Math.max(1, Math.floor(ORCAMENTO_AVISOS / Math.max(1, gestao.length))));

    const parados = await reivindicar(client, limite);
    const ids = [];
    for (const chamado of parados) {
      const mensagem = mensagemDe(chamado);
      for (const { id: usuarioId } of gestao) {
        const { rows } = await client.query(
          `INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem)
           VALUES ($1, $2, 'critico_sem_atendimento', $3) RETURNING id`,
          [usuarioId, chamado.id, mensagem]
        );
        ids.push(rows[0].id);
      }
    }
    return { chamados: parados, notificacaoIds: ids, limiteUsado: limite };
  });

  // Fora da transação, como no atraso: avisar de algo que um rollback desfez é pior que não avisar.
  await notificacoesService.despacharVarios(notificacaoIds);

  return {
    criticos_avisados: chamados.length,
    avisos_criticos: notificacaoIds.length,
    protocolos_criticos: chamados.map((c) => c.protocolo),
    havia_mais_criticos: chamados.length === limiteUsado,
  };
}

module.exports = { notificarCriticosSemAtendimento, MAXIMO_CHAMADOS, ORCAMENTO_AVISOS };

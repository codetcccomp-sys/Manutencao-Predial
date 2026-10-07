const pool = require('../config/db');

/**
 * Registro e saúde das tarefas agendadas.
 *
 * Cada tarefa tem a frequência com que o agendador deve chamá-la e a
 * tolerância a partir da qual o silêncio vira problema. A tolerância é folgada
 * de propósito (quatro passagens perdidas no atraso, um dia e pouco na
 * preventiva): um alarme que dispara por um atraso de minutos do serviço de
 * cron gratuito é um alarme que se aprende a ignorar.
 */
const TAREFAS = {
  'notificar-atrasos': {
    rotulo: 'Aviso de atraso',
    frequencia: 'a cada 15 minutos',
    toleranciaMinutos: 60,
  },
  'gerar-preventivas': {
    rotulo: 'Manutenção preventiva',
    frequencia: 'uma vez por dia',
    toleranciaMinutos: 26 * 60,
  },
};

// Um mês de histórico basta para ver o padrão; mais que isso é tabela
// crescendo sem ninguém ler.
const RETENCAO_DIAS = 30;

/**
 * Roda a tarefa registrando início, fim e desfecho.
 *
 * O registro de início vem antes do trabalho: se a função serverless for
 * morta no meio (estouro de tempo), fica uma linha sem `terminada_em`, e isso
 * também é informação — diferente de não ter havido chamada nenhuma.
 */
async function registrar(tarefa, executar) {
  const { rows } = await pool.query(
    'INSERT INTO execucao_tarefa (tarefa) VALUES ($1) RETURNING id',
    [tarefa]
  );
  const id = rows[0].id;

  try {
    const resultado = await executar();
    await pool.query(
      `UPDATE execucao_tarefa SET terminada_em = now(), sucesso = TRUE, resumo = $2 WHERE id = $1`,
      [id, JSON.stringify(resultado)]
    );
    return resultado;
  } catch (err) {
    await pool
      .query(
        'UPDATE execucao_tarefa SET terminada_em = now(), sucesso = FALSE, erro = $2 WHERE id = $1',
        [id, String(err.message).slice(0, 1000)]
      )
      .catch(() => {});
    throw err;
  } finally {
    pool
      .query(
        `DELETE FROM execucao_tarefa WHERE tarefa = $1 AND iniciada_em < now() - interval '${RETENCAO_DIAS} days'`,
        [tarefa]
      )
      .catch(() => {});
  }
}

/**
 * Como está cada tarefa agora.
 *
 * - `ok`: o último sucesso está dentro da tolerância.
 * - `parada`: houve sucesso, mas há mais tempo que a tolerância — o
 *   agendador provavelmente parou de chamar.
 * - `falhando`: a passagem mais recente falhou (ou morreu no meio).
 * - `nunca`: nenhuma passagem registrada. Num ambiente novo é esperado; em
 *   produção, quer dizer que o job não foi criado.
 */
async function saude(agora = new Date()) {
  const { rows } = await pool.query(
    `SELECT t.tarefa,
            ult.iniciada_em AS ultima_execucao,
            ult.sucesso     AS ultima_sucesso,
            ult.terminada_em AS ultima_terminada_em,
            ult.erro        AS ultimo_erro,
            ok.iniciada_em  AS ultimo_sucesso,
            ok.resumo       AS ultimo_resumo
       FROM unnest($1::text[]) AS t(tarefa)
       LEFT JOIN LATERAL (
         SELECT * FROM execucao_tarefa e WHERE e.tarefa = t.tarefa
          ORDER BY iniciada_em DESC LIMIT 1
       ) ult ON TRUE
       LEFT JOIN LATERAL (
         SELECT * FROM execucao_tarefa e WHERE e.tarefa = t.tarefa AND e.sucesso
          ORDER BY iniciada_em DESC LIMIT 1
       ) ok ON TRUE`,
    [Object.keys(TAREFAS)]
  );

  return rows.map((r) => {
    const definicao = TAREFAS[r.tarefa];
    let situacao;
    if (!r.ultima_execucao) {
      situacao = 'nunca';
    } else if (r.ultima_sucesso === false) {
      situacao = 'falhando';
    } else if (r.ultima_sucesso === null && agora - new Date(r.ultima_execucao) > 15 * 60_000) {
      // Começou há mais de 15 minutos e nunca terminou: a função morreu.
      situacao = 'falhando';
    } else if (!r.ultimo_sucesso) {
      situacao = 'falhando';
    } else {
      const minutos = (agora - new Date(r.ultimo_sucesso)) / 60_000;
      situacao = minutos > definicao.toleranciaMinutos ? 'parada' : 'ok';
    }

    return {
      tarefa: r.tarefa,
      rotulo: definicao.rotulo,
      frequencia: definicao.frequencia,
      tolerancia_minutos: definicao.toleranciaMinutos,
      situacao,
      ultima_execucao: r.ultima_execucao,
      ultimo_sucesso: r.ultimo_sucesso,
      ultimo_resumo: r.ultimo_resumo,
      ultimo_erro: r.ultima_sucesso === false ? r.ultimo_erro : null,
    };
  });
}

module.exports = { registrar, saude, TAREFAS };

const pool = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Recorte de período. Um intervalo aberto dos dois lados é o padrão ("desde
 * sempre"), e datas malformadas são recusadas em vez de silenciosamente
 * ignoradas: um relatório que devolve o período errado sem avisar é pior
 * que um erro.
 */
function recorte({ de, ate }) {
  const condicoes = [];
  const params = [];

  for (const [rotulo, valor, operador] of [
    ['de', de, '>='],
    ['ate', ate, '<'],
  ]) {
    if (valor === undefined || valor === '') continue;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(Date.parse(valor))) {
      throw new AppError(`Parâmetro "${rotulo}" deve ser uma data no formato AAAA-MM-DD.`, 422, 'VALIDACAO');
    }

    params.push(valor);
    // "ate" usa < sobre o dia seguinte para incluir o dia inteiro informado,
    // e não parar à meia-noite dele.
    condicoes.push(
      operador === '<'
        ? `c.data_abertura < ($${params.length}::date + interval '1 day')`
        : `c.data_abertura >= $${params.length}::date`
    );
  }

  return {
    where: condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '',
    params,
  };
}

async function resumo(filtros = {}) {
  const { where, params } = recorte(filtros);

  const [porEstado, porCategoria, porPrioridade, totais] = await Promise.all([
    pool.query(
      `SELECT c.estado, count(*)::int AS total FROM chamado c ${where} GROUP BY c.estado ORDER BY total DESC`,
      params
    ),
    pool.query(
      `SELECT cat.nome AS categoria, count(*)::int AS total
         FROM chamado c JOIN categoria cat ON cat.id = c.categoria_id
         ${where}
        GROUP BY cat.nome ORDER BY total DESC`,
      params
    ),
    pool.query(
      `SELECT c.prioridade, count(*)::int AS total FROM chamado c ${where} GROUP BY c.prioridade ORDER BY total DESC`,
      params
    ),
    pool.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE c.estado = 'concluido')::int AS concluidos,
         count(*) FILTER (WHERE c.estado = 'cancelado')::int AS cancelados,
         count(*) FILTER (WHERE c.estado NOT IN ('concluido', 'cancelado'))::int AS em_aberto
       FROM chamado c ${where}`,
      params
    ),
  ]);

  return {
    totais: totais.rows[0],
    por_estado: porEstado.rows,
    por_categoria: porCategoria.rows,
    por_prioridade: porPrioridade.rows,
  };
}

// Tempo de atendimento desconta o período em "aguardando material": esse
// tempo é espera por insumo, não trabalho da equipe, e mantê-lo na conta
// faria a métrica punir a equipe por uma falha de suprimento.
const TEMPO_LIQUIDO = `
  EXTRACT(EPOCH FROM (c.data_conclusao - c.data_abertura - c.tempo_suspenso_total))
`;

async function desempenho(filtros = {}) {
  const { where, params } = recorte(filtros);
  const concluidos = where ? `${where} AND c.estado = 'concluido'` : "WHERE c.estado = 'concluido'";
  const emAberto = where
    ? `${where} AND c.estado NOT IN ('concluido','cancelado')`
    : "WHERE c.estado NOT IN ('concluido','cancelado')";

  const [geral, porCategoria, avaliacoes, prazo, marcos] = await Promise.all([
    pool.query(
      `SELECT
         count(*)::int AS chamados_concluidos,
         round(avg(${TEMPO_LIQUIDO}))::bigint AS tempo_medio_segundos,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${TEMPO_LIQUIDO}))::bigint AS tempo_mediano_segundos,
         round(max(${TEMPO_LIQUIDO}))::bigint AS tempo_maximo_segundos
       FROM chamado c ${concluidos}`,
      params
    ),
    pool.query(
      `SELECT cat.nome AS categoria,
              count(*)::int AS chamados_concluidos,
              round(avg(${TEMPO_LIQUIDO}))::bigint AS tempo_medio_segundos
         FROM chamado c JOIN categoria cat ON cat.id = c.categoria_id
         ${concluidos}
        GROUP BY cat.nome
        ORDER BY tempo_medio_segundos DESC NULLS LAST`,
      params
    ),
    pool.query(
      `SELECT count(*)::int AS total_avaliacoes,
              round(avg(a.nota), 2) AS nota_media
         FROM avaliacao a JOIN chamado c ON c.id = a.chamado_id ${where}`,
      params
    ),
    // Cumprimento de prazo em duas leituras que respondem perguntas
    // diferentes: o que já fechou respeitou o prazo, e o que ainda está em pé
    // já estourou. Só a primeira serviria de indicador de qualidade sem dizer
    // o que está pegando fogo agora.
    Promise.all([
      pool.query(
        `SELECT count(*) FILTER (WHERE c.prazo_estimado IS NOT NULL)::int AS com_prazo,
                count(*) FILTER (WHERE c.prazo_estimado IS NOT NULL
                                   AND c.data_conclusao <= c.prazo_estimado)::int AS no_prazo
           FROM chamado c ${concluidos}`,
        params
      ),
      pool.query(
        `SELECT count(*)::int AS em_aberto,
                count(*) FILTER (WHERE c.prazo_estimado IS NOT NULL
                                   AND now() > c.prazo_estimado)::int AS atrasados
           FROM chamado c ${emAberto}`,
        params
      ),
    ]),
    // Os três marcos que o §2.6 define para desambiguar "tempo de
    // atendimento". O início da triagem sai do próprio histórico, que é o
    // registro que sempre existiu para isso — não vale desnormalizar um dado
    // que já tem dono.
    pool.query(
      `SELECT
         round(avg(EXTRACT(EPOCH FROM (t.triagem_em - c.data_abertura))))::bigint AS tempo_triagem_segundos,
         count(t.triagem_em)::int AS chamados_triados,
         round(avg(EXTRACT(EPOCH FROM (c.inicio_execucao - c.data_abertura))))::bigint AS tempo_ate_atendimento_segundos,
         count(c.inicio_execucao)::int AS chamados_iniciados,
         round(avg(EXTRACT(EPOCH FROM (c.data_conclusao - c.inicio_execucao))))::bigint AS tempo_execucao_segundos
       FROM chamado c
       LEFT JOIN LATERAL (
         SELECT min(h.data) AS triagem_em
           FROM historico_chamado h
          WHERE h.chamado_id = c.id AND h.estado_novo = 'em_triagem'
       ) t ON TRUE
       ${where}`,
      params
    ),
  ]);

  const [fechados, abertos] = prazo;
  const { com_prazo: comPrazo, no_prazo: noPrazo } = fechados.rows[0];

  return {
    geral: geral.rows[0],
    marcos: marcos.rows[0],
    por_categoria: porCategoria.rows,
    avaliacoes: avaliacoes.rows[0],
    prazo: {
      concluidos_com_prazo: comPrazo,
      concluidos_no_prazo: noPrazo,
      // Sem nenhum chamado concluído com prazo definido não há percentual a
      // informar; devolver 0 sugeriria que tudo atrasou.
      percentual_no_prazo: comPrazo > 0 ? Math.round((noPrazo / comPrazo) * 100) : null,
      em_aberto: abertos.rows[0].em_aberto,
      em_aberto_atrasados: abertos.rows[0].atrasados,
    },
  };
}

async function porTecnico(filtros = {}) {
  const { where, params } = recorte(filtros);
  const comTecnico = where ? `${where} AND c.tecnico_id IS NOT NULL` : 'WHERE c.tecnico_id IS NOT NULL';

  const { rows } = await pool.query(
    `SELECT u.id AS tecnico_id,
            u.nome,
            count(*)::int AS atribuidos,
            count(*) FILTER (WHERE c.estado = 'concluido')::int AS concluidos,
            count(*) FILTER (WHERE c.estado NOT IN ('concluido', 'cancelado'))::int AS em_aberto,
            round(avg(${TEMPO_LIQUIDO}) FILTER (WHERE c.estado = 'concluido'))::bigint AS tempo_medio_segundos
       FROM chamado c JOIN usuario u ON u.id = c.tecnico_id
       ${comTecnico}
      GROUP BY u.id, u.nome
      ORDER BY atribuidos DESC, u.nome`,
    params
  );

  return rows;
}

module.exports = { resumo, desempenho, porTecnico };

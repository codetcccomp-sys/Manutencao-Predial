const pool = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Recorte de período. Um intervalo aberto dos dois lados é o padrão ("desde
 * sempre"), e datas malformadas são recusadas em vez de silenciosamente
 * ignoradas: um relatório que devolve o período errado sem avisar é pior
 * que um erro.
 */
function recorte({ de, ate }, coluna = 'c.data_abertura') {
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
        ? `${coluna} < ($${params.length}::date + interval '1 day')`
        : `${coluna} >= $${params.length}::date`
    );
  }

  return {
    where: condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '',
    params,
  };
}

/**
 * Roda as consultas de um relatório sobre o mesmo instante do banco.
 *
 * Os recortes (por estado, por categoria, por local) e o total são consultas
 * separadas. Com `pool.query` cada uma pega sua conexão e enxerga o banco um
 * instante depois da anterior: basta um chamado nascer no meio para que as
 * partes não fechem com o total — e quem lê não tem como saber que a diferença
 * veio do relógio, não dos dados. Um relatório um segundo mais velho é melhor
 * que um que se contradiz.
 */
async function emSnapshot(executar) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const resultado = await executar(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// O rótulo do local vem de locais.service: o relatório, a planilha e a tela de
// chamado precisam dele escrito do mesmo jeito, e três cópias divergiriam na
// primeira vez que o local ganhasse um nível.
const ROTULO_LOCAL = require('./locais.service').rotuloSql('l');

async function resumo(filtros = {}) {
  const { where, params } = recorte(filtros);

  // Uma consulta de cada vez, e não Promise.all: as cinco dividem a mesma
  // conexão, que as executa em fila de qualquer jeito. Disparar todas juntas
  // não ganhava paralelismo nenhum — só enfileirava no driver, que avisa que
  // vai deixar de aceitar `client.query()` concorrente no pg 9.
  const { porEstado, porCategoria, porPrioridade, porLocal, porOrigem, totais } = await emSnapshot(
    async (client) => ({
      porEstado: await client.query(
        `SELECT c.estado, count(*)::int AS total FROM chamado c ${where} GROUP BY c.estado ORDER BY total DESC`,
        params
      ),
      porCategoria: await client.query(
        `SELECT cat.nome AS categoria, count(*)::int AS total
           FROM chamado c JOIN categoria cat ON cat.id = c.categoria_id
           ${where}
          GROUP BY cat.nome ORDER BY total DESC`,
        params
      ),
      porPrioridade: await client.query(
        `SELECT c.prioridade, count(*)::int AS total FROM chamado c ${where} GROUP BY c.prioridade ORDER BY total DESC`,
        params
      ),
      // RF10: o total sozinho diz onde há movimento; o que a gestão precisa
      // saber é onde há demanda parada e vencida, então as três colunas andam
      // juntas.
      porLocal: await client.query(
        `SELECT ${ROTULO_LOCAL} AS local,
                count(*)::int AS total,
                count(*) FILTER (WHERE c.estado NOT IN ('concluido', 'cancelado'))::int AS em_aberto,
                count(*) FILTER (
                  WHERE c.estado NOT IN ('concluido', 'cancelado')
                    AND c.prazo_estimado IS NOT NULL
                    AND now() > c.prazo_estimado
                )::int AS atrasados
           FROM chamado c JOIN local l ON l.id = c.local_id
           ${where}
          GROUP BY ${ROTULO_LOCAL}
          ORDER BY total DESC, local
          LIMIT 20`,
        params
      ),
      porOrigem: await client.query(
        `SELECT c.origem, count(*)::int AS total FROM chamado c ${where} GROUP BY c.origem ORDER BY c.origem`,
        params
      ),
      totais: await client.query(
        `SELECT
           count(*)::int AS total,
           count(*) FILTER (WHERE c.estado = 'concluido')::int AS concluidos,
           count(*) FILTER (WHERE c.estado = 'cancelado')::int AS cancelados,
           count(*) FILTER (WHERE c.estado NOT IN ('concluido', 'cancelado'))::int AS em_aberto
         FROM chamado c ${where}`,
        params
      ),
    })
  );

  return {
    totais: totais.rows[0],
    por_estado: porEstado.rows,
    por_categoria: porCategoria.rows,
    por_prioridade: porPrioridade.rows,
    // Limitado aos 20 locais com mais chamados: uma instituição tem centenas
    // de ambientes, e a lista completa aqui seria ruído, não informação.
    por_local: porLocal.rows,
    // Quanto do trabalho foi planejado e quanto foi apagar incêndio. Numa
    // manutenção que funciona, a fatia preventiva cresce e a corretiva cai.
    por_origem: porOrigem.rows,
  };
}

/**
 * Cumprimento do plano de manutenção preventiva (NBR 5674).
 *
 * O recorte aqui é pela DATA PREVISTA, e não pela abertura: a pergunta é
 * "do que estava marcado para março, quanto foi feito em dia?", e uma
 * preventiva de março gerada com antecedência em fevereiro é de março.
 *
 * "Feito em dia" é concluído até o prazo do chamado — o fim do dia previsto,
 * estendido pelo tempo em que esperou material, como em todo o sistema.
 *
 * O percentual de cumprimento só conta o que já pode ser julgado: concluídas
 * (em dia ou não) e vencidas sem conclusão. As que ainda estão dentro do
 * prazo não entram nem a favor nem contra, e as canceladas também não — senão
 * o indicador de março oscilaria a cada dia de março.
 */
async function preventiva(filtros = {}) {
  const { where, params } = recorte(filtros, 'c.data_prevista');
  const base = where ? `${where} AND c.origem = 'preventiva'` : "WHERE c.origem = 'preventiva'";

  return emSnapshot(async (client) => {
    const totais = await client.query(
      `SELECT
         count(*)::int AS previstas,
         count(*) FILTER (WHERE c.estado = 'concluido' AND c.data_conclusao <= c.prazo_estimado)::int
           AS concluidas_no_prazo,
         count(*) FILTER (WHERE c.estado = 'concluido' AND c.data_conclusao > c.prazo_estimado)::int
           AS concluidas_com_atraso,
         count(*) FILTER (WHERE c.estado NOT IN ('concluido', 'cancelado') AND now() > c.prazo_estimado)::int
           AS vencidas_pendentes,
         count(*) FILTER (WHERE c.estado NOT IN ('concluido', 'cancelado') AND now() <= c.prazo_estimado)::int
           AS no_prazo_pendentes,
         count(*) FILTER (WHERE c.estado = 'cancelado')::int AS canceladas
       FROM chamado c ${base}`,
      params
    );

    // Onde o plano mais falha: planos com execuções vencidas sem conclusão.
    const planosAtrasados = await client.query(
      `SELECT p.id, p.titulo,
              count(*)::int AS vencidas_pendentes,
              min(c.data_prevista)::text AS mais_antiga
         FROM chamado c JOIN plano_preventivo p ON p.id = c.plano_id
         ${base} AND c.estado NOT IN ('concluido', 'cancelado') AND now() > c.prazo_estimado
        GROUP BY p.id, p.titulo
        ORDER BY vencidas_pendentes DESC, mais_antiga
        LIMIT 10`,
      params
    );

    // O outro lado da moeda: equipamentos que mais quebram. Corretivo
    // repetido no mesmo equipamento é o sinal de que falta (ou falha) a
    // preventiva dele. Aqui o recorte volta a ser pela abertura, porque
    // corretivo não tem data prevista.
    const recorteAbertura = recorte(filtros);
    const ondeCorretivo = recorteAbertura.where
      ? `${recorteAbertura.where} AND c.origem = 'corretiva' AND c.equipamento_id IS NOT NULL`
      : "WHERE c.origem = 'corretiva' AND c.equipamento_id IS NOT NULL";
    const equipamentos = await client.query(
      `SELECT e.id, e.codigo, e.nome,
              count(*)::int AS corretivos,
              EXISTS (SELECT 1 FROM plano_preventivo p WHERE p.equipamento_id = e.id AND p.ativo) AS tem_plano
         FROM chamado c JOIN equipamento e ON e.id = c.equipamento_id
         ${ondeCorretivo}
        GROUP BY e.id
        ORDER BY corretivos DESC, e.codigo
        LIMIT 10`,
      recorteAbertura.params
    );

    const t = totais.rows[0];
    const julgaveis = t.concluidas_no_prazo + t.concluidas_com_atraso + t.vencidas_pendentes;

    return {
      totais: t,
      // Sem nada julgável não há percentual: 0% sugeriria que tudo falhou.
      percentual_cumprimento: julgaveis > 0 ? Math.round((t.concluidas_no_prazo / julgaveis) * 100) : null,
      planos_com_atraso: planosAtrasados.rows,
      equipamentos_com_mais_corretivos: equipamentos.rows,
    };
  });
}

// O dia de um chamado é o dia NO FUSO DA INSTITUIÇÃO, não o do servidor (UTC). Um
// chamado aberto às 22h de segunda em Brasília nasce às 01h de terça em UTC, e
// contá-lo na terça faria o gráfico discordar de quem abriu o chamado — justamente
// as noites, que é quando a manutenção predial menos tem gente para conferir.
const FUSO = process.env.FUSO_HORARIO || 'America/Sao_Paulo';

// Um ano de pontos diários é o que um gráfico de linha aguenta sem virar borrão, e
// também o que uma resposta aguenta sem virar peso: sem o teto, "desde sempre" numa
// instituição antiga devolveria milhares de linhas para desenhar quatrocentos pixels.
const MAXIMO_DIAS_SERIE = 366;

const hojeNoFuso = () => new Date().toLocaleDateString('en-CA', { timeZone: FUSO });

const somarDias = (dia, n) => {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};

const diasEntre = (ini, fim) =>
  Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${ini}T00:00:00Z`)) / 86_400_000);

/**
 * Chamados abertos e concluídos por dia, para o gráfico de linha.
 *
 * O recorte é o do resto do relatório: chamados ABERTOS no período. "Concluídos"
 * são, portanto, os desse mesmo grupo e contados no dia em que terminaram — não
 * todo o trabalho que a equipe fechou naquele dia. Misturar os dois responderia
 * outra pergunta ("qual o ritmo da equipe?") e faria o gráfico discordar dos
 * totais logo acima dele. Dias sem nenhum chamado vêm com zero: um gráfico que
 * pula os dias vazios liga pontos distantes e mente sobre o ritmo.
 */
async function serieDiaria(filtros = {}) {
  // Valida de/ate antes de qualquer consulta: data malformada é 422, não "tudo".
  const { where, params } = recorte(filtros);
  const conector = where ? 'AND' : 'WHERE';
  const aoFim = params.length;

  return emSnapshot(async (client) => {
    const fim = filtros.ate || hojeNoFuso();

    let ini = filtros.de;
    if (!ini) {
      const { rows } = await client.query(
        `SELECT min((c.data_abertura AT TIME ZONE $${aoFim + 1})::date)::text AS primeiro
           FROM chamado c ${where}`,
        [...params, FUSO]
      );
      ini = rows[0].primeiro ?? fim;
    }

    let truncado = false;
    if (diasEntre(ini, fim) + 1 > MAXIMO_DIAS_SERIE) {
      ini = somarDias(fim, -(MAXIMO_DIAS_SERIE - 1));
      truncado = true;
    }

    if (ini > fim) return { de: ini, ate: fim, truncado: false, dias: [] };

    const { rows } = await client.query(
      `WITH dias AS (
         SELECT generate_series($${aoFim + 2}::date, $${aoFim + 3}::date, interval '1 day')::date AS dia
       ), abertos AS (
         SELECT (c.data_abertura AT TIME ZONE $${aoFim + 1})::date AS dia, count(*)::int AS n
           FROM chamado c ${where} GROUP BY 1
       ), concluidos AS (
         SELECT (c.data_conclusao AT TIME ZONE $${aoFim + 1})::date AS dia, count(*)::int AS n
           FROM chamado c ${where} ${conector} c.estado = 'concluido' AND c.data_conclusao IS NOT NULL
          GROUP BY 1
       )
       SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia,
              COALESCE(a.n, 0)::int AS abertos,
              COALESCE(k.n, 0)::int AS concluidos
         FROM dias d
         LEFT JOIN abertos a ON a.dia = d.dia
         LEFT JOIN concluidos k ON k.dia = d.dia
        ORDER BY d.dia`,
      [...params, FUSO, ini, fim]
    );

    return { de: ini, ate: fim, truncado, dias: rows };
  });
}

// Tempo de atendimento desconta o período em "aguardando material": esse
// tempo é espera por insumo, não trabalho da equipe, e mantê-lo na conta
// faria a métrica punir a equipe por uma falha de suprimento.
const TEMPO_LIQUIDO = `
  EXTRACT(EPOCH FROM (c.data_conclusao - c.data_abertura - c.tempo_suspenso_total))
`;

// Mesma leitura de atraso que o serviço de chamados faz, com as colunas
// qualificadas para conviver com os JOINs da exportação.
const EM_ATRASO_EXPORTACAO = `(
  c.estado NOT IN ('concluido', 'cancelado')
  AND c.prazo_estimado IS NOT NULL
  AND now() > c.prazo_estimado
)`;

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

// Teto da exportação analítica. Não é um limite de banco, é de memória e de
// paciência: uma planilha maior que isto não se abre bem no Excel nem se
// analisa à mão. Truncar em silêncio seria pior — quem recebesse o arquivo
// pivotaria dados incompletos sem saber —, então a exportação recusa e pede
// um período menor.
const LIMITE_EXPORTACAO = 20000;
const LOTE_EXPORTACAO = 500;

/**
 * Percorre os chamados do período em lotes, entregando cada lote a
 * `aoReceberLote`.
 *
 * Não devolve tudo de uma vez de propósito: a resposta é escrita conforme os
 * lotes chegam, então a memória do processo não cresce com o tamanho do
 * relatório. A paginação é por `id` (keyset) e não por OFFSET, que releria as
 * mesmas linhas a cada lote e ainda assim poderia pular registros.
 *
 * Tudo roda no mesmo snapshot: um chamado aberto no meio da exportação não
 * aparece no lote 7 de um arquivo cujo lote 1 não o conhecia.
 */
async function percorrerChamados(filtros, aoReceberLote) {
  const { where, params } = recorte(filtros);

  return emSnapshot(async (client) => {
    const { rows: contagem } = await client.query(
      `SELECT count(*)::int AS total FROM chamado c ${where}`,
      params
    );
    const total = contagem[0].total;

    if (total > LIMITE_EXPORTACAO) {
      throw new AppError(
        `A exportação traria ${total.toLocaleString('pt-BR')} chamados, acima do limite de ` +
          `${LIMITE_EXPORTACAO.toLocaleString('pt-BR')}. Informe um período menor.`,
        422,
        'EXPORTACAO_GRANDE'
      );
    }

    const filtroPeriodo = where ? where.replace(/^WHERE /, ' AND ') : '';
    let ultimoId = 0;

    for (;;) {
      const { rows } = await client.query(
        `SELECT c.id,
                c.protocolo,
                c.titulo,
                cat.nome AS categoria,
                ${ROTULO_LOCAL} AS local,
                eq.codigo AS equipamento_codigo,
                eq.nome AS equipamento_nome,
                c.origem,
                c.data_prevista,
                c.estado,
                c.prioridade,
                c.prioridade_sugerida,
                c.urgencia,
                c.impacto,
                c.risco,
                sol.nome AS solicitante,
                tec.nome AS tecnico,
                c.data_abertura,
                c.inicio_execucao,
                c.data_conclusao,
                c.prazo_estimado,
                c.tempo_suspenso_total,
                c.tempo_empregado_minutos,
                c.total_reaberturas,
                ${TEMPO_LIQUIDO} AS tempo_liquido_segundos,
                CASE
                  WHEN c.data_conclusao IS NULL OR c.prazo_estimado IS NULL THEN NULL
                  ELSE c.data_conclusao <= c.prazo_estimado
                END AS concluido_no_prazo,
                ${EM_ATRASO_EXPORTACAO} AS em_atraso,
                a.nota AS nota_avaliacao
           FROM chamado c
           JOIN categoria cat ON cat.id = c.categoria_id
           JOIN local l ON l.id = c.local_id
           LEFT JOIN equipamento eq ON eq.id = c.equipamento_id
           JOIN usuario sol ON sol.id = c.solicitante_id
           LEFT JOIN usuario tec ON tec.id = c.tecnico_id
           LEFT JOIN avaliacao a ON a.chamado_id = c.id
          WHERE c.id > $${params.length + 1}${filtroPeriodo}
          ORDER BY c.id
          LIMIT ${LOTE_EXPORTACAO}`,
        [...params, ultimoId]
      );

      if (rows.length === 0) return total;

      await aoReceberLote(rows);
      ultimoId = rows[rows.length - 1].id;
    }
  });
}

module.exports = {
  preventiva,
  resumo,
  desempenho,
  porTecnico,
  serieDiaria,
  percorrerChamados,
  LIMITE_EXPORTACAO,
  MAXIMO_DIAS_SERIE,
};

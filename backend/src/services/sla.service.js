const pool = require('../config/db');
const { transacao } = require('../config/transacao');
const { AppError } = require('../middlewares/errorHandler');

const PRIORIDADES = ['critica', 'alta', 'media', 'baixa'];
// SQLSTATE 42P01, undefined_table.
const TABELA_AUSENTE = '42P01';

async function listar() {
  const { rows } = await pool.query(
    `SELECT prioridade, prazo_horas, contagem, atualizado_em FROM sla
      ORDER BY array_position(ARRAY['critica','alta','media','baixa']::prioridade_chamado[], prioridade)`
  );
  return rows;
}

/**
 * Ajusta o prazo de uma prioridade: as horas e/ou a régua (corridas ou úteis).
 *
 * Vale para chamados abertos daqui em diante; os existentes mantêm o prazo
 * com que nasceram — mudar a regra no meio do caminho faria um chamado ficar
 * atrasado (ou deixar de estar) sem que nada nele tivesse mudado.
 *
 * RN12: cada alteração vira uma versão em `sla_versao`, com a vigência e quem
 * alterou. Reenviar o mesmo valor não cria versão: uma linha no histórico tem
 * de significar que o prazo mudou.
 */
async function atualizar(prioridade, { prazo_horas: prazoHoras, contagem }, autorId = null) {
  if (!PRIORIDADES.includes(prioridade)) {
    throw new AppError('Prioridade não encontrada.', 404, 'PRIORIDADE_NAO_ENCONTRADA');
  }
  if (prazoHoras === undefined && contagem === undefined) {
    throw new AppError('Informe o prazo em horas, a contagem, ou os dois.', 422, 'NADA_A_ATUALIZAR');
  }

  return transacao(async (client) => {
    // FOR UPDATE: duas alterações ao mesmo tempo gravariam duas versões
    // comparadas contra o mesmo valor antigo.
    const antes = await client.query(
      'SELECT prazo_horas, contagem FROM sla WHERE prioridade = $1::prioridade_chamado FOR UPDATE',
      [prioridade]
    );
    if (!antes.rows[0]) {
      throw new AppError('Prioridade não encontrada.', 404, 'PRIORIDADE_NAO_ENCONTRADA');
    }

    const mudou =
      (prazoHoras !== undefined && prazoHoras !== antes.rows[0].prazo_horas) ||
      (contagem !== undefined && contagem !== antes.rows[0].contagem);
    if (!mudou) {
      const { rows } = await client.query(
        'SELECT prioridade, prazo_horas, contagem, atualizado_em FROM sla WHERE prioridade = $1::prioridade_chamado',
        [prioridade]
      );
      return rows[0];
    }

    const { rows } = await client.query(
      `UPDATE sla SET prazo_horas = COALESCE($1, prazo_horas),
                      contagem = COALESCE($2::contagem_prazo, contagem),
                      atualizado_em = now()
        WHERE prioridade = $3::prioridade_chamado
        RETURNING prioridade, prazo_horas, contagem, atualizado_em`,
      [prazoHoras ?? null, contagem ?? null, prioridade]
    );

    // O código chega à produção no deploy, e a migração 032 só quando alguém roda
    // `npm run migrate` lá. Nesse intervalo a tabela não existe, e ajustar um
    // prazo não pode virar erro: o prazo é gravado, a versão não, e o console
    // avisa. O SAVEPOINT é o que permite seguir: sem ele o erro do INSERT
    // condenaria a transação inteira, e o UPDATE acima iria junto.
    await client.query('SAVEPOINT versao_do_sla');
    try {
      await client.query(
        `INSERT INTO sla_versao (prioridade, prazo_horas, contagem, vigente_desde, alterado_por)
         VALUES ($1::prioridade_chamado, $2, $3::contagem_prazo, $4, $5)`,
        [prioridade, rows[0].prazo_horas, rows[0].contagem, rows[0].atualizado_em, autorId]
      );
    } catch (err) {
      if (err.code !== TABELA_AUSENTE) throw err;
      await client.query('ROLLBACK TO SAVEPOINT versao_do_sla');
      console.warn('[sla] tabela sla_versao ausente: rode `npm run migrate` (migração 032). Prazo alterado sem versão.');
    }

    return rows[0];
  });
}

/**
 * RN12: as versões da política de prazos, da mais recente para a mais antiga.
 *
 * `vigente_ate` é o início da versão seguinte da mesma prioridade (nulo na que
 * vale hoje): é o que responde "qual era o prazo quando este chamado abriu".
 */
async function historico() {
  const { rows } = await pool
    .query(
    `SELECT v.id, v.prioridade, v.prazo_horas, v.contagem, v.vigente_desde,
            lead(v.vigente_desde) OVER (PARTITION BY v.prioridade ORDER BY v.vigente_desde, v.id) AS vigente_ate,
            u.nome AS alterado_por
       FROM sla_versao v
       LEFT JOIN usuario u ON u.id = v.alterado_por
      ORDER BY v.vigente_desde DESC, v.id DESC
      LIMIT 200`
    )
    .catch((err) => {
      // Antes da migração 032 não há histórico para mostrar; não é erro da tela.
      if (err.code === TABELA_AUSENTE) return { rows: [] };
      throw err;
    });
  return rows;
}

// ---------------------------------------------------------------------------
// Expediente e feriados: a régua das horas úteis
// ---------------------------------------------------------------------------

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

async function expediente() {
  const { rows } = await pool.query(
    "SELECT dia_semana, to_char(inicio, 'HH24:MI') AS inicio, to_char(fim, 'HH24:MI') AS fim FROM expediente ORDER BY dia_semana"
  );
  return rows;
}

/**
 * Troca o expediente inteiro de uma vez.
 *
 * É a semana que se edita, não um dia avulso: quem muda "sexta até as 17h"
 * está olhando para a semana, e gravar dia a dia deixaria, entre um pedido e
 * outro, uma semana pela metade valendo para os prazos que nascessem ali.
 */
async function definirExpediente(dias) {
  if (!Array.isArray(dias)) {
    throw new AppError('Envie "dias": a lista de dias com expediente.', 422, 'VALIDACAO');
  }
  const vistos = new Set();
  for (const d of dias) {
    if (!Number.isInteger(d.dia_semana) || d.dia_semana < 0 || d.dia_semana > 6) {
      throw new AppError('"dia_semana" vai de 0 (domingo) a 6 (sábado).', 422, 'VALIDACAO');
    }
    if (vistos.has(d.dia_semana)) {
      throw new AppError('Cada dia da semana aparece uma vez só.', 422, 'VALIDACAO');
    }
    vistos.add(d.dia_semana);
    if (!HORA.test(d.inicio ?? '') || !HORA.test(d.fim ?? '') || d.fim <= d.inicio) {
      throw new AppError('Início e fim em HH:MM, com o fim depois do início.', 422, 'VALIDACAO');
    }
  }

  await transacao(async (client) => {
    await client.query('DELETE FROM expediente');
    for (const d of dias) {
      await client.query('INSERT INTO expediente (dia_semana, inicio, fim) VALUES ($1, $2, $3)', [
        d.dia_semana,
        d.inicio,
        d.fim,
      ]);
    }
  });

  return expediente();
}

async function feriados({ ano } = {}) {
  const params = [];
  let filtro = '';
  if (ano && /^\d{4}$/.test(String(ano))) {
    params.push(Number(ano));
    filtro = 'WHERE EXTRACT(YEAR FROM data) = $1';
  }
  const { rows } = await pool.query(`SELECT data, descricao FROM feriado ${filtro} ORDER BY data`, params);
  return rows;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

async function adicionarFeriado({ data, descricao }) {
  if (!DATA.test(data ?? '') || Number.isNaN(Date.parse(data))) {
    throw new AppError('"data" no formato AAAA-MM-DD.', 422, 'VALIDACAO');
  }
  const { rows } = await pool.query(
    `INSERT INTO feriado (data, descricao) VALUES ($1, $2)
     ON CONFLICT (data) DO UPDATE SET descricao = EXCLUDED.descricao
     RETURNING data, descricao`,
    [data, descricao.trim()]
  );
  return rows[0];
}

async function removerFeriado(data) {
  // `/sla/feriados/abc` chegava ao banco e voltava como erro interno.
  if (!DATA.test(data ?? '') || Number.isNaN(Date.parse(data))) {
    throw new AppError('Feriado não encontrado.', 404, 'FERIADO_NAO_ENCONTRADO');
  }
  const { rowCount } = await pool.query('DELETE FROM feriado WHERE data = $1', [data]);
  if (rowCount === 0) {
    throw new AppError('Feriado não encontrado.', 404, 'FERIADO_NAO_ENCONTRADO');
  }
}

module.exports = {
  listar,
  atualizar,
  historico,
  expediente,
  definirExpediente,
  feriados,
  adicionarFeriado,
  removerFeriado,
};

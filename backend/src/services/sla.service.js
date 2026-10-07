const pool = require('../config/db');
const { transacao } = require('../config/transacao');
const { AppError } = require('../middlewares/errorHandler');

const PRIORIDADES = ['critica', 'alta', 'media', 'baixa'];

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
 */
async function atualizar(prioridade, { prazo_horas: prazoHoras, contagem }) {
  if (!PRIORIDADES.includes(prioridade)) {
    throw new AppError('Prioridade não encontrada.', 404, 'PRIORIDADE_NAO_ENCONTRADA');
  }
  if (prazoHoras === undefined && contagem === undefined) {
    throw new AppError('Informe o prazo em horas, a contagem, ou os dois.', 422, 'NADA_A_ATUALIZAR');
  }

  const { rows } = await pool.query(
    `UPDATE sla SET prazo_horas = COALESCE($1, prazo_horas),
                    contagem = COALESCE($2::contagem_prazo, contagem),
                    atualizado_em = now()
      WHERE prioridade = $3::prioridade_chamado
      RETURNING prioridade, prazo_horas, contagem, atualizado_em`,
    [prazoHoras ?? null, contagem ?? null, prioridade]
  );

  if (!rows[0]) {
    throw new AppError('Prioridade não encontrada.', 404, 'PRIORIDADE_NAO_ENCONTRADA');
  }
  return rows[0];
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
  const { rowCount } = await pool.query('DELETE FROM feriado WHERE data = $1', [data]);
  if (rowCount === 0) {
    throw new AppError('Feriado não encontrado.', 404, 'FERIADO_NAO_ENCONTRADO');
  }
}

module.exports = {
  listar,
  atualizar,
  expediente,
  definirExpediente,
  feriados,
  adicionarFeriado,
  removerFeriado,
};

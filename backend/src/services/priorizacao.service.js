const pool = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');

const FATORES = ['urgencia', 'impacto', 'risco'];

async function regraVigente(executor = pool) {
  const { rows } = await executor.query(
    'SELECT * FROM regra_priorizacao WHERE vigencia_fim IS NULL'
  );
  if (!rows[0]) {
    throw new AppError(
      'Não há regra de priorização vigente. Cadastre uma versão antes de priorizar chamados.',
      409,
      'SEM_REGRA_VIGENTE'
    );
  }
  return rows[0];
}

/**
 * Aplica a regra aos três fatores.
 *
 * Função pura de propósito: a decisão de prioridade é o tipo de coisa que
 * precisa ser explicada anos depois ("por que este chamado virou crítico?"),
 * e isolá-la do banco permite testá-la exaustivamente e devolver o porquê
 * junto do resultado.
 */
function calcular({ urgencia, impacto, risco }, regra) {
  const pontuacao =
    regra.peso_urgencia * urgencia + regra.peso_impacto * impacto + regra.peso_risco * risco;

  // RN04: risco grave impõe crítica e prevalece sobre qualquer cálculo
  // automático. Vem antes dos limiares justamente por ser regra de exceção.
  if (risco >= regra.risco_critico_minimo) {
    return {
      pontuacao,
      prioridade: 'critica',
      motivo: `Risco ${risco} atinge o mínimo de ${regra.risco_critico_minimo} definido para prioridade crítica (RN04).`,
    };
  }

  const faixas = [
    ['critica', regra.limiar_critica],
    ['alta', regra.limiar_alta],
    ['media', regra.limiar_media],
  ];

  for (const [prioridade, limiar] of faixas) {
    if (pontuacao >= limiar) {
      return {
        pontuacao,
        prioridade,
        motivo: `Pontuação ${pontuacao} atinge o limiar ${limiar} da prioridade ${prioridade} (regra ${regra.versao}).`,
      };
    }
  }

  return {
    pontuacao,
    prioridade: 'baixa',
    motivo: `Pontuação ${pontuacao} abaixo do limiar ${regra.limiar_media} da prioridade média (regra ${regra.versao}).`,
  };
}

function validarFatores(fatores) {
  for (const fator of FATORES) {
    const valor = fatores[fator];
    if (!Number.isInteger(valor) || valor < 1 || valor > 4) {
      throw new AppError(`Campo "${fator}" deve ser um inteiro de 1 a 4.`, 422, 'VALIDACAO');
    }
  }
}

async function simular(fatores) {
  validarFatores(fatores);
  const regra = await regraVigente();
  const resultado = calcular(fatores, regra);
  return { ...resultado, regra: { versao: regra.versao, id: regra.id } };
}

async function listarRegras() {
  const { rows } = await pool.query(
    'SELECT * FROM regra_priorizacao ORDER BY vigencia_inicio DESC'
  );
  return rows;
}

/**
 * Publica uma nova versão da regra, encerrando a vigência da anterior.
 *
 * As versões antigas não são apagadas: cada chamado guarda qual delas
 * produziu sua sugestão, e sem elas não haveria como explicar uma decisão
 * tomada sob uma calibração que não existe mais (RN12).
 */
async function criarVersao({
  versao,
  peso_urgencia,
  peso_impacto,
  peso_risco,
  limiar_media,
  limiar_alta,
  limiar_critica,
  risco_critico_minimo,
  observacao,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const agora = new Date();
    await client.query(
      'UPDATE regra_priorizacao SET vigencia_fim = $1 WHERE vigencia_fim IS NULL',
      [agora]
    );

    const { rows } = await client.query(
      `INSERT INTO regra_priorizacao
         (versao, peso_urgencia, peso_impacto, peso_risco,
          limiar_media, limiar_alta, limiar_critica, risco_critico_minimo,
          observacao, vigencia_inicio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        versao,
        peso_urgencia,
        peso_impacto,
        peso_risco,
        limiar_media,
        limiar_alta,
        limiar_critica,
        risco_critico_minimo,
        observacao || null,
        agora,
      ]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      throw new AppError('Já existe uma regra com esta versão.', 409, 'VERSAO_EM_USO');
    }
    if (err.code === '23514') {
      throw new AppError(
        'Limiares precisam ser crescentes: média < alta < crítica.',
        422,
        'LIMIARES_INVALIDOS'
      );
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { regraVigente, calcular, simular, listarRegras, criarVersao, validarFatores };

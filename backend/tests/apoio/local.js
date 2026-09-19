const pool = require('../../src/config/db');
const { NIVEIS, chaveNatural, CONFLITO } = require('../../src/services/locais.service');

/**
 * Garante que um local exista e devolve o id.
 *
 * As suítes inseriam locais de nome fixo direto na tabela, sem apagá-los no
 * fim. Enquanto não havia chave natural isso passava despercebido e ia
 * acumulando: o banco de desenvolvimento chegou a 1602 linhas para 303 lugares
 * distintos. Com o índice único da migração 014 o segundo INSERT passa a
 * falhar, então a suíte precisa conciliar em vez de inserir — que é, aliás, o
 * que ela sempre quis dizer.
 */
async function garantirLocal(campos) {
  const valores = NIVEIS.map((nivel) => campos[nivel] ?? null);

  const inserido = await pool.query(
    `INSERT INTO local (${NIVEIS.join(', ')})
          VALUES (${NIVEIS.map((_, i) => `$${i + 1}`).join(', ')})
          ${CONFLITO}
       RETURNING id`,
    valores
  );
  if (inserido.rows[0]) return inserido.rows[0].id;

  const { rows } = await pool.query(
    `SELECT id FROM local
      WHERE ${chaveNatural().map((expressao, i) => `${expressao} = $${i + 1}`).join(' AND ')}`,
    NIVEIS.map((nivel) => String(campos[nivel] ?? '').trim().toLowerCase())
  );
  return rows[0].id;
}

module.exports = { garantirLocal };

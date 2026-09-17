const pool = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');

async function listar() {
  const { rows } = await pool.query(
    `SELECT prioridade, prazo_horas, atualizado_em FROM sla
      ORDER BY array_position(ARRAY['critica','alta','media','baixa']::prioridade_chamado[], prioridade)`
  );
  return rows;
}

async function atualizar(prioridade, prazoHoras) {
  const { rows } = await pool.query(
    `UPDATE sla SET prazo_horas = $1, atualizado_em = now()
      WHERE prioridade = $2::prioridade_chamado
      RETURNING prioridade, prazo_horas, atualizado_em`,
    [prazoHoras, prioridade]
  );

  if (!rows[0]) {
    throw new AppError('Prioridade não encontrada.', 404, 'PRIORIDADE_NAO_ENCONTRADA');
  }
  return rows[0];
}

/**
 * Prazo de um chamado que está sendo aberto agora.
 *
 * Roda dentro da transação de abertura, com o mesmo client, para que o prazo
 * nasça junto do chamado — um chamado sem prazo seria invisível para toda a
 * apuração de atraso.
 */
async function calcularPrazo(client, prioridade) {
  const { rows } = await client.query(
    'SELECT prazo_horas FROM sla WHERE prioridade = $1::prioridade_chamado',
    [prioridade || 'baixa']
  );

  // Uma prioridade sem prazo configurado não pode impedir a abertura do
  // chamado: o pedido do usuário vale mais que a parametrização faltando.
  if (!rows[0]) return null;

  return rows[0].prazo_horas;
}

module.exports = { listar, atualizar, calcularPrazo };

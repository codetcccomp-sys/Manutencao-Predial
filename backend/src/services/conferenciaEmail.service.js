const pool = require('../config/db');
const email = require('./email.service');
const execucoes = require('./execucoes.service');

// Uma conferência por hora basta: 96 logins por dia no Gmail, só para conferir, poderiam
// eles mesmos parecer suspeitos ao Google.
const INTERVALO_MINUTOS = 55;

/**
 * Confere o login no servidor de e-mail se a última conferência bem-sucedida passou da hora.
 *
 * Depois de uma falha, confere de novo a cada chamada (a passagem de 15 minutos): quem acabou
 * de trocar a senha na Vercel não deve esperar uma hora para o aviso sair do painel.
 *
 * Nunca lança: é um acréscimo à passagem do agendador, e uma falha aqui não pode derrubar o
 * aviso de atraso. A falha fica registrada (`execucao_tarefa`), que é onde ela precisa estar.
 */
async function conferirSeVencida() {
  try {
    const { rows } = await pool.query(
      `SELECT sucesso FROM execucao_tarefa WHERE tarefa = 'conferir-email'
        ORDER BY iniciada_em DESC LIMIT 1`
    );
    const ultima = rows[0];
    if (ultima?.sucesso) {
      const recente = await pool.query(
        `SELECT 1 FROM execucao_tarefa
          WHERE tarefa = 'conferir-email' AND sucesso AND iniciada_em > now() - make_interval(mins => $1)`,
        [INTERVALO_MINUTOS]
      );
      if (recente.rows.length) return { conferido: false };
    }
    await execucoes.registrar('conferir-email', () => email.conferir());
    return { conferido: true };
  } catch (err) {
    console.error('[email] conferência do servidor de e-mail falhou:', err.message);
    return { conferido: true, erro: err.message };
  }
}

module.exports = { conferirSeVencida, INTERVALO_MINUTOS };

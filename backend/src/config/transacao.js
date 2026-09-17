const pool = require('./db');

// Executa `executar` dentro de uma transação, entregando o client para que
// todas as queries usem a mesma conexão. Sem isso, operações compostas
// (gravar chamado + histórico + notificação) podem falhar no meio e deixar
// registros órfãos — o histórico é auditoria, não pode divergir do chamado.
async function transacao(executar) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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

module.exports = { transacao };

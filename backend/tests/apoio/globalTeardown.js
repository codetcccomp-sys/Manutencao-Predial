/**
 * Roda uma vez, depois de todas as suítes: devolve o banco ao tamanho em que
 * estava (ver limpeza.js para o porquê).
 *
 * Uma limpeza que falha não derruba o resultado dos testes — eles já
 * terminaram, e o que importa foi dito. Mas falha em voz alta: o aviso diz o
 * que aconteceu, para ninguém descobrir meses depois, pelo teto da exportação,
 * que a limpeza parou de funcionar.
 */
require('dotenv').config();

module.exports = async function limparDepoisDosTestes() {
  const { limparChamadosDeTeste, limparUsuariosDeTeste, recusarSeNaoForBancoDeTeste } = require('./limpeza');

  // Recusa fora do try: apontar a suíte para o banco real é erro de quem
  // rodou, e merece parar o processo, não virar um aviso no meio do relatório.
  recusarSeNaoForBancoDeTeste();

  const pool = require('../../src/config/db');
  let client;
  try {
    // A conexão dentro do try: com o banco fora do ar, os testes já acusaram
    // o problema, e a limpeza não deve somar um erro de infraestrutura do
    // Jest por cima do relatório.
    client = await pool.connect();
    const removidos = await limparChamadosDeTeste(client);
    // Depois dos chamados: só então as contas que os abriram ficam livres.
    const contas = await limparUsuariosDeTeste(client);
    console.log(`\n[limpeza] ${removidos} chamados e ${contas} contas de teste removidos.`);
  } catch (err) {
    console.warn(`\n[limpeza] FALHOU, o banco de teste não foi limpo: ${err.message}`);
  } finally {
    if (client) client.release();
    await pool.end();
  }
};

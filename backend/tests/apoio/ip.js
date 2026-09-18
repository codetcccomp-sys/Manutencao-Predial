const path = require('path');
const crypto = require('crypto');

/**
 * Identificador de cliente distinto por arquivo de teste e por execução.
 *
 * O limite por IP do login (20 falhas em 15 minutos) é global e vive no banco,
 * e a janela é maior que o tempo de um run. Isso cria dois problemas, e cada
 * parte do valor resolve um:
 *
 *   * o trecho derivado do nome do arquivo separa as suítes entre si. O Jest
 *     as roda em paralelo contra o mesmo banco e todas saem do mesmo loopback,
 *     então as falhas que a suíte de rate limiting provoca de propósito
 *     estouravam a cota compartilhada e bloqueavam o login legítimo das
 *     vizinhas;
 *
 *   * o trecho aleatório separa uma execução da seguinte. Sem ele, rodar a
 *     suíte duas ou três vezes dentro da mesma janela de 15 minutos somava as
 *     falhas de todas as execuções no mesmo contador, e o run começava a
 *     falhar no login — não por regressão, mas por ter rodado antes.
 *
 * O campo `ip` é texto: guarda o que `ipDoCliente` devolve, e nada exige que
 * seja um endereço válido. Tratar cada suíte como um cliente diferente é o que
 * ela de fato é, e o limite por e-mail continua valendo normalmente, que é a
 * defesa que importa.
 */
const EXECUCAO = crypto.randomBytes(4).toString('hex');

function ipDaSuite(caminho) {
  const nome = path.basename(caminho, '.test.js');
  const [a, b] = crypto.createHash('sha256').update(nome).digest();
  return `teste-${nome}-${a}.${b}-${EXECUCAO}`;
}

module.exports = { ipDaSuite };

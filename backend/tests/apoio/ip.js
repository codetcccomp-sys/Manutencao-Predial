const path = require('path');
const crypto = require('crypto');

/**
 * Um IP fixo e distinto por arquivo de teste.
 *
 * O limite por IP do login (20 falhas em 15 minutos) é global e vive no banco.
 * O Jest roda as suítes em paralelo contra o mesmo banco e todas saem do mesmo
 * loopback, então as falhas que a suíte de rate limiting provoca de propósito
 * estouravam a cota compartilhada e bloqueavam o login legítimo de outra
 * suíte — e o run falhava em um teste diferente a cada execução.
 *
 * Tratar cada suíte como um cliente diferente é o que ela de fato é. O limite
 * por e-mail continua valendo normalmente, que é a defesa que importa.
 */
function ipDaSuite(caminho) {
  const nome = path.basename(caminho);
  const [a, b, c] = crypto.createHash('sha256').update(nome).digest();
  return `10.${a}.${b}.${c}`;
}

module.exports = { ipDaSuite };

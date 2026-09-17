const crypto = require('crypto');

function gerarProtocolo() {
  const agora = new Date();
  const data = [
    agora.getFullYear(),
    String(agora.getMonth() + 1).padStart(2, '0'),
    String(agora.getDate()).padStart(2, '0'),
  ].join('');
  const sufixo = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `SMP-${data}-${sufixo}`;
}

module.exports = { gerarProtocolo };

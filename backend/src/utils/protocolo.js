const crypto = require('crypto');
const { FUSO } = require('../config/fuso');

/**
 * SMP-AAAAMMDD-XXXXXX, com a data do dia em que o chamado nasceu NO FUSO da
 * instituição.
 *
 * Antes usava `getFullYear/getMonth/getDate`, que leem o relógio do servidor, e o
 * servidor roda em UTC. Das 21h à meia-noite em Brasília já é o dia seguinte em
 * UTC: um chamado aberto às 22h de 31/12 saía com o protocolo do ano novo. É o
 * mesmo defeito que o resto do sistema já corrigiu para filtros e relatórios
 * ("dia é dia de Brasília"), num lugar que a regra não tinha alcançado.
 *
 * `agora` existe para o teste fixar o relógio; em produção é sempre o instante atual.
 */
function gerarProtocolo(agora = new Date()) {
  // en-CA formata como AAAA-MM-DD, que só precisa perder os hífens.
  const data = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(agora)
    .replaceAll('-', '');
  const sufixo = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `SMP-${data}-${sufixo}`;
}

module.exports = { gerarProtocolo };

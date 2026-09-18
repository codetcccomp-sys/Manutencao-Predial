const crypto = require('crypto');
const { AppError } = require('./errorHandler');

/**
 * Autentica o agendador externo.
 *
 * A rota de tarefas não tem usuário: quem chama é um cron de fora, sem
 * sessão e sem JWT. O que a protege é um segredo compartilhado, e há três
 * cuidados que não são óbvios:
 *
 * 1. Sem CRON_SECRET definido, a rota recusa em vez de liberar. Falhar
 *    fechado é o que impede que esquecer a variável num ambiente novo deixe
 *    um gatilho de trabalho aberto para a internet inteira.
 *
 * 2. O segredo vem no cabeçalho Authorization, nunca na query string. URL
 *    aparece em log de acesso, em histórico de proxy e no cabeçalho Referer
 *    de qualquer recurso que a página carregue depois — um segredo que
 *    trafega na URL é um segredo que vaza sozinho, sem ninguém atacar nada.
 *
 * 3. A comparação é em tempo constante. `===` em string sai no primeiro byte
 *    diferente, e a diferença de tempo entre "errou no primeiro caractere" e
 *    "errou no último" é medível pela rede com repetição suficiente: dá para
 *    descobrir o segredo caractere a caractere. timingSafeEqual sempre
 *    percorre tudo.
 */
function conferirSegredo(recebido, esperado) {
  const a = Buffer.from(String(recebido));
  const b = Buffer.from(String(esperado));

  // timingSafeEqual exige o mesmo tamanho, e o próprio tamanho já vazaria
  // pela exceção. Compara-se o digest, que tem tamanho fixo qualquer que
  // seja a entrada.
  const da = crypto.createHash('sha256').update(a).digest();
  const db = crypto.createHash('sha256').update(b).digest();

  return crypto.timingSafeEqual(da, db);
}

function autenticarAgendador(req, res, next) {
  const esperado = process.env.CRON_SECRET;

  if (!esperado) {
    console.error('[cron] CRON_SECRET não definido; a rota de tarefas está desligada.');
    return next(
      new AppError('Tarefas agendadas não estão configuradas neste ambiente.', 503, 'CRON_SEM_SEGREDO')
    );
  }

  const cabecalho = req.headers.authorization || '';
  const recebido = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';

  if (!recebido || !conferirSegredo(recebido, esperado)) {
    return next(new AppError('Segredo do agendador inválido.', 401, 'CRON_NAO_AUTORIZADO'));
  }

  next();
}

module.exports = { autenticarAgendador, conferirSegredo };

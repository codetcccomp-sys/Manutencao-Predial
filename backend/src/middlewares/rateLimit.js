const pool = require('../config/db');
const { AppError } = require('./errorHandler');

const JANELA_MINUTOS = 15;
const MAX_FALHAS_POR_EMAIL = 5;
const MAX_FALHAS_POR_IP = 20;
const RETENCAO_HORAS = 24;

// Probabilidade de rodar a limpeza numa requisição qualquer. Sem um agendador
// no plano serverless, a alternativa seria deixar a tabela crescer para sempre.
const CHANCE_LIMPEZA = 0.02;

/**
 * IP do cliente atrás do proxy da Vercel.
 *
 * x-forwarded-for é propositalmente ignorado: o cliente pode enviá-lo, e
 * confiar nele deixaria o limite por IP contornável com um header por
 * requisição. x-vercel-forwarded-for e x-real-ip são escritos pela borda da
 * Vercel e sobrescrevem o que vier do cliente.
 *
 * Fora da Vercel (desenvolvimento, testes) cai no IP do socket. Note que o
 * limite por IP é sempre a defesa secundária: a que segura ataque de senha
 * contra uma conta é a contagem por e-mail, que o cliente não controla.
 */
function ipDoCliente(req) {
  const daBorda = req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'];
  if (typeof daBorda === 'string' && daBorda.trim()) {
    return daBorda.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'desconhecido';
}

async function limparAntigas() {
  try {
    await pool.query(`DELETE FROM tentativa_login WHERE data < now() - interval '${RETENCAO_HORAS} hours'`);
  } catch (err) {
    // Limpeza é manutenção, não parte do pedido: falhar aqui não pode
    // derrubar um login que, de resto, está correto.
    console.error('[rateLimit] falha ao limpar tentativas antigas:', err.message);
  }
}

/**
 * Barra o pedido antes do bcrypt.
 *
 * A ordem importa: bcrypt com 10 rounds é a parte cara do login, e é
 * justamente o que um ataque de volume quer consumir. Checar o limite
 * primeiro faz a tentativa excedente custar uma query indexada em vez de
 * uma derivação de chave.
 */
async function limitarLogin(req, res, next) {
  const email = String(req.body?.email || '').toLowerCase();
  const ip = ipDoCliente(req);

  try {
    const { rows } = await pool.query(
      `SELECT
         count(*)  FILTER (WHERE email = $1) AS por_email,
         count(*)  FILTER (WHERE ip = $2)    AS por_ip,
         min(data) FILTER (WHERE email = $1) AS antiga_email,
         min(data) FILTER (WHERE ip = $2)    AS antiga_ip
       FROM tentativa_login
       WHERE NOT sucesso
         AND data > now() - interval '${JANELA_MINUTOS} minutes'
         AND (email = $1 OR ip = $2)`,
      [email, ip]
    );

    const porEmail = Number(rows[0].por_email);
    const porIp = Number(rows[0].por_ip);
    const estourouEmail = porEmail >= MAX_FALHAS_POR_EMAIL;
    const estourouIp = porIp >= MAX_FALHAS_POR_IP;

    if (estourouEmail || estourouIp) {
      // A janela só libera uma vaga quando a falha mais antiga daquela
      // dimensão expira — usar a mais antiga das duas daria um Retry-After
      // otimista quando só uma delas estourou.
      const maisAntiga = estourouEmail ? rows[0].antiga_email : rows[0].antiga_ip;
      const liberaEm = new Date(new Date(maisAntiga).getTime() + JANELA_MINUTOS * 60_000);
      const segundos = Math.max(1, Math.ceil((liberaEm - Date.now()) / 1000));

      res.set('Retry-After', String(segundos));
      return next(
        new AppError(
          `Muitas tentativas de login. Tente novamente em ${Math.ceil(segundos / 60)} minuto(s).`,
          429,
          'MUITAS_TENTATIVAS'
        )
      );
    }
  } catch (err) {
    // Se a checagem falhar (banco fora do ar, por exemplo), o login segue e
    // falha por conta própria. Bloquear todo mundo porque o contador está
    // indisponível transformaria um problema de infraestrutura em indisponibilidade.
    console.error('[rateLimit] falha ao verificar limite:', err.message);
  }

  if (Math.random() < CHANCE_LIMPEZA) limparAntigas();
  next();
}

/**
 * Registra o desfecho da tentativa. Um login bem-sucedido apaga as falhas
 * anteriores daquele e-mail: sem isso, alguém que errou a senha quatro vezes,
 * acertou e saiu ficaria a um engano de ser bloqueado.
 */
async function registrarTentativa(email, ip, sucesso) {
  const normalizado = String(email || '').toLowerCase();
  try {
    await pool.query('INSERT INTO tentativa_login (email, ip, sucesso) VALUES ($1, $2, $3)', [
      normalizado,
      ip,
      sucesso,
    ]);
    if (sucesso) {
      await pool.query('DELETE FROM tentativa_login WHERE email = $1 AND NOT sucesso', [normalizado]);
    }
  } catch (err) {
    console.error('[rateLimit] falha ao registrar tentativa:', err.message);
  }
}

module.exports = {
  limitarLogin,
  registrarTentativa,
  ipDoCliente,
  LIMITES: { JANELA_MINUTOS, MAX_FALHAS_POR_EMAIL, MAX_FALHAS_POR_IP },
};

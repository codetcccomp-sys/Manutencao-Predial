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

// Teto do pedido de recuperação de senha.
//
// Dois números, porque são dois riscos diferentes e um não cobre o outro.
//
// O teto por IP segura o script casual. Sozinho ele não protege a cota: IP se
// troca. Está generoso de propósito — um prédio inteiro sai por um IP só,
// então o limite tem de caber num dia ruim de segunda-feira sem barrar
// ninguém. Quinze pedidos por hora vindos do mesmo endereço já é estranho
// para doze contas cadastradas.
const MAX_PEDIDOS_POR_IP = 15;
const JANELA_RECUPERACAO_MINUTOS = 60;

// O teto diário é o que de fato protege a cota, porque vale para todos os IPs
// somados. Cem envios de recuperação por dia é folgado para o piloto e deixa
// quatrocentos da cota do Gmail para o que o sistema precisa mandar sozinho:
// o aviso de atraso, a notificação de chamado designado.
//
// Estourar este teto para a recuperação de senha e não para o resto é
// deliberado: quem não consegue redefinir a senha tem saída — um
// administrador redefine — e o aviso de atraso não tem nenhuma.
const MAX_ENVIOS_POR_DIA = 100;

async function limparRecuperacoesAntigas() {
  try {
    await pool.query(
      `DELETE FROM tentativa_recuperacao WHERE criado_em < now() - interval '${RETENCAO_HORAS} hours'`
    );
  } catch (err) {
    console.error('[rateLimit] falha ao limpar tentativas de recuperação:', err.message);
  }
}

/**
 * Barra o pedido de recuperação antes de qualquer trabalho.
 *
 * O registro do pedido vem ANTES da checagem, e não depois: contar só o que
 * passa faria o próprio teto liberar uma vaga a cada recusa, e o limite nunca
 * fecharia. Registrar sempre também é o que impede o contador de virar
 * oráculo — ele não distingue e-mail cadastrado de e-mail inventado.
 */
async function limitarRecuperacao(req, res, next) {
  const ip = ipDoCliente(req);

  try {
    await pool.query('INSERT INTO tentativa_recuperacao (ip) VALUES ($1)', [ip]);

    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*) FROM tentativa_recuperacao
           WHERE ip = $1
             AND criado_em > now() - interval '${JANELA_RECUPERACAO_MINUTOS} minutes') AS por_ip,
         (SELECT count(*) FROM recuperacao_senha
           WHERE criado_em > now() - interval '24 hours')                              AS envios_hoje`,
      [ip]
    );

    const porIp = Number(rows[0].por_ip);
    const enviosHoje = Number(rows[0].envios_hoje);

    if (porIp > MAX_PEDIDOS_POR_IP || enviosHoje >= MAX_ENVIOS_POR_DIA) {
      // A mensagem é a mesma nos dois casos, e não diz qual teto estourou:
      // "o limite do sistema acabou" contaria a quem tentou que o ataque
      // funcionou, e daria a ele o retorno que falta para calibrar o próximo.
      return next(
        new AppError(
          'Muitos pedidos de recuperação de senha. Tente novamente mais tarde ou ' +
            'peça a um administrador para redefinir sua senha.',
          429,
          'MUITOS_PEDIDOS'
        )
      );
    }
  } catch (err) {
    // Mesma escolha do login: contador indisponível não pode virar
    // indisponibilidade do sistema.
    console.error('[rateLimit] falha ao verificar limite de recuperação:', err.message);
  }

  if (Math.random() < CHANCE_LIMPEZA) limparRecuperacoesAntigas();
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
  limitarRecuperacao,
  registrarTentativa,
  ipDoCliente,
  LIMITES: {
    JANELA_MINUTOS,
    MAX_FALHAS_POR_EMAIL,
    MAX_FALHAS_POR_IP,
    MAX_PEDIDOS_POR_IP,
    JANELA_RECUPERACAO_MINUTOS,
    MAX_ENVIOS_POR_DIA,
  },
};

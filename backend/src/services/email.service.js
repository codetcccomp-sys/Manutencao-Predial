const nodemailer = require('nodemailer');

// Timeouts curtos e explícitos. O envio acontece dentro da requisição, e em
// função serverless não há processo que sobreviva para terminar depois: um
// SMTP que não responde não pode segurar a resposta da API indefinidamente.
const TIMEOUT_MS = 5000;

let transporte;

function estaConfigurado() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT);
}

function obterTransporte() {
  if (transporte) return transporte;

  const porta = Number(process.env.SMTP_PORT);
  transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: porta,
    // 465 é TLS implícito; as demais portas começam em claro e sobem para
    // TLS via STARTTLS.
    secure: porta === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });

  return transporte;
}

/**
 * Envia um e-mail e diz se conseguiu.
 *
 * Sem SMTP configurado vira um registro em log, não um erro: o sistema
 * funciona inteiro sem e-mail, e derrubar a atribuição de um chamado porque
 * o aviso não saiu seria trocar um problema pequeno por um grande. Quem
 * chama nunca precisa tratar exceção daqui.
 */
async function enviar({ para, assunto, texto }) {
  if (!estaConfigurado()) {
    console.info(`[email] SMTP não configurado; não enviado para ${para}: ${assunto}`);
    return false;
  }

  try {
    await obterTransporte().sendMail({
      from: process.env.EMAIL_REMETENTE || process.env.SMTP_USER,
      to: para,
      subject: assunto,
      text: texto,
    });
    return true;
  } catch (err) {
    console.error(`[email] falha ao enviar para ${para}:`, err.message);
    return false;
  }
}

module.exports = { enviar, estaConfigurado };

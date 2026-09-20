const nodemailer = require('nodemailer');

// Timeouts curtos e explícitos. O envio acontece dentro da requisição, e em
// função serverless não há processo que sobreviva para terminar depois: um
// SMTP que não responde não pode segurar a resposta da API indefinidamente.
const TIMEOUT_MS = 5000;

let transporte;

function estaConfigurado() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT);
}

// Uma senha de app do Google tem 16 letras e é EXIBIDA em quatro blocos de
// quatro. Quem copia da tela leva os espaços junto.
const SENHA_DE_APP_COM_ESPACOS = /^[a-z]{4}( [a-z]{4}){3}$/;

/**
 * Limpa a senha antes de mandá-la ao servidor.
 *
 * Duas correções, e as duas existem porque o erro que elas evitam é
 * indistinguível a olho nu. O Gmail responde `535 BadCredentials` — a mesma
 * mensagem de senha errada — então quem cadastrou a senha certa com um espaço
 * invisível no fim procura o problema na conta do Google, não no campo.
 *
 * 1. Apara as pontas. Um `\n` que veio junto do copiar e colar não se vê em
 *    campo de senha nenhum, e a Vercel guarda o valor exatamente como chegou.
 * 2. Tira os espaços internos SÓ quando o valor tem a cara de uma senha de
 *    app do Google. Senha de verdade pode conter espaço, e apagá-los sempre
 *    quebraria quem usa outro provedor com uma frase-senha.
 */
function senhaLimpa(bruta) {
  const aparada = String(bruta ?? '').trim();
  return SENHA_DE_APP_COM_ESPACOS.test(aparada) ? aparada.replace(/ /g, '') : aparada;
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
      ? { user: String(process.env.SMTP_USER).trim(), pass: senhaLimpa(process.env.SMTP_PASSWORD) }
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

module.exports = { enviar, estaConfigurado, senhaLimpa };

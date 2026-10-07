const crypto = require('crypto');

/**
 * TOTP (RFC 6238): o código de seis dígitos que muda a cada 30 segundos no
 * aplicativo autenticador (Google Authenticator, Microsoft Authenticator,
 * Aegis, o do gerenciador de senhas).
 *
 * Implementado aqui, sem biblioteca: são vinte linhas de HMAC sobre o relógio,
 * e uma dependência a menos na parte que guarda a porta. O teste confere
 * contra os vetores do próprio RFC.
 */

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASSO_SEGUNDOS = 30;
const DIGITOS = 6;

function base32(buffer) {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const byte of buffer) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

function deBase32(texto) {
  const limpo = String(texto).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let valor = 0;
  const bytes = [];
  for (const caractere of limpo) {
    const indice = ALFABETO.indexOf(caractere);
    if (indice < 0) throw new Error('segredo TOTP com caractere fora do base32');
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 20 bytes aleatórios (160 bits), o tamanho que o RFC 4226 recomenda. */
function gerarSegredo() {
  return base32(crypto.randomBytes(20));
}

function passoDe(instanteMs) {
  return Math.floor(instanteMs / 1000 / PASSO_SEGUNDOS);
}

function codigoNoPasso(segredo, passo, digitos = DIGITOS) {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const hmac = crypto.createHmac('sha1', deBase32(segredo)).update(contador).digest();
  const deslocamento = hmac[hmac.length - 1] & 0x0f;
  const binario = hmac.readUInt32BE(deslocamento) & 0x7fffffff;
  return String(binario % 10 ** digitos).padStart(digitos, '0');
}

/**
 * Confere o código e devolve o passo em que ele bateu (ou null).
 *
 * Aceita um passo para trás e um para frente: o relógio do celular raramente
 * está no segundo certo, e quem digita o código no fim da janela de 30 s
 * chega ao servidor já na seguinte. Devolver o passo é o que permite a quem
 * chama recusar o mesmo código usado duas vezes (ver auth.service).
 *
 * A comparação é em tempo constante, como a do segredo do agendador.
 */
function verificar(segredo, codigo, instanteMs = Date.now(), janela = 1) {
  const digitado = String(codigo ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(digitado)) return null;
  const atual = passoDe(instanteMs);
  for (let d = -janela; d <= janela; d++) {
    const esperado = codigoNoPasso(segredo, atual + d);
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(digitado))) return atual + d;
  }
  return null;
}

/**
 * O endereço `otpauth://` que o aplicativo lê pelo QR Code. O emissor vai no
 * rótulo e no parâmetro, como a especificação do Google Authenticator pede,
 * para a conta aparecer como "Conserva Predial (fulano@...)" e não como um
 * e-mail solto no meio de outras contas.
 */
function enderecoOtpauth(segredo, conta, emissor) {
  const rotulo = encodeURIComponent(`${emissor}:${conta}`);
  const parametros = new URLSearchParams({
    secret: segredo,
    issuer: emissor,
    algorithm: 'SHA1',
    digits: String(DIGITOS),
    period: String(PASSO_SEGUNDOS),
  });
  return `otpauth://totp/${rotulo}?${parametros}`;
}

module.exports = { gerarSegredo, verificar, codigoNoPasso, passoDe, enderecoOtpauth, base32, deBase32 };

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Entrar com Google: a conferência da credencial que o botão do Google
 * entrega à tela.
 *
 * A credencial é um JWT assinado pelo Google (RS256). Ela só vale aqui se:
 *
 * - a assinatura confere com uma das chaves públicas do Google;
 * - foi emitida para ESTE sistema (`aud` = GOOGLE_CLIENT_ID): uma credencial
 *   que outro site recebeu do mesmo usuário não entra aqui;
 * - o emissor é o Google e ela não venceu (dura cerca de uma hora);
 * - o Google responde pelo e-mail. Não basta `email_verified`: numa conta
 *   Google criada com e-mail de outro provedor, o Google conferiu o e-mail
 *   uma vez, mas não é dono dele. Só é dono no Gmail e nas contas de
 *   organização (`hd`). Como o e-mail é o que liga a credencial a uma conta
 *   existente, aceitar o caso fraco deixaria alguém entrar na conta de outra
 *   pessoa pelo e-mail antigo dela.
 *
 * Com GOOGLE_DOMINIO definido (o domínio da instituição), só contas daquela
 * organização entram por aqui: é o login institucional (SSO) que o relatório
 * pediu, sem código a mais quando a instituição liberar o domínio.
 *
 * Sem dependência nova: as chaves vêm no formato JWK, que o `crypto` do Node
 * lê direto, e o `jsonwebtoken` já do projeto confere a assinatura.
 */

const ENDERECO_CHAVES = 'https://www.googleapis.com/oauth2/v3/certs';
const EMISSORES = ['accounts.google.com', 'https://accounts.google.com'];
const DOMINIOS_DO_GMAIL = ['gmail.com', 'googlemail.com'];

// Uma chave desconhecida pode ser rotação do Google (busca de novo) ou
// credencial inventada (não deve virar uma busca por requisição). Uma busca
// extra por minuto separa os dois casos.
const INTERVALO_MINIMO_MS = 60_000;
const VALIDADE_PADRAO_MS = 60 * 60_000;

let cache = { chaves: {}, expira: 0, buscadaEm: 0 };

const clienteId = () => String(process.env.GOOGLE_CLIENT_ID || '').trim() || null;
const dominioExigido = () => String(process.env.GOOGLE_DOMINIO || '').trim().toLowerCase() || null;

/** As chaves públicas do Google, por `kid`, e por quanto tempo valem. */
async function buscarChaves() {
  const resposta = await fetch(ENDERECO_CHAVES);
  if (!resposta.ok) throw new Error(`chaves do Google: HTTP ${resposta.status}`);
  const { keys } = await resposta.json();
  const maxAge = /max-age=(\d+)/.exec(resposta.headers.get('cache-control') || '')?.[1];
  return {
    chaves: Object.fromEntries(keys.map((k) => [k.kid, k])),
    validadeMs: maxAge ? Number(maxAge) * 1000 : VALIDADE_PADRAO_MS,
  };
}

async function chavePublica(kid) {
  const agora = Date.now();
  const vencido = agora >= cache.expira;
  const desconhecida = !cache.chaves[kid] && agora - cache.buscadaEm >= INTERVALO_MINIMO_MS;
  if (vencido || desconhecida) {
    try {
      const { chaves, validadeMs } = await google.buscarChaves();
      cache = { chaves, expira: agora + validadeMs, buscadaEm: agora };
    } catch (err) {
      // Sem as chaves, não há como conferir: recusa, mas como falha do
      // servidor, não como credencial inválida de quem tentou.
      console.error('[google] não foi possível buscar as chaves públicas:', err.message);
      throw new AppError('Não foi possível falar com o Google agora. Tente de novo.', 503, 'GOOGLE_INDISPONIVEL');
    }
  }
  const jwk = cache.chaves[kid];
  return jwk ? crypto.createPublicKey({ key: jwk, format: 'jwk' }) : null;
}

const recusa = () =>
  new AppError('Não foi possível confirmar o login com o Google. Tente de novo.', 401, 'CREDENCIAL_GOOGLE_INVALIDA');

/**
 * Confere a credencial e devolve quem é: `{ email, nome }`.
 */
async function conferir(credencial) {
  const aud = clienteId();
  if (!aud) {
    throw new AppError('O login com Google não está ligado nesta instalação.', 404, 'GOOGLE_DESLIGADO');
  }

  const cabecalho = jwt.decode(String(credencial || ''), { complete: true })?.header;
  if (!cabecalho?.kid || cabecalho.alg !== 'RS256') throw recusa();

  const chave = await chavePublica(cabecalho.kid);
  if (!chave) throw recusa();

  let dados;
  try {
    dados = jwt.verify(credencial, chave, { algorithms: ['RS256'], audience: aud, issuer: EMISSORES });
  } catch {
    throw recusa();
  }

  const email = String(dados.email || '').trim().toLowerCase();
  const dominio = email.split('@')[1] || '';
  const organizacao = String(dados.hd || '').toLowerCase() || null;

  const exigido = dominioExigido();
  if (exigido && organizacao !== exigido) {
    throw new AppError(
      `Entre com a conta Google da instituição (@${exigido}).`,
      403,
      'GOOGLE_DOMINIO_NAO_PERMITIDO'
    );
  }

  const googleResponde = dados.email_verified === true && (DOMINIOS_DO_GMAIL.includes(dominio) || organizacao !== null);
  if (!email || !googleResponde) {
    throw new AppError(
      'O Google não confirma este e-mail como seu. Entre com e-mail e senha.',
      401,
      'GOOGLE_EMAIL_NAO_CONFIRMADO'
    );
  }

  return { email, nome: String(dados.name || '').trim() || email.split('@')[0] };
}

// Chamadas internas passam por este objeto: é o que deixa o teste trocar a
// busca das chaves por chaves dele, sem rede.
const google = { clienteId, conferir, buscarChaves, esquecerChaves: () => (cache = { chaves: {}, expira: 0, buscadaEm: 0 }) };

module.exports = google;

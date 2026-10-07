const jwt = require('jsonwebtoken');
const pool = require('../config/db');

/**
 * A sessão: o token, onde ele viaja e como é revogado.
 *
 * O token ia para o localStorage do navegador, onde qualquer script da página
 * o lê — um XSS levaria a sessão inteira embora, para ser usada de outro
 * lugar por 8 horas. Agora ele vai também num cookie HttpOnly, que script
 * nenhum lê, e a tela deixou de guardá-lo.
 *
 * O cabeçalho `Authorization: Bearer` continua valendo: é como os testes, o
 * e2e e qualquer cliente que não seja o navegador falam com a API.
 *
 * Cookie traz um risco que o cabeçalho não tinha: o navegador o manda sozinho,
 * inclusive numa requisição montada por outro site (CSRF). Duas travas:
 * `SameSite=Strict`, que já impede o envio a partir de outro site, e a
 * exigência de um cabeçalho próprio (`X-Conserva`) em toda escrita
 * autenticada por cookie — um formulário de outro site não consegue mandar
 * cabeçalho, e um `fetch` de outra origem com cabeçalho próprio precisaria
 * passar pelo CORS, que recusa.
 */

const NOME_COOKIE = 'conserva_sessao';
const CABECALHO_CSRF = 'x-conserva';
const DURACAO = process.env.JWT_EXPIRES_IN || '8h';

function duracaoEmMs(texto) {
  const m = /^(\d+)\s*([smhd])?$/.exec(String(texto));
  if (!m) return 8 * 3_600_000;
  const n = Number(m[1]);
  return n * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] || 's'];
}

function opcoesDoCookie(req) {
  return {
    httpOnly: true,
    // Atrás da Vercel, `req.secure` vem do X-Forwarded-Proto (trust proxy
    // ligado em app.js). Em desenvolvimento, por http, o cookie sem Secure é
    // o único que o navegador guarda.
    secure: req.secure,
    sameSite: 'strict',
    path: '/',
  };
}

/** Emite o token da sessão, grava o cookie e devolve o token. */
function emitir(res, req, usuario) {
  const token = jwt.sign({ id: usuario.id, sv: usuario.sessao_versao ?? 0 }, process.env.JWT_SECRET, {
    expiresIn: DURACAO,
  });
  res.cookie(NOME_COOKIE, token, { ...opcoesDoCookie(req), maxAge: duracaoEmMs(DURACAO) });
  return token;
}

function encerrar(res, req) {
  res.clearCookie(NOME_COOKIE, opcoesDoCookie(req));
}

/** Lê o cookie da sessão do cabeçalho, sem dependência para isso. */
function lerCookie(req) {
  const cabecalho = req.headers.cookie;
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(';')) {
    const [nome, ...resto] = parte.trim().split('=');
    if (nome === NOME_COOKIE) return decodeURIComponent(resto.join('='));
  }
  return null;
}

/**
 * De onde veio o token desta requisição. O cabeçalho tem precedência: um
 * cliente que manda os dois está dizendo explicitamente quem é.
 */
function tokenDa(req) {
  const autorizacao = req.headers.authorization || '';
  if (autorizacao.startsWith('Bearer ')) return { token: autorizacao.slice(7), origem: 'cabecalho' };
  const doCookie = lerCookie(req);
  if (doCookie) return { token: doCookie, origem: 'cookie' };
  return null;
}

/**
 * A sessão reemitida (ligar ou desligar o 2FA sobe a versão) volta no corpo
 * só para quem já se autentica pelo cabeçalho e, portanto, já guarda o token
 * fora do cookie. Para o navegador, o cookie novo basta — e devolver o token
 * no corpo entregaria a sessão a um script injetado na página, que é
 * exatamente o que o cookie HttpOnly existe para impedir.
 */
function tokenNoCorpo(req, token) {
  return req.origemDaSessao === 'cabecalho' ? { token } : {};
}

const METODOS_SEGUROS = ['GET', 'HEAD', 'OPTIONS'];

function exigeCabecalhoCsrf(req, origem) {
  return origem === 'cookie' && !METODOS_SEGUROS.includes(req.method) && req.headers[CABECALHO_CSRF] !== '1';
}

/** Derruba todas as sessões abertas da pessoa (troca de senha, "sair de todos"). */
async function revogarTodas(usuarioId, client = pool) {
  const { rows } = await client.query(
    'UPDATE usuario SET sessao_versao = sessao_versao + 1 WHERE id = $1 RETURNING sessao_versao',
    [usuarioId]
  );
  return rows[0]?.sessao_versao;
}

module.exports = {
  NOME_COOKIE,
  emitir,
  encerrar,
  tokenDa,
  tokenNoCorpo,
  exigeCabecalhoCsrf,
  revogarTodas,
  duracaoEmMs,
};

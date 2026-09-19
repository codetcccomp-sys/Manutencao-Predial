const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { transacao } = require('../config/transacao');
const { AppError } = require('../middlewares/errorHandler');
const { normalizarEmail } = require('./auth.service');
const email = require('./email.service');
const { ASSINATURA } = require('../config/marca');

const VALIDADE_MINUTOS = 60;
const SALT_ROUNDS = 10;

// Tokens pendentes por usuário. Pedir de novo é comum (o e-mail demora, a
// pessoa clica duas vezes); pedir dez vezes em sequência não é.
const MAX_PENDENTES = 3;

function gerarToken() {
  return crypto.randomBytes(32).toString('hex');
}

// SHA-256 e não bcrypt: o token já tem 256 bits de entropia aleatória, então
// não há o que um hash lento proteja — e a validação precisa ser uma busca
// indexada por igualdade, não uma varredura comparando linha a linha.
function hashDoToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Registra um pedido de recuperação e devolve o token, se houver conta.
 *
 * Nunca revela se o e-mail existe: quem chama recebe sempre a mesma resposta.
 * Um endpoint que respondesse "e-mail não cadastrado" seria uma lista de
 * usuários aberta à internet — a mesma enumeração que o login já evita.
 */
async function solicitar(emailInformado, ip) {
  const emailNormalizado = normalizarEmail(emailInformado);

  const { rows } = await pool.query(
    'SELECT id, nome, email, ativo FROM usuario WHERE email = $1',
    [emailNormalizado]
  );
  const usuario = rows[0];

  // Conta inativa também não gera token: reativar é decisão de um
  // administrador, não consequência de um clique em "esqueci minha senha".
  if (!usuario || !usuario.ativo) return null;

  const pendentes = await pool.query(
    `SELECT count(*)::int AS total FROM recuperacao_senha
      WHERE usuario_id = $1 AND usado_em IS NULL AND expira_em > now()`,
    [usuario.id]
  );
  if (pendentes.rows[0].total >= MAX_PENDENTES) return null;

  const token = gerarToken();
  await pool.query(
    `INSERT INTO recuperacao_senha (usuario_id, token_hash, expira_em, ip)
     VALUES ($1, $2, now() + ($3 * interval '1 minute'), $4)`,
    [usuario.id, hashDoToken(token), VALIDADE_MINUTOS, ip || null]
  );

  return { token, usuario };
}

async function enviarEmail({ token, usuario }, urlBase) {
  const link = `${urlBase}/redefinir-senha?token=${token}`;

  await email.enviar({
    para: usuario.email,
    assunto: `Redefinição de senha — ${ASSINATURA}`,
    texto:
      `Olá, ${usuario.nome}.\n\n` +
      `Recebemos um pedido para redefinir sua senha. O link abaixo vale por ${VALIDADE_MINUTOS} minutos e só pode ser usado uma vez:\n\n` +
      `${link}\n\n` +
      'Se não foi você quem pediu, ignore esta mensagem: sua senha atual continua valendo.\n\n' +
      ASSINATURA,
  });

  return link;
}

/**
 * Troca a senha a partir de um token válido.
 *
 * Tudo numa transação: consumir o token, gravar a senha nova e invalidar os
 * demais pedidos pendentes precisam acontecer juntos. Um token consumido sem
 * a senha ter mudado deixaria a pessoa sem senha nova e sem token.
 */
async function redefinir(token, senhaNova) {
  if (!token || typeof token !== 'string') {
    throw new AppError('Token de redefinição inválido ou expirado.', 400, 'TOKEN_INVALIDO');
  }

  const senhaHash = await bcrypt.hash(senhaNova, SALT_ROUNDS);

  return transacao(async (client) => {
    const { rows } = await client.query(
      `SELECT r.id, r.usuario_id, r.usado_em, r.expira_em, u.ativo
         FROM recuperacao_senha r JOIN usuario u ON u.id = r.usuario_id
        WHERE r.token_hash = $1
        FOR UPDATE OF r`,
      [hashDoToken(token)]
    );

    const pedido = rows[0];

    // Mesma mensagem para inexistente, expirado e já usado: distinguir os
    // casos contaria a quem tentar adivinhar se o token chegou perto.
    if (!pedido || pedido.usado_em || new Date(pedido.expira_em) <= new Date() || !pedido.ativo) {
      throw new AppError('Token de redefinição inválido ou expirado.', 400, 'TOKEN_INVALIDO');
    }

    await client.query('UPDATE usuario SET senha_hash = $1 WHERE id = $2', [
      senhaHash,
      pedido.usuario_id,
    ]);

    await client.query('UPDATE recuperacao_senha SET usado_em = now() WHERE id = $1', [pedido.id]);

    // Os outros pedidos pendentes morrem junto: quem trocou a senha não
    // quer que um link antigo, que pode estar numa caixa de e-mail alheia,
    // continue valendo.
    await client.query(
      `UPDATE recuperacao_senha SET usado_em = now()
        WHERE usuario_id = $1 AND usado_em IS NULL`,
      [pedido.usuario_id]
    );

    // Trocar a senha também limpa o bloqueio por tentativas: quem acabou de
    // provar ser dono da conta não deve continuar barrado por erros antigos.
    await client.query(
      'DELETE FROM tentativa_login WHERE email = (SELECT email FROM usuario WHERE id = $1) AND NOT sucesso',
      [pedido.usuario_id]
    );

    return { usuario_id: pedido.usuario_id };
  });
}

module.exports = { solicitar, enviarEmail, redefinir, VALIDADE_MINUTOS, MAX_PENDENTES };

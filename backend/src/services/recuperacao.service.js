const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { transacao } = require('../config/transacao');
const { AppError } = require('../middlewares/errorHandler');
const { normalizarEmail } = require('./auth.service');
const { validarSenhaNova } = require('../utils/senha');
const email = require('./email.service');
const { ASSINATURA } = require('../config/marca');

const VALIDADE_MINUTOS = 60;
const SALT_ROUNDS = 10;

/**
 * Por quantos dias o pedido de redefinição sobrevive ao próprio token.
 *
 * A linha guarda o IP de quem pediu, e IP é dado pessoal. O token morre em
 * uma hora, mas a linha ficava para sempre: cada "esqueci minha senha"
 * deixava um endereço de rede gravado no banco, sem prazo e sem ninguém para
 * apagá-lo. A tabela de tentativas de login já se limpa sozinha em 24 horas;
 * esta não se limpava nunca.
 *
 * Sete dias, e não zero, porque a linha ainda responde a uma pergunta depois
 * de o token expirar: "alguém tentou redefinir minha senha semana passada?".
 * Passada essa janela ela não serve para mais nada.
 */
const RETENCAO_DIAS = 7;

/**
 * Apaga pedidos que já não servem para nada.
 *
 * Roda junto do próximo pedido, como a limpeza do rate limit: sem agendador
 * próprio, sem uma rota para alguém chamar, e sem custar nada quando não há
 * o que apagar. Falhar aqui não pode derrubar a redefinição de senha de
 * quem está esperando o e-mail — limpeza é manutenção, não parte do pedido.
 */
async function limparPedidosAntigos() {
  try {
    await pool.query(
      `DELETE FROM recuperacao_senha
        WHERE criado_em < now() - ($1 * interval '1 day')`,
      [RETENCAO_DIAS]
    );
  } catch (err) {
    console.error('[recuperacao] falha ao limpar pedidos antigos:', err.message);
  }
}

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

  await limparPedidosAntigos();

  const pendentes = await pool.query(
    `SELECT count(*)::int AS total FROM recuperacao_senha
      WHERE usuario_id = $1 AND usado_em IS NULL AND expira_em > now()`,
    [usuario.id]
  );
  if (pendentes.rows[0].total >= MAX_PENDENTES) return null;

  const token = gerarToken();
  const { rows: criados } = await pool.query(
    `INSERT INTO recuperacao_senha (usuario_id, token_hash, expira_em, ip)
     VALUES ($1, $2, now() + ($3 * interval '1 minute'), $4)
     RETURNING id`,
    [usuario.id, hashDoToken(token), VALIDADE_MINUTOS, ip || null]
  );

  return { token, usuario, pedidoId: criados[0].id };
}

/**
 * Manda o link e, se o envio falhar, descarta o pedido.
 *
 * O descarte é o ponto, e ele vem de um tropeço real: com o SMTP recusando a
 * senha, três cliques em "esqueci minha senha" criaram três pedidos pendentes
 * cujos e-mails nunca saíram. O quarto clique bateu no MAX_PENDENTES e o
 * serviço devolveu `null` — sem token, sem tentativa de envio, sem log. A
 * tela seguia dizendo "enviamos um link", e a pessoa ficava trancada por uma
 * hora esperando um e-mail que nem chegou a ser tentado.
 *
 * O limite existe para conter quem pede dez vezes seguidas, não para punir
 * quem nunca recebeu nada. Um token que ninguém tem em mãos não protege coisa
 * alguma ocupando a vaga: se o envio falhou, o pedido morre junto.
 *
 * Só quando o SMTP ESTÁ configurado, note. Sem servidor de e-mail o envio
 * "falha" por definição, mas aí o controlador registra o link no log e ele é
 * usável — matar o pedido nesse caso quebraria o desenvolvimento e a
 * instalação que ainda não tem e-mail.
 */
async function enviarEmail({ token, usuario, pedidoId }, urlBase) {
  const link = `${urlBase}/redefinir-senha?token=${token}`;

  const enviado = await email.enviar({
    para: usuario.email,
    assunto: `Redefinição de senha — ${ASSINATURA}`,
    texto:
      `Olá, ${usuario.nome}.\n\n` +
      `Recebemos um pedido para redefinir sua senha. O link abaixo vale por ${VALIDADE_MINUTOS} minutos e só pode ser usado uma vez:\n\n` +
      `${link}\n\n` +
      'Se não foi você quem pediu, ignore esta mensagem: sua senha atual continua valendo.\n\n' +
      ASSINATURA,
  });

  if (!enviado && pedidoId && email.estaConfigurado()) {
    await descartar(pedidoId, 'o e-mail não saiu, e ele só ocuparia vaga');
  }

  return link;
}

/**
 * Mata um pedido que não serve para nada.
 *
 * O try/catch não é zelo excessivo: sem ele, uma falha de banco aqui vira 500
 * — e esse 500 só acontece quando a conta EXISTE, porque o caminho todo é
 * pulado quando ela não existe. Quem quisesse descobrir se um e-mail tem
 * cadastro compararia as respostas. É a mesma enumeração que a mensagem
 * uniforme do endpoint existe para impedir, entrando de novo pela porta dos
 * fundos.
 */
async function descartar(pedidoId, motivo = 'não serve mais') {
  if (!pedidoId) return;
  try {
    await pool.query('UPDATE recuperacao_senha SET usado_em = now() WHERE id = $1', [pedidoId]);
    console.error(`[recuperacao] pedido ${pedidoId} descartado: ${motivo}.`);
  } catch (err) {
    console.error(`[recuperacao] falha ao descartar o pedido ${pedidoId}:`, err.message);
  }
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

  validarSenhaNova(senhaNova);

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

    // Senha nova derruba toda sessão aberta. Sem isto, quem tinha roubado a
    // sessão seguia dentro por até 8 horas depois da troca — justamente
    // quando a vítima achava que tinha resolvido.
    await client.query(
      'UPDATE usuario SET senha_hash = $1, sessao_versao = sessao_versao + 1 WHERE id = $2',
      [senhaHash, pedido.usuario_id]
    );

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

module.exports = { solicitar, enviarEmail, redefinir, descartar, VALIDADE_MINUTOS, MAX_PENDENTES };

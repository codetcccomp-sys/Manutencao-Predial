const pool = require('../config/db');
const email = require('./email.service');
const { ASSINATURA } = require('../config/marca');

const ASSUNTO_POR_TIPO = {
  atribuicao: 'Chamado designado a você',
  mudanca_estado: 'Atualização no seu chamado',
  conclusao: 'Chamado concluído',
  atraso: 'Chamado em atraso',
  comentario: 'Novo comentário no chamado',
};

/**
 * Converte em e-mail uma notificação já gravada.
 *
 * Roda depois do COMMIT, de propósito: enquanto a transação está aberta, a
 * notificação ainda pode desaparecer num rollback, e mandar aviso de algo
 * que não aconteceu é pior que não mandar aviso nenhum. Em compensação, o
 * envio não é atômico com o registro — daí email_enviado_em, que diz o que
 * de fato saiu.
 *
 * Nunca lança: o chamado já mudou de estado e a resposta da API não depende
 * do aviso ter saído.
 */
async function despacharEmail(notificacaoId) {
  try {
    const { rows } = await pool.query(
      `SELECT n.id, n.tipo, n.mensagem, u.email, u.nome, c.protocolo
         FROM notificacao n
         JOIN usuario u ON u.id = n.usuario_id
         JOIN chamado c ON c.id = n.chamado_id
        WHERE n.id = $1 AND n.email_enviado_em IS NULL`,
      [notificacaoId]
    );

    const notificacao = rows[0];
    if (!notificacao) return;

    const enviado = await email.enviar({
      para: notificacao.email,
      assunto: `[${notificacao.protocolo}] ${ASSUNTO_POR_TIPO[notificacao.tipo] || 'Atualização'}`,
      texto: `Olá, ${notificacao.nome}.\n\n${notificacao.mensagem}\n\n${ASSINATURA}`,
    });

    if (enviado) {
      await pool.query('UPDATE notificacao SET email_enviado_em = now() WHERE id = $1', [notificacaoId]);
    }
  } catch (err) {
    console.error('[notificacoes] falha ao despachar e-mail:', err.message);
  }
}

/**
 * Teto de envios por requisição.
 *
 * O envio é sequencial e cada um tem timeout de 5 s, então uma notificação
 * que alcance muita gente — um comentário num chamado sem técnico avisa toda
 * a gestão — seguraria a resposta por minutos e estouraria o limite de tempo
 * da função. O aviso em tela não depende do e-mail: o que passa do teto fica
 * registrado com email_enviado_em nulo, visível no sistema, que é o outro
 * canal previsto pela RF08.
 */
const LIMITE_ENVIOS = 40;

async function despacharVarios(ids, limite = LIMITE_ENVIOS) {
  for (const id of ids.filter(Boolean).slice(0, limite)) {
    await despacharEmail(id);
  }
}

// Listagem das notificações do próprio usuário, mais recentes primeiro.
async function listarDoUsuario(usuarioId, { apenasNaoLidas } = {}) {
  const { rows } = await pool.query(
    `SELECT n.id, n.tipo, n.mensagem, n.lida, n.data, c.protocolo, n.chamado_id
       FROM notificacao n JOIN chamado c ON c.id = n.chamado_id
      WHERE n.usuario_id = $1 ${apenasNaoLidas ? 'AND NOT n.lida' : ''}
      ORDER BY n.data DESC
      LIMIT 50`,
    [usuarioId]
  );
  return rows;
}

async function marcarComoLida(notificacaoId, usuarioId) {
  // O usuário no WHERE é o que impede marcar como lida a notificação de
  // outra pessoa só trocando o id na URL.
  const { rows } = await pool.query(
    'UPDATE notificacao SET lida = TRUE WHERE id = $1 AND usuario_id = $2 RETURNING id',
    [notificacaoId, usuarioId]
  );
  return rows.length > 0;
}

module.exports = {
  despacharEmail,
  despacharVarios,
  listarDoUsuario,
  marcarComoLida,
  LIMITE_ENVIOS,
};

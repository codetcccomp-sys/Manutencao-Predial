const pool = require('../config/db');
const { transacao } = require('../config/transacao');
const { AppError } = require('../middlewares/errorHandler');
const chamadosService = require('./chamados.service');
const notificacoesService = require('./notificacoes.service');

const TAMANHO_MINIMO = 2;
const TAMANHO_MAXIMO = 4000;

// Prévia do texto no aviso: o suficiente para decidir se vale abrir agora,
// sem transformar a notificação numa cópia do comentário.
const PREVIA = 140;

/**
 * Lista os comentários do chamado.
 *
 * Quem enxerga o chamado enxerga a conversa dele: a autorização é a mesma da
 * leitura do chamado (solicitante, técnico designado e gestão), e não um
 * controle próprio — dois critérios de visibilidade para o mesmo chamado
 * divergiriam na primeira mudança.
 */
async function listar(chamadoId, usuario) {
  await chamadosService.garantirLeitura(chamadoId, usuario);

  const { rows } = await pool.query(
    `SELECT c.id, c.texto, c.data, c.usuario_id, u.nome AS usuario_nome, u.perfil AS usuario_perfil
       FROM comentario c JOIN usuario u ON u.id = c.usuario_id
      WHERE c.chamado_id = $1
      ORDER BY c.data, c.id`,
    [chamadoId]
  );

  return rows;
}

/**
 * Quem é avisado de um comentário novo.
 *
 * Todo mundo envolvido, menos quem escreveu — ninguém precisa de aviso do
 * próprio texto. Sem técnico designado, a gestão entra no lugar: é ela quem
 * responde pelo chamado enquanto ele não tem dono, e é justamente aí que o
 * comentário do solicitante ficaria sem leitor.
 */
async function destinatarios(client, chamado, autorId) {
  const ids = new Set([chamado.solicitante_id]);

  if (chamado.tecnico_id) {
    ids.add(chamado.tecnico_id);
  } else {
    const { rows } = await client.query(
      "SELECT id FROM usuario WHERE perfil IN ('administrador', 'gestor') AND ativo"
    );
    for (const { id } of rows) ids.add(id);
  }

  ids.delete(autorId);
  return [...ids];
}

/**
 * Registra um comentário e avisa os demais envolvidos (RF08).
 *
 * É também a segunda metade da RN03: depois que a janela de edição fecha, o
 * comentário é o canal que resta ao solicitante para acrescentar o que
 * faltou, sem mexer no que já orientou a triagem.
 */
async function criar(chamadoId, texto, usuario) {
  const limpo = String(texto ?? '').trim();

  if (limpo.length < TAMANHO_MINIMO) {
    throw new AppError('O comentário não pode ficar vazio.', 422, 'COMENTARIO_VAZIO');
  }
  if (limpo.length > TAMANHO_MAXIMO) {
    throw new AppError(
      `O comentário passa de ${TAMANHO_MAXIMO} caracteres.`,
      422,
      'COMENTARIO_LONGO'
    );
  }

  // Fora da transação: é leitura e autorização, e falhar aqui não deixa nada
  // pela metade.
  const chamado = await chamadosService.garantirLeitura(chamadoId, usuario);

  if (['concluido', 'cancelado'].includes(chamado.estado)) {
    // Chamado encerrado é registro. Quem discorda do desfecho reabre (RN09),
    // que tem janela e justificativa próprias; comentar num chamado fechado
    // criaria uma discussão que ninguém está encarregado de ler.
    throw new AppError(
      'Este chamado está encerrado. Para retomá-lo, use a reabertura.',
      409,
      'CHAMADO_ENCERRADO'
    );
  }

  const { comentario, notificacaoIds } = await transacao(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO comentario (chamado_id, usuario_id, texto)
       VALUES ($1, $2, $3)
       RETURNING id, texto, data, usuario_id`,
      [chamadoId, usuario.id, limpo]
    );

    const previa = limpo.length > PREVIA ? `${limpo.slice(0, PREVIA)}...` : limpo;
    const mensagem = `${usuario.nome} comentou no chamado ${chamado.protocolo}: "${previa}"`;

    const ids = [];
    for (const usuarioId of await destinatarios(client, chamado, usuario.id)) {
      const aviso = await client.query(
        `INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem)
         VALUES ($1, $2, 'comentario', $3) RETURNING id`,
        [usuarioId, chamadoId, mensagem]
      );
      ids.push(aviso.rows[0].id);
    }

    return { comentario: rows[0], notificacaoIds: ids };
  });

  // Depois do commit: enquanto a transação está aberta o comentário ainda
  // pode sumir num rollback, e avisar de algo que não aconteceu é pior que
  // não avisar.
  await notificacoesService.despacharVarios(notificacaoIds);

  return {
    ...comentario,
    usuario_nome: usuario.nome,
    usuario_perfil: usuario.perfil,
  };
}

module.exports = { listar, criar, TAMANHO_MAXIMO };

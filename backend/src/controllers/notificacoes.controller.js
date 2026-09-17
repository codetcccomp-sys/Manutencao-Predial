const notificacoesService = require('../services/notificacoes.service');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../middlewares/errorHandler');

const listar = asyncHandler(async (req, res) => {
  const notificacoes = await notificacoesService.listarDoUsuario(req.usuario.id, {
    apenasNaoLidas: req.query.nao_lidas === 'true',
  });
  res.json({ notificacoes });
});

const marcarComoLida = asyncHandler(async (req, res) => {
  const marcou = await notificacoesService.marcarComoLida(req.params.id, req.usuario.id);
  if (!marcou) {
    // Mesma resposta para "não existe" e "é de outra pessoa": distinguir as
    // duas diria ao solicitante quais ids existem.
    throw new AppError('Notificação não encontrada.', 404, 'NOTIFICACAO_NAO_ENCONTRADA');
  }
  res.status(204).send();
});

module.exports = { listar, marcarComoLida };

const comentariosService = require('../services/comentarios.service');
const { asyncHandler } = require('../utils/asyncHandler');

const listar = asyncHandler(async (req, res) => {
  const comentarios = await comentariosService.listar(req.params.id, req.usuario);
  res.json({ comentarios });
});

const criar = asyncHandler(async (req, res) => {
  const comentario = await comentariosService.criar(req.params.id, req.body.texto, req.usuario);
  res.status(201).json({ comentario });
});

module.exports = { listar, criar };

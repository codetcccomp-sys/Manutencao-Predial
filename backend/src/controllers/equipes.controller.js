const equipesService = require('../services/equipes.service');
const { asyncHandler } = require('../utils/asyncHandler');

const listar = asyncHandler(async (req, res) => {
  const equipes = await equipesService.listar({ incluirInativas: req.query.incluir_inativas === 'true' });
  res.json({ equipes });
});

const buscarPorId = asyncHandler(async (req, res) => {
  const equipe = await equipesService.buscarPorId(req.params.id);
  res.json({ equipe });
});

const criar = asyncHandler(async (req, res) => {
  const equipe = await equipesService.criar(req.body);
  res.status(201).json({ equipe });
});

const atualizar = asyncHandler(async (req, res) => {
  const equipe = await equipesService.atualizar(req.params.id, req.body);
  res.json({ equipe });
});

const adicionarTecnico = asyncHandler(async (req, res) => {
  const equipe = await equipesService.adicionarTecnico(req.params.id, req.body.usuario_id);
  res.status(201).json({ equipe });
});

const removerTecnico = asyncHandler(async (req, res) => {
  const equipe = await equipesService.removerTecnico(req.params.id, req.params.usuarioId);
  res.json({ equipe });
});

module.exports = { listar, buscarPorId, criar, atualizar, adicionarTecnico, removerTecnico };

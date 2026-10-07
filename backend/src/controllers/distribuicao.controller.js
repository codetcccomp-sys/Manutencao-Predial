const distribuicaoService = require('../services/distribuicao.service');
const { asyncHandler } = require('../utils/asyncHandler');

const listar = asyncHandler(async (req, res) => {
  res.json({ regras: await distribuicaoService.listar() });
});

const criar = asyncHandler(async (req, res) => {
  const regra = await distribuicaoService.criar(req.body, req.usuario);
  res.status(201).json({ regra });
});

const atualizar = asyncHandler(async (req, res) => {
  res.json({ regra: await distribuicaoService.atualizar(req.params.id, req.body) });
});

module.exports = { listar, criar, atualizar };

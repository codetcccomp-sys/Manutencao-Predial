const configuracaoService = require('../services/configuracao.service');
const { asyncHandler } = require('../utils/asyncHandler');

const listar = asyncHandler(async (req, res) => {
  res.json({ configuracoes: await configuracaoService.listar() });
});

const definir = asyncHandler(async (req, res) => {
  res.json({ configuracoes: await configuracaoService.definir(req.body, req.usuario) });
});

module.exports = { listar, definir };

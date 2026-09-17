const relatoriosService = require('../services/relatorios.service');
const { asyncHandler } = require('../utils/asyncHandler');

const resumo = asyncHandler(async (req, res) => {
  res.json(await relatoriosService.resumo(req.query));
});

const desempenho = asyncHandler(async (req, res) => {
  res.json(await relatoriosService.desempenho(req.query));
});

const porTecnico = asyncHandler(async (req, res) => {
  res.json({ tecnicos: await relatoriosService.porTecnico(req.query) });
});

module.exports = { resumo, desempenho, porTecnico };

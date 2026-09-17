const slaService = require('../services/sla.service');
const { asyncHandler } = require('../utils/asyncHandler');

const listar = asyncHandler(async (req, res) => {
  res.json({ sla: await slaService.listar() });
});

const atualizar = asyncHandler(async (req, res) => {
  const item = await slaService.atualizar(req.params.prioridade, req.body.prazo_horas);
  res.json({ sla: item });
});

module.exports = { listar, atualizar };

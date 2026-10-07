const slaService = require('../services/sla.service');
const { asyncHandler } = require('../utils/asyncHandler');

const listar = asyncHandler(async (req, res) => {
  res.json({ sla: await slaService.listar() });
});

const atualizar = asyncHandler(async (req, res) => {
  res.json({ sla: await slaService.atualizar(req.params.prioridade, req.body) });
});

const expediente = asyncHandler(async (req, res) => {
  res.json({ expediente: await slaService.expediente() });
});

const definirExpediente = asyncHandler(async (req, res) => {
  res.json({ expediente: await slaService.definirExpediente(req.body.dias) });
});

const feriados = asyncHandler(async (req, res) => {
  res.json({ feriados: await slaService.feriados({ ano: req.query.ano }) });
});

const adicionarFeriado = asyncHandler(async (req, res) => {
  res.status(201).json({ feriado: await slaService.adicionarFeriado(req.body) });
});

const removerFeriado = asyncHandler(async (req, res) => {
  await slaService.removerFeriado(req.params.data);
  res.status(204).send();
});

module.exports = {
  listar,
  atualizar,
  expediente,
  definirExpediente,
  feriados,
  adicionarFeriado,
  removerFeriado,
};

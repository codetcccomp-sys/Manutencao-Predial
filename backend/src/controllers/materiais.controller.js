const materiaisService = require('../services/materiais.service');
const chamadosService = require('../services/chamados.service');
const { asyncHandler } = require('../utils/asyncHandler');

const listar = asyncHandler(async (req, res) => {
  const materiais = await materiaisService.listar();
  res.json({ materiais });
});

const criar = asyncHandler(async (req, res) => {
  const material = await materiaisService.criar(req.body);
  res.status(201).json({ material });
});

const atualizar = asyncHandler(async (req, res) => {
  const material = await materiaisService.atualizar(req.params.id, req.body);
  res.json({ material });
});

const listarDoChamado = asyncHandler(async (req, res) => {
  await chamadosService.garantirLeitura(req.params.id, req.usuario);
  const materiais = await materiaisService.listarDoChamado(req.params.id);
  res.json({ materiais });
});

const registrarNoChamado = asyncHandler(async (req, res) => {
  await chamadosService.garantirExecucao(req.params.id, req.usuario);
  const materiais = await materiaisService.registrarNoChamado(req.params.id, req.body);
  res.status(201).json({ materiais });
});

const removerDoChamado = asyncHandler(async (req, res) => {
  await chamadosService.garantirExecucao(req.params.id, req.usuario);
  const materiais = await materiaisService.removerDoChamado(req.params.id, req.params.materialId);
  res.json({ materiais });
});

module.exports = {
  listar,
  criar,
  atualizar,
  listarDoChamado,
  registrarNoChamado,
  removerDoChamado,
};

const chamadosService = require('../services/chamados.service');
const { asyncHandler } = require('../utils/asyncHandler');

const criar = asyncHandler(async (req, res) => {
  const chamado = await chamadosService.criar(req.body, req.usuario.id);
  res.status(201).json({ chamado });
});

const listar = asyncHandler(async (req, res) => {
  const { estado, categoria_id, atrasados, pagina, limite } = req.query;
  const resultado = await chamadosService.listar(req.usuario, {
    estado,
    categoria_id,
    atrasados,
    pagina,
    limite,
  });
  res.json(resultado);
});

const buscarPorId = asyncHandler(async (req, res) => {
  const chamado = await chamadosService.buscarPorId(req.params.id, req.usuario);
  res.json({ chamado });
});

const atribuir = asyncHandler(async (req, res) => {
  const chamado = await chamadosService.atribuir(req.params.id, req.body, req.usuario);
  res.json({ chamado });
});

const mudarEstado = asyncHandler(async (req, res) => {
  const chamado = await chamadosService.mudarEstado(req.params.id, req.body, req.usuario);
  res.json({ chamado });
});

const priorizar = asyncHandler(async (req, res) => {
  const resultado = await chamadosService.priorizar(req.params.id, req.body, req.usuario);
  res.json(resultado);
});

const registrarExecucao = asyncHandler(async (req, res) => {
  const chamado = await chamadosService.registrarExecucao(req.params.id, req.body, req.usuario);
  res.json({ chamado });
});

const avaliar = asyncHandler(async (req, res) => {
  const avaliacao = await chamadosService.avaliar(req.params.id, req.body, req.usuario);
  res.status(201).json({ avaliacao });
});

module.exports = { criar, listar, buscarPorId, atribuir, mudarEstado, priorizar, registrarExecucao, avaliar };

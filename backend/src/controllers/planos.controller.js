const { asyncHandler } = require('../utils/asyncHandler');
const preventivaService = require('../services/preventiva.service');

const listar = asyncHandler(async (req, res) => {
  const planos = await preventivaService.listar({
    incluirInativos: req.query.incluir_inativos === 'true',
    equipamentoId: req.query.equipamento_id ? Number(req.query.equipamento_id) : undefined,
  });
  res.json({ planos });
});

const buscarPorId = asyncHandler(async (req, res) => {
  res.json({ plano: await preventivaService.buscar(req.params.id) });
});

const criar = asyncHandler(async (req, res) => {
  res.status(201).json({ plano: await preventivaService.criar(req.body, req.usuario) });
});

const atualizar = asyncHandler(async (req, res) => {
  res.json({ plano: await preventivaService.atualizar(req.params.id, req.body) });
});

const gerarAgora = asyncHandler(async (req, res) => {
  res.status(201).json({ gerado: await preventivaService.gerarAgora(req.params.id) });
});

module.exports = { listar, buscarPorId, criar, atualizar, gerarAgora };

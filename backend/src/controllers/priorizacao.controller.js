const priorizacaoService = require('../services/priorizacao.service');
const { asyncHandler } = require('../utils/asyncHandler');

// Deixa o gestor ver a sugestão antes de decidir, sem gravar nada no chamado.
// Sem isso, a única forma de conhecer a sugestão seria já tê-la aplicado.
const simular = asyncHandler(async (req, res) => {
  res.json(await priorizacaoService.simular(req.body));
});

const vigente = asyncHandler(async (req, res) => {
  res.json({ regra: await priorizacaoService.regraVigente() });
});

const listar = asyncHandler(async (req, res) => {
  res.json({ regras: await priorizacaoService.listarRegras() });
});

const criar = asyncHandler(async (req, res) => {
  res.status(201).json({ regra: await priorizacaoService.criarVersao(req.body) });
});

module.exports = { simular, vigente, listar, criar };

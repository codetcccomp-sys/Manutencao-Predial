const { asyncHandler } = require('../utils/asyncHandler');
const locaisService = require('../services/locais.service');

const listar = asyncHandler(async (req, res) => {
  // Inativos ficam de fora por padrão: a listagem alimenta o seletor de
  // abertura de chamado, e um local desativado não deve receber demanda nova.
  // A tela de cadastros pede a lista completa.
  const incluirInativos = req.query.incluir_inativos === 'true';
  res.json({ locais: await locaisService.listar({ incluirInativos }) });
});

const criar = asyncHandler(async (req, res) => {
  res.status(201).json({ local: await locaisService.criar(req.body) });
});

const atualizar = asyncHandler(async (req, res) => {
  // RF02 e RN10: desativar preserva o vínculo dos chamados existentes, que
  // continuam apontando para este local; é por isso que não há exclusão.
  res.json({ local: await locaisService.atualizar(req.params.id, req.body) });
});

const importar = asyncHandler(async (req, res) => {
  res.json({ relatorio: await locaisService.importar(req.body.csv) });
});

module.exports = { listar, criar, atualizar, importar };

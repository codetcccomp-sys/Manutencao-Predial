const authService = require('../services/auth.service');
const { asyncHandler } = require('../utils/asyncHandler');

const registrar = asyncHandler(async (req, res) => {
  const usuario = await authService.registrar(req.body);
  res.status(201).json({ usuario });
});

const login = asyncHandler(async (req, res) => {
  const resultado = await authService.login(req.body);
  res.json(resultado);
});

module.exports = { registrar, login };

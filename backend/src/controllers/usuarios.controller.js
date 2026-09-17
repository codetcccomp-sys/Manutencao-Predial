const usuariosService = require('../services/usuarios.service');
const authService = require('../services/auth.service');
const { asyncHandler } = require('../utils/asyncHandler');

const listar = asyncHandler(async (req, res) => {
  const usuarios = await usuariosService.listar({
    perfil: req.query.perfil,
    incluirInativos: req.query.incluir_inativos === 'true',
  });
  res.json({ usuarios });
});

const criar = asyncHandler(async (req, res) => {
  const usuario = await authService.criarUsuario(req.body);
  res.status(201).json({ usuario });
});

const atualizar = asyncHandler(async (req, res) => {
  const usuario = await usuariosService.atualizar(req.params.id, req.body, req.usuario);
  res.json({ usuario });
});

const me = asyncHandler(async (req, res) => {
  const usuario = await usuariosService.buscarPorId(req.usuario.id);
  res.json({ usuario });
});

module.exports = { listar, criar, atualizar, me };

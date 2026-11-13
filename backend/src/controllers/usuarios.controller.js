const usuariosService = require('../services/usuarios.service');
const authService = require('../services/auth.service');
const { asyncHandler } = require('../utils/asyncHandler');
const { filtroDeLista } = require('../middlewares/entrada');

const PERFIS = ['solicitante', 'tecnico', 'gestor', 'administrador'];

const listar = asyncHandler(async (req, res) => {
  const usuarios = await usuariosService.listar({
    perfil: filtroDeLista(req.query.perfil, 'perfil', PERFIS),
    incluirInativos: req.query.incluir_inativos === 'true',
    situacao: req.query.situacao,
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

const anonimizar = asyncHandler(async (req, res) => {
  const usuario = await usuariosService.anonimizar(req.params.id, req.usuario);
  res.json({ usuario });
});

const redefinir2fa = asyncHandler(async (req, res) => {
  await authService.redefinir2fa(req.params.id);
  res.status(204).send();
});

const aprovar = asyncHandler(async (req, res) => {
  res.json({ aprovados: await usuariosService.aprovar(req.body.ids, req.usuario) });
});

const recusar = asyncHandler(async (req, res) => {
  res.json({ recusados: await usuariosService.recusar(req.body.ids) });
});

module.exports = { listar, criar, atualizar, me, anonimizar, redefinir2fa, aprovar, recusar };

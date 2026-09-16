const pool = require('../config/db');
const authService = require('../services/auth.service');
const { asyncHandler } = require('../utils/asyncHandler');

const listar = asyncHandler(async (req, res) => {
  const { perfil } = req.query;
  const condicoes = [];
  const params = [];

  if (perfil) {
    params.push(perfil);
    condicoes.push(`perfil = $${params.length}`);
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, nome, email, perfil, ativo, criado_em FROM usuario ${where} ORDER BY nome`,
    params
  );
  res.json({ usuarios: rows });
});

const criar = asyncHandler(async (req, res) => {
  const usuario = await authService.criarUsuario(req.body);
  res.status(201).json({ usuario });
});

const me = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, nome, email, perfil, ativo, criado_em FROM usuario WHERE id = $1',
    [req.usuario.id]
  );
  res.json({ usuario: rows[0] });
});

module.exports = { listar, criar, me };

const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../middlewares/errorHandler');

const listar = asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM categoria ORDER BY nome');
  res.json({ categorias: rows });
});

const criar = asyncHandler(async (req, res) => {
  try {
    const { rows } = await pool.query(
      'INSERT INTO categoria (nome) VALUES ($1) RETURNING *',
      [req.body.nome.trim()]
    );
    res.status(201).json({ categoria: rows[0] });
  } catch (err) {
    // O nome é UNIQUE na tabela: sem tratar, uma categoria repetida voltaria
    // como erro interno em vez de dizer o que houve.
    if (err.code === '23505') {
      throw new AppError('Já existe uma categoria com este nome.', 409, 'NOME_EM_USO');
    }
    throw err;
  }
});

const atualizar = asyncHandler(async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE categoria SET nome = $1 WHERE id = $2 RETURNING *',
      [req.body.nome.trim(), req.params.id]
    );
    if (!rows[0]) {
      throw new AppError('Categoria não encontrada.', 404, 'CATEGORIA_NAO_ENCONTRADA');
    }
    res.json({ categoria: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      throw new AppError('Já existe uma categoria com este nome.', 409, 'NOME_EM_USO');
    }
    throw err;
  }
});

module.exports = { listar, criar, atualizar };

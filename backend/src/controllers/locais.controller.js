const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');

const listar = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM local WHERE ativo = TRUE ORDER BY unidade, bloco, pavimento, setor, ambiente'
  );
  res.json({ locais: rows });
});

const criar = asyncHandler(async (req, res) => {
  const { unidade, bloco, pavimento, setor, ambiente } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO local (unidade, bloco, pavimento, setor, ambiente)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [unidade, bloco || null, pavimento || null, setor || null, ambiente || null]
  );
  res.status(201).json({ local: rows[0] });
});

module.exports = { listar, criar };

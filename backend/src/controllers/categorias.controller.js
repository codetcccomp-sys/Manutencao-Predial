const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');

const listar = asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM categoria ORDER BY nome');
  res.json({ categorias: rows });
});

module.exports = { listar };

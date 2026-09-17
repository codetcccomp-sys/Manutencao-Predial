const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../middlewares/errorHandler');

const CAMPOS = ['unidade', 'bloco', 'pavimento', 'setor', 'ambiente'];

const listar = asyncHandler(async (req, res) => {
  // Inativos ficam de fora por padrão: a listagem alimenta o seletor de
  // abertura de chamado, e um local desativado não deve receber demanda nova.
  // A tela de cadastros pede a lista completa.
  const incluirInativos = req.query.incluir_inativos === 'true';

  const { rows } = await pool.query(
    `SELECT * FROM local ${incluirInativos ? '' : 'WHERE ativo = TRUE'}
      ORDER BY ativo DESC, unidade, bloco, pavimento, setor, ambiente`
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

const atualizar = asyncHandler(async (req, res) => {
  const campos = [];
  const params = [];

  for (const campo of [...CAMPOS, 'ativo']) {
    if (req.body[campo] === undefined) continue;
    params.push(req.body[campo] === '' ? null : req.body[campo]);
    campos.push(`${campo} = $${params.length}`);
  }

  if (campos.length === 0) {
    throw new AppError('Informe ao menos um campo para atualizar.', 422, 'NADA_A_ATUALIZAR');
  }

  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE local SET ${campos.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );

  if (!rows[0]) {
    throw new AppError('Local não encontrado.', 404, 'LOCAL_NAO_ENCONTRADO');
  }

  // RF02 e RN10: desativar preserva o vínculo dos chamados existentes, que
  // continuam apontando para este local; é por isso que não há exclusão.
  res.json({ local: rows[0] });
});

module.exports = { listar, criar, atualizar };

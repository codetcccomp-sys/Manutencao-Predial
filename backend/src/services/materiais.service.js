const pool = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');

async function listar() {
  const { rows } = await pool.query('SELECT * FROM material ORDER BY nome');
  return rows;
}

async function criar({ nome, unidade_medida }) {
  const { rows } = await pool.query(
    'INSERT INTO material (nome, unidade_medida) VALUES ($1, $2) RETURNING *',
    [nome, unidade_medida]
  );
  return rows[0];
}

async function atualizar(id, { nome, unidade_medida }) {
  const campos = [];
  const params = [];

  if (nome !== undefined) {
    params.push(nome);
    campos.push(`nome = $${params.length}`);
  }
  if (unidade_medida !== undefined) {
    params.push(unidade_medida);
    campos.push(`unidade_medida = $${params.length}`);
  }

  if (campos.length === 0) {
    throw new AppError('Informe ao menos um campo para atualizar.', 422, 'NADA_A_ATUALIZAR');
  }

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE material SET ${campos.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );

  if (!rows[0]) {
    throw new AppError('Material não encontrado.', 404, 'MATERIAL_NAO_ENCONTRADO');
  }
  return rows[0];
}

async function listarDoChamado(chamadoId) {
  const { rows } = await pool.query(
    `SELECT m.id AS material_id, m.nome, m.unidade_medida, cm.quantidade
       FROM chamado_material cm
       JOIN material m ON m.id = cm.material_id
      WHERE cm.chamado_id = $1
      ORDER BY m.nome`,
    [chamadoId]
  );
  return rows;
}

async function registrarNoChamado(chamadoId, { material_id, quantidade }) {
  const material = await pool.query('SELECT id FROM material WHERE id = $1', [material_id]);
  if (!material.rows[0]) {
    throw new AppError('Material não encontrado.', 404, 'MATERIAL_NAO_ENCONTRADO');
  }

  // A chave primária é (chamado_id, material_id): registrar o mesmo material
  // duas vezes é correção da quantidade, não um segundo lançamento.
  await pool.query(
    `INSERT INTO chamado_material (chamado_id, material_id, quantidade)
     VALUES ($1, $2, $3)
     ON CONFLICT (chamado_id, material_id) DO UPDATE SET quantidade = EXCLUDED.quantidade`,
    [chamadoId, material_id, quantidade]
  );

  return listarDoChamado(chamadoId);
}

async function removerDoChamado(chamadoId, materialId) {
  const { rowCount } = await pool.query(
    'DELETE FROM chamado_material WHERE chamado_id = $1 AND material_id = $2',
    [chamadoId, materialId]
  );

  if (rowCount === 0) {
    throw new AppError('Este material não está lançado neste chamado.', 404, 'LANCAMENTO_NAO_ENCONTRADO');
  }

  return listarDoChamado(chamadoId);
}

module.exports = {
  listar,
  criar,
  atualizar,
  listarDoChamado,
  registrarNoChamado,
  removerDoChamado,
};

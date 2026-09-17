const pool = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');

async function listar({ incluirInativas } = {}) {
  const { rows } = await pool.query(
    `SELECT e.*, count(et.usuario_id)::int AS total_tecnicos
       FROM equipe e
       LEFT JOIN equipe_tecnico et ON et.equipe_id = e.id
      ${incluirInativas ? '' : 'WHERE e.ativo = TRUE'}
      GROUP BY e.id
      ORDER BY e.nome`
  );
  return rows;
}

async function buscarPorId(id) {
  const { rows } = await pool.query('SELECT * FROM equipe WHERE id = $1', [id]);
  if (!rows[0]) {
    throw new AppError('Equipe não encontrada.', 404, 'EQUIPE_NAO_ENCONTRADA');
  }

  const tecnicos = await pool.query(
    `SELECT u.id, u.nome, u.email, u.ativo
       FROM equipe_tecnico et
       JOIN usuario u ON u.id = et.usuario_id
      WHERE et.equipe_id = $1
      ORDER BY u.nome`,
    [id]
  );

  return { ...rows[0], tecnicos: tecnicos.rows };
}

async function criar({ nome }) {
  const { rows } = await pool.query('INSERT INTO equipe (nome) VALUES ($1) RETURNING *', [nome]);
  return rows[0];
}

async function atualizar(id, { nome, ativo }) {
  const campos = [];
  const params = [];

  if (nome !== undefined) {
    params.push(nome);
    campos.push(`nome = $${params.length}`);
  }
  if (ativo !== undefined) {
    params.push(ativo);
    campos.push(`ativo = $${params.length}`);
  }

  if (campos.length === 0) {
    throw new AppError('Informe ao menos um campo para atualizar.', 422, 'NADA_A_ATUALIZAR');
  }

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE equipe SET ${campos.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );

  if (!rows[0]) {
    throw new AppError('Equipe não encontrada.', 404, 'EQUIPE_NAO_ENCONTRADA');
  }
  return rows[0];
}

async function adicionarTecnico(equipeId, usuarioId) {
  const equipe = await pool.query('SELECT id FROM equipe WHERE id = $1', [equipeId]);
  if (!equipe.rows[0]) {
    throw new AppError('Equipe não encontrada.', 404, 'EQUIPE_NAO_ENCONTRADA');
  }

  const usuario = await pool.query('SELECT id, perfil, ativo FROM usuario WHERE id = $1', [usuarioId]);
  if (!usuario.rows[0]) {
    throw new AppError('Usuário não encontrado.', 404, 'USUARIO_NAO_ENCONTRADO');
  }

  // Uma equipe de manutenção é composta por técnicos: deixar entrar um
  // solicitante faria a atribuição de chamado recair sobre quem não atende.
  if (usuario.rows[0].perfil !== 'tecnico') {
    throw new AppError('Apenas usuários com perfil técnico entram em equipes.', 422, 'PERFIL_INVALIDO');
  }
  if (!usuario.rows[0].ativo) {
    throw new AppError('Usuário inativo não pode ser adicionado à equipe.', 422, 'USUARIO_INATIVO');
  }

  await pool.query(
    `INSERT INTO equipe_tecnico (equipe_id, usuario_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [equipeId, usuarioId]
  );

  return buscarPorId(equipeId);
}

async function removerTecnico(equipeId, usuarioId) {
  const { rowCount } = await pool.query(
    'DELETE FROM equipe_tecnico WHERE equipe_id = $1 AND usuario_id = $2',
    [equipeId, usuarioId]
  );

  if (rowCount === 0) {
    throw new AppError('Este técnico não está nesta equipe.', 404, 'VINCULO_NAO_ENCONTRADO');
  }

  return buscarPorId(equipeId);
}

module.exports = { listar, buscarPorId, criar, atualizar, adicionarTecnico, removerTecnico };

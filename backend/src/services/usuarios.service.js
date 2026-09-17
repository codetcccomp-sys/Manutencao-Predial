const pool = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');

const CAMPOS = 'id, nome, email, perfil, ativo, criado_em';

/**
 * Por padrão lista só quem está ativo.
 *
 * O select de técnicos da tela de chamado consome esta rota: incluir
 * desligados ali permitiria atribuir um chamado a quem não atende mais. Quem
 * precisa ver a lista inteira — a tela de administração — pede explicitamente.
 */
async function listar({ perfil, incluirInativos } = {}) {
  const condicoes = [];
  const params = [];

  if (perfil) {
    params.push(perfil);
    condicoes.push(`perfil = $${params.length}`);
  }
  if (!incluirInativos) {
    condicoes.push('ativo = TRUE');
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT ${CAMPOS} FROM usuario ${where} ORDER BY ativo DESC, nome`,
    params
  );
  return rows;
}

async function buscarPorId(id) {
  const { rows } = await pool.query(`SELECT ${CAMPOS} FROM usuario WHERE id = $1`, [id]);
  if (!rows[0]) {
    throw new AppError('Usuário não encontrado.', 404, 'USUARIO_NAO_ENCONTRADO');
  }
  return rows[0];
}

async function contarAdministradoresAtivos(exceto) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS total FROM usuario WHERE perfil = $1 AND ativo = TRUE AND id <> $2',
    ['administrador', exceto]
  );
  return rows[0].total;
}

/**
 * Altera nome, perfil ou situação de um usuário.
 *
 * Duas travas, ambas contra o mesmo acidente — ficar sem quem administre:
 * ninguém rebaixa ou desativa a própria conta, e o último administrador ativo
 * não pode ser removido por outro. Sem elas, recuperar o sistema exigiria
 * acesso direto ao banco, que é justamente o que esta tela existe para evitar.
 */
async function atualizar(id, { nome, perfil, ativo }, autor) {
  const alvo = await buscarPorId(id);
  const ehAPropriaConta = alvo.id === autor.id;

  if (ehAPropriaConta && ativo === false) {
    throw new AppError('Você não pode desativar a própria conta.', 422, 'AUTO_DESATIVACAO');
  }
  if (ehAPropriaConta && perfil !== undefined && perfil !== alvo.perfil) {
    throw new AppError('Você não pode alterar o próprio perfil.', 422, 'AUTO_REBAIXAMENTO');
  }

  const deixaDeAdministrar =
    alvo.perfil === 'administrador' &&
    ((perfil !== undefined && perfil !== 'administrador') || ativo === false);

  if (deixaDeAdministrar && (await contarAdministradoresAtivos(alvo.id)) === 0) {
    throw new AppError(
      'Este é o último administrador ativo. Promova outro antes de alterá-lo.',
      422,
      'ULTIMO_ADMINISTRADOR'
    );
  }

  const campos = [];
  const params = [];

  for (const [coluna, valor] of [
    ['nome', nome],
    ['perfil', perfil],
    ['ativo', ativo],
  ]) {
    if (valor === undefined) continue;
    params.push(valor);
    campos.push(coluna === 'perfil' ? `perfil = $${params.length}::perfil_usuario` : `${coluna} = $${params.length}`);
  }

  if (campos.length === 0) {
    throw new AppError('Informe ao menos um campo para atualizar.', 422, 'NADA_A_ATUALIZAR');
  }

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE usuario SET ${campos.join(', ')} WHERE id = $${params.length} RETURNING ${CAMPOS}`,
    params
  );

  return rows[0];
}

module.exports = { listar, buscarPorId, atualizar };

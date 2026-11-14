const pool = require('../config/db');
const { transacao } = require('../config/transacao');
const { AppError } = require('../middlewares/errorHandler');

// Estados em que o atendimento já terminou. Material lançado depois disso seria registro
// de manutenção que não aconteceu naquele atendimento: quem precisa corrigir reabre (RN05).
const ENCERRADOS = ['concluido', 'cancelado'];

const quantidadeLegivel = (q, unidade) => `${Number(q).toLocaleString('pt-BR')} ${unidade}`;

// O mesmo nome com outra caixa ou espaço vira dois itens no catálogo, e o consumo se
// divide entre eles sem ninguém perceber nos relatórios.
async function recusarNomeRepetido(nome, exceto = null) {
  const { rows } = await pool.query(
    'SELECT id FROM material WHERE lower(btrim(nome)) = lower(btrim($1)) AND id IS DISTINCT FROM $2',
    [nome, exceto]
  );
  if (rows[0]) {
    throw new AppError('Já existe um material com este nome.', 409, 'MATERIAL_DUPLICADO');
  }
}

async function listar() {
  const { rows } = await pool.query('SELECT * FROM material ORDER BY nome');
  return rows;
}

async function criar({ nome, unidade_medida }) {
  await recusarNomeRepetido(nome);
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
  if (nome !== undefined) await recusarNomeRepetido(nome, id);

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

/**
 * Trava o chamado e confere que o atendimento ainda está aberto. A trava vale até o fim da
 * transação: um "concluir" que chegue no meio espera, em vez de deixar material lançado
 * depois da conclusão.
 */
async function chamadoAberto(client, chamadoId) {
  const { rows } = await client.query('SELECT estado FROM chamado WHERE id = $1 FOR UPDATE', [chamadoId]);
  if (!rows[0]) {
    throw new AppError('Chamado não encontrado.', 404, 'CHAMADO_NAO_ENCONTRADO');
  }
  if (ENCERRADOS.includes(rows[0].estado)) {
    throw new AppError(
      'Não é possível lançar ou retirar material de chamado concluído ou cancelado.',
      409,
      'ESTADO_INVALIDO'
    );
  }
  return rows[0].estado;
}

// O consumo é parte do registro do atendimento (RF07): quem lançou, o quê e quando fica na
// linha do tempo, que não se edita. O estado não muda, então entra repetido (como na
// confirmação da solução), e a cadeia de estados do histórico continua íntegra.
async function registrarHistorico(client, chamadoId, usuarioId, estado, observacao) {
  await client.query(
    `INSERT INTO historico_chamado (chamado_id, usuario_id, estado_anterior, estado_novo, observacao)
     VALUES ($1, $2, $3, $3, $4)`,
    [chamadoId, usuarioId, estado, observacao]
  );
}

async function registrarNoChamado(chamadoId, { material_id, quantidade }, usuario) {
  await transacao(async (client) => {
    const estado = await chamadoAberto(client, chamadoId);

    const material = await client.query('SELECT nome, unidade_medida FROM material WHERE id = $1', [material_id]);
    if (!material.rows[0]) {
      throw new AppError('Material não encontrado.', 404, 'MATERIAL_NAO_ENCONTRADO');
    }
    const { nome, unidade_medida: unidade } = material.rows[0];

    const anterior = await client.query(
      'SELECT quantidade FROM chamado_material WHERE chamado_id = $1 AND material_id = $2',
      [chamadoId, material_id]
    );

    // A chave primária é (chamado_id, material_id): registrar o mesmo material
    // duas vezes é correção da quantidade, não um segundo lançamento.
    await client.query(
      `INSERT INTO chamado_material (chamado_id, material_id, quantidade)
       VALUES ($1, $2, $3)
       ON CONFLICT (chamado_id, material_id) DO UPDATE SET quantidade = EXCLUDED.quantidade`,
      [chamadoId, material_id, quantidade]
    );

    await registrarHistorico(
      client,
      chamadoId,
      usuario.id,
      estado,
      anterior.rows[0]
        ? `Material corrigido: ${nome}, ${quantidadeLegivel(quantidade, unidade)} (antes, ${quantidadeLegivel(anterior.rows[0].quantidade, unidade)}).`
        : `Material lançado: ${nome}, ${quantidadeLegivel(quantidade, unidade)}.`
    );
  });

  return listarDoChamado(chamadoId);
}

async function removerDoChamado(chamadoId, materialId, usuario) {
  await transacao(async (client) => {
    const estado = await chamadoAberto(client, chamadoId);

    const { rows } = await client.query(
      `DELETE FROM chamado_material cm
        USING material m
        WHERE m.id = cm.material_id AND cm.chamado_id = $1 AND cm.material_id = $2
        RETURNING m.nome, m.unidade_medida, cm.quantidade`,
      [chamadoId, materialId]
    );

    if (!rows[0]) {
      throw new AppError('Este material não está lançado neste chamado.', 404, 'LANCAMENTO_NAO_ENCONTRADO');
    }

    await registrarHistorico(
      client,
      chamadoId,
      usuario.id,
      estado,
      `Material retirado: ${rows[0].nome}, ${quantidadeLegivel(rows[0].quantidade, rows[0].unidade_medida)}.`
    );
  });

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

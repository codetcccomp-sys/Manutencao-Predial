const pool = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');
const { rotuloSql } = require('./locais.service');

/**
 * Equipamentos: o que se mantém.
 *
 * O chamado sempre teve local; o equipamento é opcional nele. Nem todo
 * problema é de um equipamento (a parede rachada, a porta que emperra), e
 * obrigar a escolher um faria as pessoas escolherem qualquer um.
 */

const CAMPOS = [
  'codigo',
  'nome',
  'categoria_id',
  'local_id',
  'fabricante',
  'modelo',
  'numero_serie',
  'data_instalacao',
  'observacao',
  'ativo',
];

/**
 * A etiqueta como o banco guarda: maiúsculas, sem espaço nas pontas.
 *
 * Normalizar aqui, e não só recusar no CHECK, é o que deixa quem cadastra
 * digitar "bomba-01" e quem lê o QR achar "BOMBA-01" — a etiqueta é a mesma.
 */
function normalizarCodigo(codigo) {
  return String(codigo ?? '').trim().toUpperCase();
}

const FORMATO_CODIGO = /^[A-Z0-9][A-Z0-9._/-]*$/;

function validarCodigo(codigo) {
  if (!codigo || codigo.length > 40 || !FORMATO_CODIGO.test(codigo)) {
    throw new AppError(
      'O código deve ter até 40 caracteres: letras, números e . _ / - (sem espaços), começando por letra ou número.',
      422,
      'VALIDACAO'
    );
  }
}

const SELECAO = `
  SELECT e.*, ${rotuloSql('l')} AS local_rotulo, cat.nome AS categoria_nome
    FROM equipamento e
    JOIN local l ON l.id = e.local_id
    JOIN categoria cat ON cat.id = e.categoria_id`;

async function listar({ localId, incluirInativos = false, busca } = {}) {
  const condicoes = [];
  const params = [];

  if (!incluirInativos) condicoes.push('e.ativo');
  if (localId) {
    params.push(localId);
    condicoes.push(`e.local_id = $${params.length}`);
  }
  if (busca && busca.trim()) {
    params.push(`%${busca.trim()}%`);
    condicoes.push(`(e.codigo ILIKE $${params.length} OR e.nome ILIKE $${params.length})`);
  }

  const { rows } = await pool.query(
    `${SELECAO}
     ${condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''}
     ORDER BY e.ativo DESC, e.nome, e.codigo`,
    params
  );
  return rows;
}

async function buscar(id) {
  const { rows } = await pool.query(`${SELECAO} WHERE e.id = $1`, [id]);
  if (!rows[0]) {
    throw new AppError('Equipamento não encontrado.', 404, 'EQUIPAMENTO_NAO_ENCONTRADO');
  }
  return rows[0];
}

/**
 * Pela etiqueta: é o que o QR Code colado no equipamento leva.
 *
 * Só equipamento ativo: um código de equipamento desativado (trocado,
 * retirado) não pode continuar abrindo chamado para algo que não está mais lá.
 */
async function buscarPorCodigo(codigo) {
  const { rows } = await pool.query(`${SELECAO} WHERE e.codigo = $1 AND e.ativo`, [
    normalizarCodigo(codigo),
  ]);
  if (!rows[0]) {
    throw new AppError('Nenhum equipamento ativo com este código.', 404, 'EQUIPAMENTO_NAO_ENCONTRADO');
  }
  return rows[0];
}

/**
 * O equipamento com o que aconteceu com ele: os chamados (corretivos e
 * preventivos, mais recentes primeiro) e os planos que o cobrem.
 *
 * Quem vê: a gestão e os técnicos. É a ficha que o técnico abre antes de ir
 * ao local — "esta bomba já teve o selo trocado duas vezes este ano" muda o
 * que ele leva na mão. O solicitante abre chamado para o equipamento, mas o
 * histórico dele inclui chamados de outras pessoas, que ele não enxerga.
 */
async function ficha(id) {
  const equipamento = await buscar(id);

  const [chamados, planos, totais] = await Promise.all([
    pool.query(
      `SELECT id, protocolo, titulo, estado, prioridade, origem, data_prevista,
              data_abertura, data_conclusao, servico_realizado
         FROM chamado
        WHERE equipamento_id = $1
        ORDER BY data_abertura DESC
        LIMIT 50`,
      [id]
    ),
    pool.query(
      `SELECT id, titulo, repetir_a_cada, unidade_repeticao, proxima_execucao, ativo
         FROM plano_preventivo
        WHERE equipamento_id = $1
        ORDER BY ativo DESC, proxima_execucao`,
      [id]
    ),
    pool.query(
      `SELECT count(*)::int AS chamados,
              count(*) FILTER (WHERE origem = 'corretiva')::int AS corretivos,
              count(*) FILTER (WHERE origem = 'preventiva')::int AS preventivos,
              count(*) FILTER (WHERE origem = 'corretiva'
                                 AND data_abertura > now() - interval '12 months')::int
                AS corretivos_12_meses
         FROM chamado
        WHERE equipamento_id = $1`,
      [id]
    ),
  ]);

  return {
    ...equipamento,
    chamados: chamados.rows,
    planos: planos.rows,
    totais: totais.rows[0],
  };
}

function ehData(valor) {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(valor));
}

function valoresDe(campos) {
  const dados = {};
  for (const campo of CAMPOS) {
    if (campos[campo] === undefined) continue;
    let valor = campos[campo];
    if (typeof valor === 'string') valor = valor.trim();
    dados[campo] = valor === '' ? null : valor;
  }
  if (dados.codigo !== undefined) {
    dados.codigo = normalizarCodigo(dados.codigo);
    validarCodigo(dados.codigo);
  }
  if (dados.data_instalacao && !ehData(dados.data_instalacao)) {
    throw new AppError('"data_instalacao" deve ser uma data no formato AAAA-MM-DD.', 422, 'VALIDACAO');
  }
  if (dados.ativo !== undefined && typeof dados.ativo !== 'boolean') {
    throw new AppError('"ativo" deve ser verdadeiro ou falso.', 422, 'VALIDACAO');
  }
  return dados;
}

function traduzirConflito(err) {
  if (err.code === '23505') {
    return new AppError('Já existe um equipamento com este código.', 409, 'CODIGO_DUPLICADO');
  }
  // 23503: categoria ou local que não existem. Chega como violação de chave
  // estrangeira; para quem cadastra, é um dado inválido, não erro interno.
  if (err.code === '23503') {
    return new AppError('Categoria ou local inexistente.', 422, 'REFERENCIA_INVALIDA');
  }
  return err;
}

async function criar(campos) {
  const dados = valoresDe(campos);
  const colunas = Object.keys(dados);
  const params = colunas.map((c) => dados[c]);

  try {
    const { rows } = await pool.query(
      `INSERT INTO equipamento (${colunas.join(', ')})
       VALUES (${colunas.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING id`,
      params
    );
    return buscar(rows[0].id);
  } catch (err) {
    throw traduzirConflito(err);
  }
}

async function atualizar(id, campos) {
  const dados = valoresDe(campos);
  const colunas = Object.keys(dados);

  if (colunas.length === 0) {
    throw new AppError('Informe ao menos um campo para atualizar.', 422, 'NADA_A_ATUALIZAR');
  }

  const params = colunas.map((c) => dados[c]);
  params.push(id);

  let rows;
  try {
    ({ rows } = await pool.query(
      `UPDATE equipamento SET ${colunas.map((c, i) => `${c} = $${i + 1}`).join(', ')}
        WHERE id = $${params.length}
        RETURNING id`,
      params
    ));
  } catch (err) {
    throw traduzirConflito(err);
  }

  if (!rows[0]) {
    throw new AppError('Equipamento não encontrado.', 404, 'EQUIPAMENTO_NAO_ENCONTRADO');
  }
  return buscar(id);
}

/**
 * Confere que o equipamento informado num chamado ou plano está no local
 * informado, e devolve o local efetivo.
 *
 * Sem isso, um chamado poderia dizer "split da sala 204" no equipamento e
 * "sala 310" no local, e o técnico iria ao lugar errado. Quando só o
 * equipamento vem (o caminho do QR Code), o local é o dele.
 */
async function conferirNoLocal(client, equipamentoId, localId) {
  const { rows } = await client.query(
    'SELECT id, local_id, categoria_id, ativo FROM equipamento WHERE id = $1',
    [equipamentoId]
  );
  const equipamento = rows[0];

  if (!equipamento) {
    throw new AppError('Equipamento não encontrado.', 422, 'EQUIPAMENTO_INVALIDO');
  }
  if (!equipamento.ativo) {
    throw new AppError('Este equipamento está desativado.', 422, 'EQUIPAMENTO_INVALIDO');
  }
  if (localId && Number(localId) !== equipamento.local_id) {
    throw new AppError(
      'O equipamento informado não fica no local informado.',
      422,
      'EQUIPAMENTO_FORA_DO_LOCAL'
    );
  }

  return equipamento;
}

module.exports = {
  listar,
  buscar,
  buscarPorCodigo,
  ficha,
  criar,
  atualizar,
  conferirNoLocal,
  normalizarCodigo,
  ehData,
};

const pool = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Distribuição automática de chamados rotineiros.
 *
 * A triagem do gestor (RF04/RF05) continua sendo o caminho padrão. Uma regra
 * só existe porque a gestão decidiu que certa categoria, num certo lugar, não
 * precisa dela: a lâmpada queimada vai direto para a equipe de elétrica, com
 * a prioridade que a gestão escolheu, e o gestor continua vendo tudo e pode
 * repriorizar ou reatribuir quando quiser.
 */

// Estados em que o chamado ocupa o técnico: a carga que a divisão compara.
const ESTADOS_EM_ABERTO = "('atribuido', 'em_andamento', 'aguardando_material')";

const PRIORIDADES = ['baixa', 'media', 'alta', 'critica'];

const ROTULO_PRIORIDADE = { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' };

const SELECAO = `
  SELECT r.*,
         c.nome AS categoria_nome,
         e.nome AS equipe_nome,
         e.ativo AS equipe_ativa,
         t.nome AS tecnico_nome,
         (SELECT count(*)::int
            FROM equipe_tecnico et
            JOIN usuario u ON u.id = et.usuario_id
           WHERE et.equipe_id = r.equipe_id
             AND u.perfil = 'tecnico' AND u.ativo AND u.anonimizado_em IS NULL) AS tecnicos_ativos
    FROM regra_distribuicao r
    JOIN categoria c ON c.id = r.categoria_id
    JOIN equipe e ON e.id = r.equipe_id
    LEFT JOIN usuario t ON t.id = r.tecnico_id`;

// Vazio vira nulo: "sem bloco" e bloco "" são a mesma escolha na tela, e só
// o nulo é entendido como "vale para todos".
function texto(valor) {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  const limpo = String(valor).trim();
  return limpo === '' ? null : limpo;
}

function traduzirConflito(err) {
  if (err.code === '23505') {
    return new AppError(
      'Já existe uma regra ligada para esta categoria com o mesmo alcance. Desligue a outra ou ajuste o alcance.',
      409,
      'REGRA_DUPLICADA'
    );
  }
  if (err.code === '23503') {
    return new AppError('Categoria ou equipe inexistente.', 422, 'REFERENCIA_INVALIDA');
  }
  if (err.code === '23514') {
    return new AppError('Bloco só pode ser informado junto com a unidade.', 422, 'ALCANCE_INVALIDO');
  }
  return err;
}

async function listar() {
  const { rows } = await pool.query(
    `${SELECAO}
     ORDER BY r.ativo DESC, c.nome, r.unidade NULLS FIRST, r.bloco NULLS FIRST, r.id`
  );
  return rows;
}

async function buscar(client, id) {
  // "/regras-distribuicao/abc" é regra que não existe, não erro interno do
  // banco tentando converter texto em número.
  if (!/^\d+$/.test(String(id))) {
    throw new AppError('Regra de distribuição não encontrada.', 404, 'REGRA_NAO_ENCONTRADA');
  }
  const { rows } = await client.query(`${SELECAO} WHERE r.id = $1`, [id]);
  if (!rows[0]) {
    throw new AppError('Regra de distribuição não encontrada.', 404, 'REGRA_NAO_ENCONTRADA');
  }
  return rows[0];
}

async function conferirEquipe(client, equipeId) {
  const { rows } = await client.query('SELECT ativo FROM equipe WHERE id = $1', [equipeId]);
  if (!rows[0]) {
    throw new AppError('Equipe não encontrada.', 404, 'EQUIPE_NAO_ENCONTRADA');
  }
  // Uma regra que aponta para equipe desativada distribuiria para ninguém —
  // ou, pior, para quem já não responde por aquilo.
  if (!rows[0].ativo) {
    throw new AppError('A equipe está desativada.', 422, 'EQUIPE_INATIVA');
  }
}

// O plantonista precisa ser da equipe: senão a regra diria "vai para a
// hidráulica" e entregaria o chamado a um eletricista.
async function conferirPlantonista(client, equipeId, tecnicoId) {
  if (tecnicoId === null || tecnicoId === undefined) return;
  const { rows } = await client.query(
    `SELECT 1
       FROM equipe_tecnico et
       JOIN usuario u ON u.id = et.usuario_id
      WHERE et.equipe_id = $1 AND et.usuario_id = $2
        AND u.perfil = 'tecnico' AND u.ativo AND u.anonimizado_em IS NULL`,
    [equipeId, tecnicoId]
  );
  if (!rows[0]) {
    throw new AppError(
      'O técnico de plantão precisa ser um técnico ativo da equipe escolhida.',
      422,
      'PLANTONISTA_FORA_DA_EQUIPE'
    );
  }
}

async function criar(dados, usuario) {
  const unidade = texto(dados.unidade) ?? null;
  const bloco = texto(dados.bloco) ?? null;
  if (bloco && !unidade) {
    throw new AppError('Bloco só pode ser informado junto com a unidade.', 422, 'ALCANCE_INVALIDO');
  }

  const client = await pool.connect();
  try {
    await conferirEquipe(client, dados.equipe_id);
    await conferirPlantonista(client, dados.equipe_id, dados.tecnico_id);

    const { rows } = await client.query(
      `INSERT INTO regra_distribuicao
         (categoria_id, unidade, bloco, equipe_id, tecnico_id, prioridade, criado_por)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::prioridade_chamado, 'baixa'), $7)
       RETURNING id`,
      [
        dados.categoria_id,
        unidade,
        bloco,
        dados.equipe_id,
        dados.tecnico_id ?? null,
        dados.prioridade ?? null,
        usuario.id,
      ]
    );
    return await buscar(client, rows[0].id);
  } catch (err) {
    throw traduzirConflito(err);
  } finally {
    client.release();
  }
}

/**
 * Muda equipe, plantonista, prioridade ou liga/desliga.
 *
 * Categoria e alcance não mudam: uma regra que passasse a valer para outro
 * lugar mudaria o sentido dos chamados que ela já distribuiu, que continuam
 * apontando para ela. Para outro alcance, cria-se outra regra.
 */
async function atualizar(id, dados) {
  const client = await pool.connect();
  try {
    const atual = await buscar(client, id);

    const equipeId = dados.equipe_id ?? atual.equipe_id;
    // Trocar de equipe sem dizer o plantonista solta o antigo: ele era da
    // outra equipe, e mantê-lo faria a regra entregar fora dela.
    let tecnicoId = dados.tecnico_id !== undefined ? dados.tecnico_id : atual.tecnico_id;
    if (dados.equipe_id !== undefined && dados.equipe_id !== atual.equipe_id && dados.tecnico_id === undefined) {
      tecnicoId = null;
    }

    if (dados.equipe_id !== undefined) await conferirEquipe(client, equipeId);
    if (dados.tecnico_id !== undefined || dados.equipe_id !== undefined) {
      await conferirPlantonista(client, equipeId, tecnicoId);
    }

    await client.query(
      `UPDATE regra_distribuicao
          SET equipe_id = $1, tecnico_id = $2, prioridade = $3, ativo = $4
        WHERE id = $5`,
      [equipeId, tecnicoId, dados.prioridade ?? atual.prioridade, dados.ativo ?? atual.ativo, id]
    );
    return await buscar(client, id);
  } catch (err) {
    throw traduzirConflito(err);
  } finally {
    client.release();
  }
}

/**
 * A regra que vale para um chamado novo, ou nada.
 *
 * Roda na transação que cria o chamado. A mais específica vence: bloco antes
 * de unidade, unidade antes da instituição toda. Regra de equipe desativada
 * não conta, e a próxima mais geral assume no lugar dela.
 */
async function regraPara(client, { categoria_id, local_id }) {
  const { rows } = await client.query(
    `SELECT r.*, e.nome AS equipe_nome
       FROM regra_distribuicao r
       JOIN equipe e ON e.id = r.equipe_id AND e.ativo
       JOIN local l ON l.id = $2
      WHERE r.ativo
        AND r.categoria_id = $1
        AND (r.unidade IS NULL OR lower(btrim(r.unidade)) = lower(btrim(l.unidade)))
        AND (r.bloco IS NULL OR lower(btrim(r.bloco)) = lower(btrim(coalesce(l.bloco, ''))))
      ORDER BY (r.bloco IS NOT NULL) DESC, (r.unidade IS NOT NULL) DESC
      LIMIT 1`,
    [categoria_id, local_id]
  );
  return rows[0] || null;
}

/**
 * O técnico que recebe o chamado, e por quê. `null` quando a equipe não tem
 * ninguém ativo: aí o chamado segue para a triagem, como se não houvesse
 * regra.
 *
 * A trava consultiva serializa as escolhas da mesma equipe até o fim da
 * transação. Sem ela, dois chamados abertos no mesmo instante contariam a
 * mesma carga e cairiam os dois no mesmo técnico — e a divisão por carga
 * existe justamente para isso não acontecer.
 */
async function escolherTecnico(client, regra) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('regra_distribuicao'), $1)", [regra.equipe_id]);

  if (regra.tecnico_id) {
    const { rows } = await client.query(
      `SELECT u.id, u.nome
         FROM equipe_tecnico et
         JOIN usuario u ON u.id = et.usuario_id
        WHERE et.equipe_id = $1 AND u.id = $2
          AND u.perfil = 'tecnico' AND u.ativo AND u.anonimizado_em IS NULL`,
      [regra.equipe_id, regra.tecnico_id]
    );
    if (rows[0]) return { ...rows[0], motivo: 'técnico de plantão da regra' };
    // Plantonista desativado ou que saiu da equipe: a regra não para por
    // isso, a equipe divide.
  }

  // Menos chamados em aberto primeiro; no empate, quem recebeu chamado há
  // mais tempo (ou nunca recebeu), para o empate não cair sempre no mesmo.
  const { rows } = await client.query(
    `SELECT u.id, u.nome,
            (SELECT count(*) FROM chamado c
              WHERE c.tecnico_id = u.id AND c.estado IN ${ESTADOS_EM_ABERTO}) AS em_aberto
       FROM equipe_tecnico et
       JOIN usuario u ON u.id = et.usuario_id
      WHERE et.equipe_id = $1
        AND u.perfil = 'tecnico' AND u.ativo AND u.anonimizado_em IS NULL
      ORDER BY em_aberto ASC,
               (SELECT max(c.id) FROM chamado c WHERE c.tecnico_id = u.id) ASC NULLS FIRST,
               u.id ASC
      LIMIT 1`,
    [regra.equipe_id]
  );
  if (!rows[0]) return null;
  const n = Number(rows[0].em_aberto);
  return {
    id: rows[0].id,
    nome: rows[0].nome,
    motivo: `menos chamados em aberto na equipe (${n})`,
  };
}

function descreverAlcance(regra) {
  if (regra.bloco) return `${regra.unidade} / ${regra.bloco}`;
  if (regra.unidade) return regra.unidade;
  return 'toda a instituição';
}

module.exports = {
  ROTULO_PRIORIDADE,
  listar,
  criar,
  atualizar,
  regraPara,
  escolherTecnico,
  descreverAlcance,
  PRIORIDADES,
};

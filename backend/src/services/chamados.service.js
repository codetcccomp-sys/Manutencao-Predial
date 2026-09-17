const pool = require('../config/db');
const { transacao } = require('../config/transacao');
const { AppError } = require('../middlewares/errorHandler');
const { gerarProtocolo } = require('../utils/protocolo');

// Transições de estado permitidas (RN implícitas no fluxo de atendimento).
const TRANSICOES = {
  aberto: ['em_triagem', 'cancelado'],
  em_triagem: ['atribuido', 'cancelado'],
  atribuido: ['em_andamento', 'cancelado'],
  em_andamento: ['aguardando_material', 'concluido', 'cancelado'],
  aguardando_material: ['em_andamento', 'cancelado'],
  concluido: [],
  cancelado: [],
};

async function criar({ titulo, descricao, categoria_id, local_id, prioridade }, solicitanteId) {
  const protocolo = gerarProtocolo();

  return transacao(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO chamado (protocolo, titulo, descricao, categoria_id, local_id, solicitante_id, prioridade)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::prioridade_chamado, 'baixa'))
       RETURNING *`,
      [protocolo, titulo, descricao, categoria_id, local_id, solicitanteId, prioridade]
    );

    const chamado = rows[0];

    await registrarHistorico(client, chamado.id, solicitanteId, null, 'aberto', 'Chamado aberto.');

    return chamado;
  });
}

const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 100;

// Um parâmetro de paginação inválido ("abc", -5, 10000) não é motivo para
// recusar o pedido, mas também não pode virar um SELECT sem teto: cai no
// padrão ou no extremo mais próximo.
function normalizarPaginacao({ pagina, limite } = {}) {
  const limiteNum = Number.parseInt(limite, 10);
  const paginaNum = Number.parseInt(pagina, 10);

  return {
    limite: Number.isNaN(limiteNum) ? LIMITE_PADRAO : Math.min(Math.max(limiteNum, 1), LIMITE_MAXIMO),
    pagina: Number.isNaN(paginaNum) ? 1 : Math.max(paginaNum, 1),
  };
}

async function listar(usuario, filtros = {}) {
  const condicoes = [];
  const params = [];

  if (usuario.perfil === 'solicitante') {
    params.push(usuario.id);
    condicoes.push(`solicitante_id = $${params.length}`);
  } else if (usuario.perfil === 'tecnico') {
    params.push(usuario.id);
    condicoes.push(`tecnico_id = $${params.length}`);
  }
  // gestor e administrador enxergam todos os chamados.

  if (filtros.estado) {
    params.push(filtros.estado);
    condicoes.push(`estado = $${params.length}`);
  }
  if (filtros.categoria_id) {
    params.push(filtros.categoria_id);
    condicoes.push(`categoria_id = $${params.length}`);
  }

  const { pagina, limite } = normalizarPaginacao(filtros);
  const offset = (pagina - 1) * limite;

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  // count(*) OVER () traz o total junto com a página, numa varredura só, em
  // vez de repetir o mesmo WHERE num SELECT count separado.
  params.push(limite, offset);
  const { rows } = await pool.query(
    `SELECT *, count(*) OVER () AS total_registros
       FROM chamado
       ${where}
      ORDER BY data_abertura DESC, id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  // A janela só devolve o total quando há pelo menos uma linha. Numa página
  // além do fim isso daria total 0, como se o filtro não tivesse achado nada
  // — então nesse caso (e só nele) vale a contagem separada.
  let total;
  if (rows.length > 0) {
    total = Number(rows[0].total_registros);
  } else {
    const contagem = await pool.query(
      `SELECT count(*) AS total FROM chamado ${where}`,
      params.slice(0, -2)
    );
    total = Number(contagem.rows[0].total);
  }

  const chamados = rows.map(({ total_registros, ...chamado }) => chamado);

  return {
    chamados,
    paginacao: { pagina, limite, total, paginas: Math.ceil(total / limite) },
  };
}

async function buscarPorId(id, usuario) {
  const { rows } = await pool.query('SELECT * FROM chamado WHERE id = $1', [id]);
  const chamado = rows[0];

  if (!chamado) {
    throw new AppError('Chamado não encontrado.', 404, 'CHAMADO_NAO_ENCONTRADO');
  }

  const podeVer =
    usuario.perfil === 'administrador' ||
    usuario.perfil === 'gestor' ||
    chamado.solicitante_id === usuario.id ||
    chamado.tecnico_id === usuario.id;

  if (!podeVer) {
    throw new AppError('Você não tem acesso a este chamado.', 403, 'ACESSO_NEGADO');
  }

  const historico = await pool.query(
    'SELECT * FROM historico_chamado WHERE chamado_id = $1 ORDER BY data',
    [id]
  );

  return { ...chamado, historico: historico.rows };
}

async function atribuir(id, { tecnico_id, equipe_id }, usuario) {
  if (!['administrador', 'gestor'].includes(usuario.perfil)) {
    throw new AppError('Apenas gestores ou administradores podem atribuir chamados.', 403, 'ACESSO_NEGADO');
  }

  return transacao(async (client) => {
    const chamado = await bloquearChamado(client, id);
    validarTransicao(chamado.estado, 'atribuido');

    const { rows } = await client.query(
      `UPDATE chamado SET tecnico_id = $1, equipe_id = $2, estado = 'atribuido'
       WHERE id = $3 RETURNING *`,
      [tecnico_id || null, equipe_id || null, id]
    );

    await registrarHistorico(
      client,
      id,
      usuario.id,
      chamado.estado,
      'atribuido',
      'Chamado atribuído a técnico/equipe.'
    );

    if (tecnico_id) {
      await client.query(
        `INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem)
         VALUES ($1, $2, 'atribuicao', $3)`,
        [tecnico_id, id, `Você foi designado para o chamado ${chamado.protocolo}.`]
      );
    }

    return rows[0];
  });
}

async function mudarEstado(id, { estado: novoEstado, observacao }, usuario) {
  return transacao(async (client) => {
    const chamado = await bloquearChamado(client, id);

    const podeAlterar =
      usuario.perfil === 'administrador' ||
      usuario.perfil === 'gestor' ||
      chamado.tecnico_id === usuario.id;

    if (!podeAlterar) {
      throw new AppError('Você não tem permissão para alterar o estado deste chamado.', 403, 'ACESSO_NEGADO');
    }

    validarTransicao(chamado.estado, novoEstado);

    const campos = ['estado = $1'];
    const params = [novoEstado];

    if (novoEstado === 'aguardando_material') {
      campos.push('aguardando_material_desde = now()');
    }

    if (chamado.estado === 'aguardando_material' && novoEstado !== 'aguardando_material') {
      campos.push(
        "tempo_suspenso_total = tempo_suspenso_total + COALESCE(now() - aguardando_material_desde, '0 seconds')"
      );
      campos.push('aguardando_material_desde = NULL');
    }

    if (novoEstado === 'concluido') {
      campos.push('data_conclusao = now()');
    }

    params.push(id);
    const { rows } = await client.query(
      `UPDATE chamado SET ${campos.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    await registrarHistorico(client, id, usuario.id, chamado.estado, novoEstado, observacao);

    await client.query(
      `INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem)
       VALUES ($1, $2, $3, $4)`,
      [
        chamado.solicitante_id,
        id,
        novoEstado === 'concluido' ? 'conclusao' : 'mudanca_estado',
        `O chamado ${chamado.protocolo} mudou de estado: ${chamado.estado} → ${novoEstado}.`,
      ]
    );

    return rows[0];
  });
}

async function avaliar(id, { nota, comentario }, usuario) {
  const chamado = await buscarChamadoBruto(id);

  if (chamado.solicitante_id !== usuario.id) {
    throw new AppError('Apenas o solicitante pode avaliar este chamado.', 403, 'ACESSO_NEGADO');
  }
  if (chamado.estado !== 'concluido') {
    throw new AppError('Só é possível avaliar chamados concluídos.', 409, 'ESTADO_INVALIDO');
  }

  const { rows } = await pool.query(
    `INSERT INTO avaliacao (chamado_id, nota, comentario) VALUES ($1, $2, $3)
     ON CONFLICT (chamado_id) DO UPDATE SET nota = EXCLUDED.nota, comentario = EXCLUDED.comentario
     RETURNING *`,
    [id, nota, comentario || null]
  );

  return rows[0];
}

function validarTransicao(estadoAtual, novoEstado) {
  const permitidos = TRANSICOES[estadoAtual] || [];
  if (!permitidos.includes(novoEstado)) {
    throw new AppError(
      `Transição de estado inválida: "${estadoAtual}" → "${novoEstado}".`,
      409,
      'TRANSICAO_INVALIDA'
    );
  }
}

async function registrarHistorico(client, chamadoId, usuarioId, estadoAnterior, estadoNovo, observacao) {
  await client.query(
    `INSERT INTO historico_chamado (chamado_id, usuario_id, estado_anterior, estado_novo, observacao)
     VALUES ($1, $2, $3, $4, $5)`,
    [chamadoId, usuarioId, estadoAnterior, estadoNovo, observacao || null]
  );
}

// Lê o chamado já travando a linha: sem isso, duas mudanças de estado
// simultâneas leem o mesmo estado atual e ambas passam na validação de
// transição, gravando um histórico incoerente.
async function bloquearChamado(client, id) {
  const { rows } = await client.query('SELECT * FROM chamado WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) {
    throw new AppError('Chamado não encontrado.', 404, 'CHAMADO_NAO_ENCONTRADO');
  }
  return rows[0];
}

async function buscarChamadoBruto(id) {
  const { rows } = await pool.query('SELECT * FROM chamado WHERE id = $1', [id]);
  if (!rows[0]) {
    throw new AppError('Chamado não encontrado.', 404, 'CHAMADO_NAO_ENCONTRADO');
  }
  return rows[0];
}

module.exports = { criar, listar, buscarPorId, atribuir, mudarEstado, avaliar };

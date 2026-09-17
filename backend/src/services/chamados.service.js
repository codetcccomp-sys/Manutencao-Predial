const pool = require('../config/db');
const { transacao } = require('../config/transacao');
const { AppError } = require('../middlewares/errorHandler');
const { gerarProtocolo } = require('../utils/protocolo');
const notificacoesService = require('./notificacoes.service');
const slaService = require('./sla.service');
const priorizacaoService = require('./priorizacao.service');

// "Em atraso" não é um estado da máquina, é uma leitura do relógio sobre o
// estado atual: vira e desvira sozinho quando o prazo passa ou quando o
// chamado é concluído. Como estado, precisaria de transições para dentro e
// para fora de todos os outros e ainda assim ficaria desatualizado entre uma
// escrita e outra.
const EM_ATRASO = `(
  estado NOT IN ('concluido', 'cancelado')
  AND prazo_estimado IS NOT NULL
  AND now() > prazo_estimado
)`;

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
    // O prazo nasce junto do chamado, na mesma transação: um chamado sem
    // prazo ficaria invisível para toda a apuração de atraso.
    const prazoHoras = await slaService.calcularPrazo(client, prioridade);

    const { rows } = await client.query(
      `INSERT INTO chamado (protocolo, titulo, descricao, categoria_id, local_id, solicitante_id, prioridade, prazo_estimado)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::prioridade_chamado, 'baixa'),
               CASE WHEN $8::int IS NULL THEN NULL ELSE now() + ($8::int * interval '1 hour') END)
       RETURNING *, ${EM_ATRASO} AS em_atraso`,
      [protocolo, titulo, descricao, categoria_id, local_id, solicitanteId, prioridade, prazoHoras]
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
  if (filtros.atrasados === 'true') {
    condicoes.push(EM_ATRASO);
  }

  const { pagina, limite } = normalizarPaginacao(filtros);
  const offset = (pagina - 1) * limite;

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  // count(*) OVER () traz o total junto com a página, numa varredura só, em
  // vez de repetir o mesmo WHERE num SELECT count separado.
  params.push(limite, offset);
  const { rows } = await pool.query(
    `SELECT *, ${EM_ATRASO} AS em_atraso, count(*) OVER () AS total_registros
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

/**
 * Quem enxerga o chamado: gestão vê todos; solicitante vê o que abriu;
 * técnico vê o que lhe foi designado. Usado também por anexos e materiais,
 * para que as rotas filhas não reimplementem (e não divirjam d)essa regra.
 */
async function garantirLeitura(id, usuario) {
  const chamado = await buscarChamadoBruto(id);

  const podeVer =
    usuario.perfil === 'administrador' ||
    usuario.perfil === 'gestor' ||
    chamado.solicitante_id === usuario.id ||
    chamado.tecnico_id === usuario.id;

  if (!podeVer) {
    throw new AppError('Você não tem acesso a este chamado.', 403, 'ACESSO_NEGADO');
  }

  return chamado;
}

/**
 * Quem registra execução (material consumido) no chamado: a gestão e o
 * técnico designado. O solicitante enxerga o chamado, mas não executa nele.
 */
async function garantirExecucao(id, usuario) {
  const chamado = await buscarChamadoBruto(id);

  const podeExecutar =
    usuario.perfil === 'administrador' ||
    usuario.perfil === 'gestor' ||
    chamado.tecnico_id === usuario.id;

  if (!podeExecutar) {
    throw new AppError(
      'Apenas a gestão ou o técnico designado podem registrar execução neste chamado.',
      403,
      'ACESSO_NEGADO'
    );
  }

  return chamado;
}

async function buscarPorId(id, usuario) {
  const chamado = await garantirLeitura(id, usuario);

  const historico = await pool.query(
    'SELECT * FROM historico_chamado WHERE chamado_id = $1 ORDER BY data',
    [id]
  );

  return { ...chamado, historico: historico.rows };
}

// Estados em que o chamado já tem responsável: atribuir de novo aqui é
// reatribuição, não a primeira distribuição.
const ESTADOS_COM_RESPONSAVEL = ['atribuido', 'em_andamento', 'aguardando_material'];

async function atribuir(id, { tecnico_id, equipe_id, justificativa }, usuario) {
  if (!['administrador', 'gestor'].includes(usuario.perfil)) {
    throw new AppError('Apenas gestores ou administradores podem atribuir chamados.', 403, 'ACESSO_NEGADO');
  }

  const { chamado, notificacaoId } = await transacao(async (client) => {
    const atual = await bloquearChamado(client, id);

    // RF05: reatribuir mantém o estado e exige justificativa. Antes, como só
    // existia a transição "em triagem → atribuído", trocar o técnico de um
    // chamado já distribuído era simplesmente impossível — e a alternativa
    // na prática era cancelar e reabrir outro, perdendo o histórico.
    const ehReatribuicao = ESTADOS_COM_RESPONSAVEL.includes(atual.estado);

    if (ehReatribuicao) {
      if (!justificativa || justificativa.trim().length < 10) {
        throw new AppError(
          'Reatribuir um chamado já distribuído exige justificativa de ao menos 10 caracteres.',
          422,
          'JUSTIFICATIVA_OBRIGATORIA'
        );
      }
      if (tecnico_id && tecnico_id === atual.tecnico_id) {
        throw new AppError('O chamado já está atribuído a este técnico.', 409, 'SEM_MUDANCA');
      }
    } else {
      validarTransicao(atual.estado, 'atribuido');
    }

    const novoEstado = ehReatribuicao ? atual.estado : 'atribuido';

    const { rows } = await client.query(
      `UPDATE chamado SET tecnico_id = $1, equipe_id = $2, estado = $3::estado_chamado
       WHERE id = $4 RETURNING *, ${EM_ATRASO} AS em_atraso`,
      [tecnico_id || null, equipe_id || null, novoEstado, id]
    );

    await registrarHistorico(
      client,
      id,
      usuario.id,
      atual.estado,
      novoEstado,
      ehReatribuicao
        ? `Chamado reatribuído. Justificativa: ${justificativa.trim()}`
        : 'Chamado atribuído a técnico/equipe.'
    );

    let notificacao;
    if (tecnico_id) {
      notificacao = await client.query(
        `INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem)
         VALUES ($1, $2, 'atribuicao', $3) RETURNING id`,
        [tecnico_id, id, `Você foi designado para o chamado ${atual.protocolo}.`]
      );
    }

    return { chamado: rows[0], notificacaoId: notificacao?.rows[0]?.id };
  });

  // Fora da transação: enquanto ela está aberta a notificação ainda pode
  // sumir num rollback, e avisar sobre algo que não aconteceu é pior que
  // não avisar.
  await notificacoesService.despacharVarios([notificacaoId]);

  return chamado;
}

async function mudarEstado(id, { estado: novoEstado, observacao, servico_realizado }, usuario) {
  const { atualizado, notificacaoId } = await transacao(async (client) => {
    const chamado = await bloquearChamado(client, id);

    const podeAlterar =
      usuario.perfil === 'administrador' ||
      usuario.perfil === 'gestor' ||
      chamado.tecnico_id === usuario.id;

    if (!podeAlterar) {
      throw new AppError('Você não tem permissão para alterar o estado deste chamado.', 403, 'ACESSO_NEGADO');
    }

    validarTransicao(chamado.estado, novoEstado);

    // O §2.4 autoriza cancelar a partir de aberto, em triagem e atribuído.
    // Cancelar um serviço já em execução é exceção administrativa, que o
    // mesmo parágrafo permite desde que registrada e justificada — daí
    // manter a transição e cobrar o motivo, em vez de proibir e empurrar a
    // gestão para uma gambiarra fora do sistema.
    if (novoEstado === 'cancelado' && ESTADOS_COM_RESPONSAVEL.slice(1).includes(chamado.estado)) {
      if (!observacao || observacao.trim().length < 10) {
        throw new AppError(
          'Cancelar um chamado já em execução é exceção administrativa e exige justificativa de ao menos 10 caracteres.',
          422,
          'JUSTIFICATIVA_OBRIGATORIA'
        );
      }
    }

    const campos = ['estado = $1'];
    const params = [novoEstado];

    if (novoEstado === 'aguardando_material') {
      campos.push('aguardando_material_desde = now()');
    }

    // Início efetivo da execução (§2.6). COALESCE porque voltar de
    // "aguardando material" é retomar, não recomeçar: sobrescrever aqui
    // encolheria o "tempo até atendimento" a cada espera por insumo.
    if (novoEstado === 'em_andamento') {
      campos.push('inicio_execucao = COALESCE(inicio_execucao, now())');
    }

    if (novoEstado === 'concluido') {
      // RN07: sem descrição do serviço não há conclusão. A validação fica
      // aqui, e não só na rota, porque é regra de negócio — vale para
      // qualquer caminho que chegue a este serviço.
      if (!servico_realizado || servico_realizado.trim().length < 10) {
        throw new AppError(
          'A conclusão exige a descrição do serviço executado (ao menos 10 caracteres).',
          422,
          'SERVICO_OBRIGATORIO'
        );
      }
      params.push(servico_realizado.trim());
      campos.push(`servico_realizado = $${params.length}`);
      campos.push('data_conclusao = now()');
    }

    if (chamado.estado === 'aguardando_material' && novoEstado !== 'aguardando_material') {
      campos.push(
        "tempo_suspenso_total = tempo_suspenso_total + COALESCE(now() - aguardando_material_desde, '0 seconds')"
      );
      campos.push('aguardando_material_desde = NULL');
      // O prazo anda junto com a suspensão. Espera por insumo é falha de
      // suprimento, não da equipe de campo: descontar o tempo da métrica de
      // atendimento (como os relatórios já fazem) e ainda assim deixar o
      // relógio do prazo correndo seria cobrar duas coisas incoerentes.
      campos.push(
        "prazo_estimado = prazo_estimado + COALESCE(now() - aguardando_material_desde, '0 seconds')"
      );
    }

    params.push(id);
    const { rows } = await client.query(
      `UPDATE chamado SET ${campos.join(', ')} WHERE id = $${params.length} RETURNING *, ${EM_ATRASO} AS em_atraso`,
      params
    );

    await registrarHistorico(client, id, usuario.id, chamado.estado, novoEstado, observacao);

    const notificacao = await client.query(
      `INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        chamado.solicitante_id,
        id,
        novoEstado === 'concluido' ? 'conclusao' : 'mudanca_estado',
        `O chamado ${chamado.protocolo} mudou de estado: ${chamado.estado} → ${novoEstado}.`,
      ]
    );

    return { atualizado: rows[0], notificacaoId: notificacao.rows[0].id };
  });

  await notificacoesService.despacharVarios([notificacaoId]);

  return atualizado;
}

/**
 * Registra os fatores de priorização e define a prioridade do chamado (RF04).
 *
 * A sugestão vem da regra vigente; o gestor pode discordar, mas aí precisa
 * dizer por quê (§2.5). A justificativa é o que transforma uma exceção em
 * decisão auditável em vez de preferência pessoal.
 */
async function priorizar(id, { urgencia, impacto, risco, prioridade, justificativa }, usuario) {
  priorizacaoService.validarFatores({ urgencia, impacto, risco });

  const resultado = await transacao(async (client) => {
    const chamado = await bloquearChamado(client, id);

    if (['concluido', 'cancelado'].includes(chamado.estado)) {
      throw new AppError(
        'Não é possível repriorizar um chamado concluído ou cancelado.',
        409,
        'ESTADO_INVALIDO'
      );
    }

    const regra = await priorizacaoService.regraVigente(client);
    const sugestao = priorizacaoService.calcular({ urgencia, impacto, risco }, regra);
    const escolhida = prioridade || sugestao.prioridade;
    const divergiu = escolhida !== sugestao.prioridade;

    if (divergiu && (!justificativa || justificativa.trim().length < 10)) {
      throw new AppError(
        `A prioridade sugerida é "${sugestao.prioridade}". Para registrar "${escolhida}" é necessária uma justificativa de ao menos 10 caracteres.`,
        422,
        'JUSTIFICATIVA_OBRIGATORIA'
      );
    }

    // O prazo acompanha a prioridade: mudar a classificação sem mudar o prazo
    // deixaria um chamado crítico com o relógio de um chamado baixo. A conta
    // parte da abertura e devolve o tempo já suspenso, para não consumir
    // prazo com espera por insumo.
    const prazoHoras = await slaService.calcularPrazo(client, escolhida);

    const { rows } = await client.query(
      `UPDATE chamado SET
         urgencia = $1, impacto = $2, risco = $3,
         prioridade_sugerida = $4::prioridade_chamado,
         prioridade = $5::prioridade_chamado,
         prioridade_justificativa = $6,
         regra_priorizacao_id = $7,
         priorizado_em = now(),
         priorizado_por = $8,
         prazo_estimado = CASE
           WHEN $9::int IS NULL THEN prazo_estimado
           ELSE data_abertura + ($9::int * interval '1 hour') + tempo_suspenso_total
         END
       WHERE id = $10
       RETURNING *, ${EM_ATRASO} AS em_atraso`,
      [
        urgencia,
        impacto,
        risco,
        sugestao.prioridade,
        escolhida,
        divergiu ? justificativa.trim() : null,
        regra.id,
        usuario.id,
        prazoHoras,
        id,
      ]
    );

    const observacao = divergiu
      ? `Priorização: ${sugestao.motivo} Gestor registrou "${escolhida}". Justificativa: ${justificativa.trim()}`
      : `Priorização: ${sugestao.motivo}`;

    // Sem estado_novo próprio: priorizar não move o chamado no fluxo, mas é
    // uma alteração relevante e a RN05 exige que fique registrada.
    await registrarHistorico(client, id, usuario.id, chamado.estado, chamado.estado, observacao);

    return { chamado: rows[0], sugestao, prioridade_anterior: chamado.prioridade };
  });

  return resultado;
}

/**
 * Registra o que foi apurado e executado no chamado (RF07).
 *
 * Separado da mudança de estado porque diagnóstico e tempo empregado são
 * preenchidos ao longo do atendimento, não num instante de transição: o
 * técnico anota o diagnóstico ao chegar e ajusta o tempo conforme trabalha.
 */
async function registrarExecucao(id, { diagnostico, tempo_empregado_minutos }, usuario) {
  const chamado = await garantirExecucao(id, usuario);

  if (['concluido', 'cancelado'].includes(chamado.estado)) {
    throw new AppError(
      'Não é possível registrar execução em chamado concluído ou cancelado.',
      409,
      'ESTADO_INVALIDO'
    );
  }

  const campos = [];
  const params = [];

  if (diagnostico !== undefined) {
    params.push(diagnostico);
    campos.push(`diagnostico = $${params.length}`);
  }
  if (tempo_empregado_minutos !== undefined) {
    params.push(tempo_empregado_minutos);
    campos.push(`tempo_empregado_minutos = $${params.length}`);
  }

  if (campos.length === 0) {
    throw new AppError('Informe diagnóstico ou tempo empregado.', 422, 'NADA_A_ATUALIZAR');
  }

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE chamado SET ${campos.join(', ')} WHERE id = $${params.length}
     RETURNING *, ${EM_ATRASO} AS em_atraso`,
    params
  );

  return rows[0];
}

// RN09: janela de reabertura contada a partir da conclusão.
const HORAS_PARA_REABRIR = 48;

/**
 * Reabre um chamado concluído, iniciando novo ciclo de atendimento (RN09).
 *
 * Endpoint próprio, e não mais uma transição em mudarEstado, porque as regras
 * são outras: quem pode é o solicitante ou a gestão (não o técnico), há
 * janela de tempo, a justificativa é obrigatória e há estado a reiniciar.
 */
async function reabrir(id, { justificativa }, usuario) {
  if (!justificativa || justificativa.trim().length < 10) {
    throw new AppError(
      'A reabertura exige justificativa de ao menos 10 caracteres.',
      422,
      'JUSTIFICATIVA_OBRIGATORIA'
    );
  }

  const { chamado, notificacaoId } = await transacao(async (client) => {
    const atual = await bloquearChamado(client, id);

    if (atual.estado !== 'concluido') {
      throw new AppError('Apenas chamados concluídos podem ser reabertos.', 409, 'ESTADO_INVALIDO');
    }

    const ehGestao = ['administrador', 'gestor'].includes(usuario.perfil);
    if (!ehGestao && atual.solicitante_id !== usuario.id) {
      throw new AppError(
        'Apenas o solicitante do chamado ou a gestão podem reabri-lo.',
        403,
        'ACESSO_NEGADO'
      );
    }

    const horasDesdeConclusao =
      (Date.now() - new Date(atual.data_conclusao).getTime()) / 3_600_000;
    if (horasDesdeConclusao > HORAS_PARA_REABRIR) {
      throw new AppError(
        `A janela de ${HORAS_PARA_REABRIR} horas para reabertura expirou. Abra um novo chamado referenciando o protocolo ${atual.protocolo}.`,
        409,
        'JANELA_EXPIRADA'
      );
    }

    // O prazo do ciclo anterior já foi gasto; o novo ciclo recebe prazo
    // próprio contado a partir de agora. O que sinaliza a falha do primeiro
    // atendimento é a contagem de reaberturas, não um prazo vencido herdado.
    const prazoHoras = await slaService.calcularPrazo(client, atual.prioridade);

    const { rows } = await client.query(
      `UPDATE chamado SET
         estado = 'em_triagem',
         data_conclusao = NULL,
         -- A descrição do serviço vai para o histórico e sai do chamado: o
         -- novo ciclo precisa da sua própria, e mantê-la aqui deixaria a
         -- conclusão seguinte passar pela RN07 com texto do ciclo anterior.
         servico_realizado = NULL,
         total_reaberturas = total_reaberturas + 1,
         reaberto_em = now(),
         inicio_execucao = NULL,
         prazo_estimado = CASE
           WHEN $1::int IS NULL THEN NULL
           ELSE now() + ($1::int * interval '1 hour')
         END
       WHERE id = $2
       RETURNING *, ${EM_ATRASO} AS em_atraso`,
      [prazoHoras, id]
    );

    await registrarHistorico(
      client,
      id,
      usuario.id,
      'concluido',
      'em_triagem',
      `Chamado reaberto (ciclo ${rows[0].total_reaberturas + 1}). Justificativa: ${justificativa.trim()}` +
        (atual.servico_realizado ? ` | Serviço registrado no ciclo anterior: ${atual.servico_realizado}` : '')
    );

    // Avisa quem atendeu, que é quem precisa saber que o serviço voltou.
    let notificacao;
    if (atual.tecnico_id) {
      notificacao = await client.query(
        `INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem)
         VALUES ($1, $2, 'reabertura', $3) RETURNING id`,
        [
          atual.tecnico_id,
          id,
          `O chamado ${atual.protocolo} foi reaberto: ${justificativa.trim()}`,
        ]
      );
    }

    return { chamado: rows[0], notificacaoId: notificacao?.rows[0]?.id };
  });

  await notificacoesService.despacharVarios([notificacaoId]);

  return chamado;
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
  const { rows } = await pool.query(
    `SELECT *, ${EM_ATRASO} AS em_atraso FROM chamado WHERE id = $1`,
    [id]
  );
  if (!rows[0]) {
    throw new AppError('Chamado não encontrado.', 404, 'CHAMADO_NAO_ENCONTRADO');
  }
  return rows[0];
}

module.exports = {
  criar,
  listar,
  buscarPorId,
  atribuir,
  mudarEstado,
  avaliar,
  priorizar,
  registrarExecucao,
  reabrir,
  garantirLeitura,
  garantirExecucao,
};

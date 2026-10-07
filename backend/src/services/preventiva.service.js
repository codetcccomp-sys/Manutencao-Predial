const pool = require('../config/db');
const { transacao } = require('../config/transacao');
const { AppError } = require('../middlewares/errorHandler');
const { gerarProtocolo } = require('../utils/protocolo');
const notificacoesService = require('./notificacoes.service');
const equipamentosService = require('./equipamentos.service');
const { rotuloSql } = require('./locais.service');

/**
 * Manutenção preventiva (NBR 5674): planos que geram chamados sozinhos.
 *
 * O chamado gerado é um chamado comum — mesma máquina de estados, mesma
 * conclusão com o serviço descrito (RN07), mesmo histórico. O que muda é a
 * origem, o plano de onde veio e a data em que o plano previa o serviço.
 */

const FUSO = process.env.FUSO_HORARIO || 'America/Sao_Paulo';

// O dia de hoje no fuso da instituição. A tarefa roda num servidor em UTC: às
// 22h de Brasília já é "amanhã" lá, e um plano para amanhã seria gerado com
// a antecedência de um dia a menos.
const hojeNoFuso = () => new Date().toLocaleDateString('en-CA', { timeZone: FUSO });

// Teto de planos por execução da tarefa, pelo mesmo motivo da varredura de
// atrasos: a tarefa roda numa função serverless com limite de tempo. O que
// não couber fica para a próxima passagem — o plano continua vencendo.
const MAXIMO_PLANOS = 100;

// Até quantos períodos para trás a conta procura. Um plano diário parado há
// mais de dez anos é um plano que ninguém usa; o teto existe para a série de
// datas nunca virar uma consulta sem fim.
const MAXIMO_PERIODOS = 5000;

const UNIDADES = ['dia', 'semana', 'mes', 'ano'];

const ROTULO_UNIDADE = {
  dia: ['dia', 'dias'],
  semana: ['semana', 'semanas'],
  mes: ['mês', 'meses'],
  ano: ['ano', 'anos'],
};

function descreverPeriodicidade(quantidade, unidade) {
  const [singular, plural] = ROTULO_UNIDADE[unidade];
  return quantidade === 1 ? `a cada ${singular}` : `a cada ${quantidade} ${plural}`;
}

// ---------------------------------------------------------------------------
// Cadastro de planos
// ---------------------------------------------------------------------------

const SELECAO = `
  SELECT p.*,
         ${rotuloSql('l')} AS local_rotulo,
         cat.nome AS categoria_nome,
         e.codigo AS equipamento_codigo,
         e.nome AS equipamento_nome,
         t.nome AS tecnico_nome,
         ult.id AS ultimo_chamado_id,
         ult.protocolo AS ultimo_chamado_protocolo,
         ult.estado AS ultimo_chamado_estado,
         ult.data_prevista AS ultimo_chamado_data_prevista
    FROM plano_preventivo p
    JOIN local l ON l.id = p.local_id
    JOIN categoria cat ON cat.id = p.categoria_id
    LEFT JOIN equipamento e ON e.id = p.equipamento_id
    LEFT JOIN usuario t ON t.id = p.tecnico_id
    LEFT JOIN LATERAL (
      SELECT id, protocolo, estado, data_prevista
        FROM chamado
       WHERE plano_id = p.id
       ORDER BY data_prevista DESC
       LIMIT 1
    ) ult ON TRUE`;

async function listar({ incluirInativos = false, equipamentoId } = {}) {
  const condicoes = [];
  const params = [];
  if (!incluirInativos) condicoes.push('p.ativo');
  if (equipamentoId) {
    params.push(equipamentoId);
    condicoes.push(`p.equipamento_id = $${params.length}`);
  }

  const { rows } = await pool.query(
    `${SELECAO}
     ${condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''}
     ORDER BY p.ativo DESC, p.proxima_execucao, p.titulo`,
    params
  );
  return rows;
}

async function buscar(id, client = pool) {
  const { rows } = await client.query(`${SELECAO} WHERE p.id = $1`, [id]);
  if (!rows[0]) {
    throw new AppError('Plano preventivo não encontrado.', 404, 'PLANO_NAO_ENCONTRADO');
  }
  return rows[0];
}

async function conferirTecnico(client, tecnicoId) {
  if (tecnicoId === null || tecnicoId === undefined) return;
  const { rows } = await client.query(
    "SELECT 1 FROM usuario WHERE id = $1 AND perfil = 'tecnico' AND ativo AND anonimizado_em IS NULL",
    [tecnicoId]
  );
  if (!rows[0]) {
    throw new AppError('O responsável do plano precisa ser um técnico ativo.', 422, 'TECNICO_INVALIDO');
  }
}

function conferirPeriodicidade({ repetir_a_cada: quantidade, unidade_repeticao: unidade }) {
  if (quantidade !== undefined && (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 366)) {
    throw new AppError('"repetir_a_cada" deve ser um inteiro de 1 a 366.', 422, 'VALIDACAO');
  }
  if (unidade !== undefined && !UNIDADES.includes(unidade)) {
    throw new AppError(`"unidade_repeticao" deve ser um de: ${UNIDADES.join(', ')}.`, 422, 'VALIDACAO');
  }
}

function conferirData(campo, valor) {
  if (valor !== undefined && !equipamentosService.ehData(valor)) {
    throw new AppError(`"${campo}" deve ser uma data no formato AAAA-MM-DD.`, 422, 'VALIDACAO');
  }
}

/**
 * Local e categoria efetivos do plano.
 *
 * Com equipamento, os dois vêm dele quando não informados — e, quando
 * informados, o local precisa ser o dele (mesma regra do chamado).
 */
async function resolverAlvo(client, { equipamento_id, local_id, categoria_id }) {
  if (equipamento_id) {
    const equipamento = await equipamentosService.conferirNoLocal(client, equipamento_id, local_id);
    return {
      equipamento_id,
      local_id: equipamento.local_id,
      categoria_id: categoria_id ?? equipamento.categoria_id,
    };
  }
  if (!local_id || !categoria_id) {
    throw new AppError(
      'Informe o equipamento, ou o local e a categoria do serviço.',
      422,
      'VALIDACAO'
    );
  }
  return { equipamento_id: null, local_id, categoria_id };
}

async function criar(dados, usuario) {
  conferirPeriodicidade(dados);
  conferirData('proxima_execucao', dados.proxima_execucao);

  return transacao(async (client) => {
    const alvo = await resolverAlvo(client, dados);
    await conferirTecnico(client, dados.tecnico_id);

    let rows;
    try {
      ({ rows } = await client.query(
        `INSERT INTO plano_preventivo
           (titulo, descricao, equipamento_id, local_id, categoria_id, prioridade,
            repetir_a_cada, unidade_repeticao, data_inicio, proxima_execucao,
            antecedencia_dias, tecnico_id, criado_por)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::prioridade_chamado, 'media'),
                 $7, $8, $9, $9, COALESCE($10, 0), $11, $12)
         RETURNING id`,
        [
          dados.titulo.trim(),
          dados.descricao.trim(),
          alvo.equipamento_id,
          alvo.local_id,
          alvo.categoria_id,
          dados.prioridade,
          dados.repetir_a_cada,
          dados.unidade_repeticao,
          dados.proxima_execucao,
          dados.antecedencia_dias,
          dados.tecnico_id ?? null,
          usuario.id,
        ]
      ));
    } catch (err) {
      if (err.code === '23503') {
        throw new AppError('Local ou categoria inexistente.', 422, 'REFERENCIA_INVALIDA');
      }
      throw err;
    }

    return buscar(rows[0].id, client);
  });
}

const CAMPOS_SIMPLES = ['titulo', 'descricao', 'prioridade', 'antecedencia_dias', 'tecnico_id', 'ativo'];

/**
 * Altera o plano.
 *
 * Mudar a periodicidade ou a próxima data reancora o calendário na nova
 * próxima data: "a partir de agora, a cada 6 meses, começando em 10/03" é o
 * que quem editou quis dizer, e não "a cada 6 meses contados de quando o
 * plano foi criado".
 */
async function atualizar(id, dados) {
  conferirPeriodicidade(dados);
  conferirData('proxima_execucao', dados.proxima_execucao);
  if (dados.ativo !== undefined && typeof dados.ativo !== 'boolean') {
    throw new AppError('"ativo" deve ser verdadeiro ou falso.', 422, 'VALIDACAO');
  }

  return transacao(async (client) => {
    const { rows: atuais } = await client.query(
      'SELECT * FROM plano_preventivo WHERE id = $1 FOR UPDATE',
      [id]
    );
    const atual = atuais[0];
    if (!atual) {
      throw new AppError('Plano preventivo não encontrado.', 404, 'PLANO_NAO_ENCONTRADO');
    }

    const campos = [];
    const params = [];
    const definir = (coluna, valor) => {
      params.push(valor);
      campos.push(`${coluna} = $${params.length}`);
    };

    for (const campo of CAMPOS_SIMPLES) {
      if (dados[campo] === undefined) continue;
      const valor = typeof dados[campo] === 'string' ? dados[campo].trim() : dados[campo];
      definir(campo, valor);
    }
    if (dados.tecnico_id !== undefined) await conferirTecnico(client, dados.tecnico_id);

    if (['equipamento_id', 'local_id', 'categoria_id'].some((c) => dados[c] !== undefined)) {
      const alvo = await resolverAlvo(client, {
        equipamento_id: dados.equipamento_id !== undefined ? dados.equipamento_id : atual.equipamento_id,
        // Trocar o equipamento sem dizer o local leva o local do equipamento
        // novo; manter o antigo daria "equipamento fora do local".
        local_id:
          dados.local_id !== undefined
            ? dados.local_id
            : dados.equipamento_id
              ? undefined
              : atual.local_id,
        categoria_id: dados.categoria_id !== undefined ? dados.categoria_id : atual.categoria_id,
      });
      definir('equipamento_id', alvo.equipamento_id);
      definir('local_id', alvo.local_id);
      definir('categoria_id', alvo.categoria_id);
    }

    const mudouCalendario = ['repetir_a_cada', 'unidade_repeticao', 'proxima_execucao'].some(
      (c) => dados[c] !== undefined
    );
    if (mudouCalendario) {
      const proxima = dados.proxima_execucao ?? atual.proxima_execucao;
      if (dados.repetir_a_cada !== undefined) definir('repetir_a_cada', dados.repetir_a_cada);
      if (dados.unidade_repeticao !== undefined) definir('unidade_repeticao', dados.unidade_repeticao);
      definir('data_inicio', proxima);
      definir('proxima_execucao', proxima);
    }

    if (campos.length === 0) {
      throw new AppError('Informe ao menos um campo para atualizar.', 422, 'NADA_A_ATUALIZAR');
    }

    params.push(id);
    await client.query(
      `UPDATE plano_preventivo SET ${campos.join(', ')} WHERE id = $${params.length}`,
      params
    );

    return buscar(id, client);
  });
}

// ---------------------------------------------------------------------------
// Geração dos chamados
// ---------------------------------------------------------------------------

/**
 * Onde o plano está no próprio calendário, visto do dia `hoje`.
 *
 * As execuções são `data_inicio + n períodos`. Interessam as que ainda não
 * foram geradas (a partir de `proxima_execucao`) e que já entraram na janela
 * de antecedência. Delas, só a MAIS RECENTE vira chamado: se o agendador
 * ficou parado três meses, um plano semanal teria doze execuções vencidas, e
 * doze chamados iguais de uma vez seriam doze avisos para o mesmo serviço — o
 * que o técnico precisa é de um chamado para fazer a verificação agora. As
 * puladas ficam contadas, e o histórico do chamado diz quantas foram.
 */
async function situacaoNoCalendario(client, plano, hoje, { forcar = false } = {}) {
  const { rows } = await client.query(
    `WITH serie AS (
       SELECT ($1::date + n * passo_preventivo($2, $3))::date AS data
         FROM generate_series(0, $7::int) AS n
     )
     SELECT
       (SELECT max(data) FROM serie
         WHERE data >= $4::date AND (data - $5::int) <= $6::date)                 AS gerar_para,
       (SELECT count(*)::int FROM serie
         WHERE data >= $4::date AND (data - $5::int) <= $6::date)                 AS vencidas,
       (SELECT min(data) FROM serie WHERE data > $4::date)                        AS seguinte_a_proxima,
       (SELECT min(data) FROM serie
         WHERE data >= $4::date AND (data - $5::int) > $6::date)                  AS nova_proxima`,
    [
      plano.data_inicio,
      plano.repetir_a_cada,
      plano.unidade_repeticao,
      plano.proxima_execucao,
      plano.antecedencia_dias,
      hoje,
      MAXIMO_PERIODOS,
    ]
  );
  const s = rows[0];

  // "Gerar agora": a próxima execução sai já, sem esperar a antecedência, e o
  // plano avança um período.
  if (forcar && !s.gerar_para) {
    return { gerarPara: fmt(plano.proxima_execucao), vencidas: 1, novaProxima: fmt(s.seguinte_a_proxima) };
  }

  return {
    gerarPara: s.gerar_para ? fmt(s.gerar_para) : null,
    vencidas: s.vencidas,
    novaProxima: s.nova_proxima ? fmt(s.nova_proxima) : null,
  };
}

// DATE já chega como texto 'AAAA-MM-DD' (ver config/db.js).
const fmt = (data) => String(data).slice(0, 10);

async function registrarHistorico(client, chamadoId, usuarioId, anterior, novo, observacao) {
  await client.query(
    `INSERT INTO historico_chamado (chamado_id, usuario_id, estado_anterior, estado_novo, observacao)
     VALUES ($1, $2, $3, $4, $5)`,
    [chamadoId, usuarioId, anterior, novo, observacao]
  );
}

async function tecnicoDisponivel(client, tecnicoId) {
  if (!tecnicoId) return false;
  const { rows } = await client.query(
    "SELECT 1 FROM usuario WHERE id = $1 AND perfil = 'tecnico' AND ativo AND anonimizado_em IS NULL",
    [tecnicoId]
  );
  return Boolean(rows[0]);
}

/**
 * Cria o chamado de uma execução do plano e avança o calendário.
 *
 * Roda dentro da transação que travou o plano. Devolve `null` quando aquela
 * execução já tinha chamado (o índice único de plano + data recusa o segundo).
 */
async function gerarChamado(client, plano, { gerarPara, vencidas, novaProxima }) {
  // O prazo é o fim do dia previsto, no fuso da instituição: a preventiva tem
  // data marcada, e o SLA por prioridade (pensado para o imprevisto) não diz
  // nada sobre ela. Gerada com antecedência, ela simplesmente tem mais tempo.
  const { rows } = await client.query(
    `INSERT INTO chamado
       (protocolo, titulo, descricao, categoria_id, local_id, equipamento_id,
        solicitante_id, prioridade, origem, plano_id, data_prevista, prazo_estimado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'preventiva', $9, $10::date,
             (($10::date + 1)::timestamp AT TIME ZONE $11))
     ON CONFLICT (plano_id, data_prevista) WHERE plano_id IS NOT NULL DO NOTHING
     RETURNING id, protocolo`,
    [
      gerarProtocolo(),
      plano.titulo,
      plano.descricao,
      plano.categoria_id,
      plano.local_id,
      plano.equipamento_id,
      plano.criado_por,
      plano.prioridade,
      plano.id,
      gerarPara,
      FUSO,
    ]
  );

  if (novaProxima) {
    await client.query('UPDATE plano_preventivo SET proxima_execucao = $1 WHERE id = $2', [
      novaProxima,
      plano.id,
    ]);
  }

  const chamado = rows[0];
  if (!chamado) return null;

  const periodicidade = descreverPeriodicidade(plano.repetir_a_cada, plano.unidade_repeticao);
  const puladas = vencidas - 1;
  await registrarHistorico(
    client,
    chamado.id,
    plano.criado_por,
    null,
    'aberto',
    `Chamado preventivo gerado pelo plano "${plano.titulo}" (${periodicidade}), previsto para ${gerarPara}.` +
      (puladas > 0
        ? ` ${puladas} execução(ões) anterior(es) venceram sem chamado — o agendador pode ter ficado parado.`
        : '')
  );

  let notificacaoId = null;
  if (await tecnicoDisponivel(client, plano.tecnico_id)) {
    // Atribuição direta ao responsável do plano. Passa pelos mesmos estados
    // que uma atribuição manual (aberto → em triagem → atribuído), para o
    // histórico e os relatórios não verem um atalho que o fluxo não permite.
    await client.query(
      "UPDATE chamado SET estado = 'atribuido', tecnico_id = $1 WHERE id = $2",
      [plano.tecnico_id, chamado.id]
    );
    await registrarHistorico(
      client,
      chamado.id,
      plano.criado_por,
      'aberto',
      'em_triagem',
      'Triagem pelo plano: prioridade e responsável definidos no cadastro do plano.'
    );
    await registrarHistorico(
      client,
      chamado.id,
      plano.criado_por,
      'em_triagem',
      'atribuido',
      'Atribuído ao responsável do plano preventivo.'
    );
    const aviso = await client.query(
      `INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem)
       VALUES ($1, $2, 'atribuicao', $3) RETURNING id`,
      [
        plano.tecnico_id,
        chamado.id,
        `Manutenção preventiva ${chamado.protocolo}: ${plano.titulo}, prevista para ${gerarPara}.`,
      ]
    );
    notificacaoId = aviso.rows[0].id;
  }

  return { chamadoId: chamado.id, protocolo: chamado.protocolo, dataPrevista: gerarPara, notificacaoId };
}

/**
 * A tarefa agendada: gera os chamados dos planos que entraram na janela.
 *
 * Cada plano numa transação própria, travado com SKIP LOCKED: duas passagens
 * sobrepostas do agendador não processam o mesmo plano, e um plano com dado
 * ruim (um local apagado à mão, por exemplo) não impede os outros.
 */
async function gerarVencidos({ hoje = hojeNoFuso(), limite = MAXIMO_PLANOS } = {}) {
  const { rows: candidatos } = await pool.query(
    `SELECT id FROM plano_preventivo
      WHERE ativo AND (proxima_execucao - antecedencia_dias) <= $1::date
      ORDER BY proxima_execucao
      LIMIT $2`,
    [hoje, limite]
  );

  const gerados = [];
  const falhas = [];

  for (const { id } of candidatos) {
    try {
      const resultado = await transacao(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM plano_preventivo
            WHERE id = $1 AND ativo AND (proxima_execucao - antecedencia_dias) <= $2::date
            FOR UPDATE SKIP LOCKED`,
          [id, hoje]
        );
        if (!rows[0]) return null;
        const situacao = await situacaoNoCalendario(client, rows[0], hoje);
        if (!situacao.gerarPara) return null;
        return gerarChamado(client, rows[0], situacao);
      });
      if (resultado) gerados.push({ plano_id: id, ...resultado });
    } catch (err) {
      console.error(`[preventiva] plano ${id} não gerado:`, err.message);
      falhas.push(id);
    }
  }

  await notificacoesService.despacharVarios(gerados.map((g) => g.notificacaoId));

  return {
    hoje,
    planos_avaliados: candidatos.length,
    chamados_gerados: gerados.length,
    gerados: gerados.map(({ notificacaoId, ...g }) => g),
    falhas,
  };
}

/** "Gerar agora": antecipa a próxima execução de um plano. */
async function gerarAgora(id) {
  const resultado = await transacao(async (client) => {
    const { rows } = await client.query('SELECT * FROM plano_preventivo WHERE id = $1 FOR UPDATE', [id]);
    const plano = rows[0];
    if (!plano) {
      throw new AppError('Plano preventivo não encontrado.', 404, 'PLANO_NAO_ENCONTRADO');
    }
    if (!plano.ativo) {
      throw new AppError('Plano desativado não gera chamado.', 409, 'PLANO_INATIVO');
    }
    const situacao = await situacaoNoCalendario(client, plano, hojeNoFuso(), { forcar: true });
    const gerado = await gerarChamado(client, plano, situacao);
    if (!gerado) {
      throw new AppError('Esta execução do plano já tem chamado.', 409, 'JA_GERADO');
    }
    return gerado;
  });

  await notificacoesService.despacharVarios([resultado.notificacaoId]);
  const { notificacaoId, ...gerado } = resultado;
  return gerado;
}

module.exports = {
  listar,
  buscar,
  criar,
  atualizar,
  gerarVencidos,
  gerarAgora,
  descreverPeriodicidade,
  hojeNoFuso,
};

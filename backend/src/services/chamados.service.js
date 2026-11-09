const pool = require('../config/db');
const { transacao } = require('../config/transacao');
const { AppError } = require('../middlewares/errorHandler');
const { gerarProtocolo } = require('../utils/protocolo');
const notificacoesService = require('./notificacoes.service');
const priorizacaoService = require('./priorizacao.service');
const { rotuloSql } = require('./locais.service');
const equipamentosService = require('./equipamentos.service');
const distribuicaoService = require('./distribuicao.service');
const { FUSO } = require('../config/fuso');
const { MINUTOS_ATE_ATENDER_CRITICO } = require('../config/atendimento');

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

// Chamado crítico parado em `aberto` além do tempo de primeiro atendimento
// (config/atendimento.js). Também é leitura do relógio, e não estado: some
// sozinho quando alguém faz a triagem, e por isso não precisa de transição.
//
// Só corretiva: a preventiva é trabalho planejado, gerado pelo agendador com
// meses de antecedência. Uma preventiva de prioridade crítica esperando na
// fila não é uma emergência esquecida, e alertar nela ensinaria a gestão a
// ignorar o alerta que existe para a emergência de verdade.
//
// O número entra na consulta por interpolação, e não por parâmetro: é uma
// constante inteira do código (conferida abaixo), nunca valor da requisição.
if (!Number.isInteger(MINUTOS_ATE_ATENDER_CRITICO) || MINUTOS_ATE_ATENDER_CRITICO < 1) {
  throw new Error('MINUTOS_ATE_ATENDER_CRITICO deve ser um inteiro positivo.');
}
const SEM_ATENDIMENTO_CRITICO = `(
  prioridade = 'critica'
  AND origem = 'corretiva'
  AND estado = 'aberto'
  AND now() > data_abertura + interval '${MINUTOS_ATE_ATENDER_CRITICO} minutes'
)`;

// As duas leituras do relógio que acompanham todo chamado devolvido pela API.
const CALCULADOS = `${EM_ATRASO} AS em_atraso, ${SEM_ATENDIMENTO_CRITICO} AS sem_atendimento_critico`;

/**
 * Ordenações que a lista aceita.
 *
 * Mapa fechado, e não texto vindo da requisição: `ORDER BY` não aceita
 * parâmetro do driver, então qualquer trecho que chegasse de fora entraria na
 * consulta por interpolação — que é injeção de SQL pela porta que o resto do
 * código fecha com $1, $2. Nome desconhecido cai no padrão em vez de recusar:
 * ordenação errada não justifica derrubar a tela.
 *
 * `recentes` é o padrão histórico e serve para quem acompanha o que chegou.
 *
 * `prazo` existe para a fila de quem executa. A pergunta de um técnico é "o
 * que eu faço agora", e a resposta é o que está mais perto de estourar — que
 * frequentemente é o mais ANTIGO, ou seja, o último da ordenação por data.
 *
 * O `NULLS LAST` é redundante e está escrito assim de propósito: no Postgres
 * o ASC já ordena nulo por último (o padrão só muda para NULLS FIRST no DESC).
 * Escrever explícito custa nada e diz a intenção — chamado sem prazo não é
 * urgente, é indefinido, e indefinido não abre fila de trabalho. Quem for
 * inverter esta ordenação um dia herda o cuidado em vez de descobrir o padrão
 * na hora errada.
 */
// Mapa fechado pelo mesmo motivo das ordenações: o valor vem da requisição e
// vira SQL. Nome desconhecido não filtra nada.
const SITUACOES = {
  abertos: "estado NOT IN ('concluido', 'cancelado')",
  encerrados: "estado IN ('concluido', 'cancelado')",
};

const ORDENACOES = {
  recentes: 'data_abertura DESC, id DESC',
  prazo: 'prazo_estimado ASC NULLS LAST, data_abertura ASC, id ASC',
};

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

// Os sete estados do Termo (RF06), na ordem do fluxo. É a lista que o filtro da
// fila aceita: sai das chaves do mapa acima para não existir em dois lugares.
const ESTADOS = Object.keys(TRANSICOES);

/**
 * Local, categoria e equipamento efetivos de um chamado novo.
 *
 * Com equipamento, local e categoria podem vir dele — é o que permite abrir o
 * chamado pelo QR Code colado no equipamento sem perguntar onde ele fica. Se
 * vierem também, o local precisa ser o do equipamento: um chamado que diz
 * "split da 204" no equipamento e "sala 310" no local manda o técnico ao
 * lugar errado.
 */
async function resolverAlvo(client, { categoria_id, local_id, equipamento_id }) {
  if (equipamento_id) {
    const equipamento = await equipamentosService.conferirNoLocal(client, equipamento_id, local_id);
    return {
      local_id: equipamento.local_id,
      categoria_id: categoria_id ?? equipamento.categoria_id,
      equipamento_id,
    };
  }

  const faltando = [];
  if (!categoria_id) faltando.push('Campo "categoria_id" é obrigatório.');
  if (!local_id) faltando.push('Campo "local_id" é obrigatório.');
  if (faltando.length) {
    throw new AppError(faltando.join(' '), 422, 'VALIDACAO');
  }
  return { local_id, categoria_id, equipamento_id: null };
}

const ORDEM_PRIORIDADE = ['baixa', 'media', 'alta', 'critica'];
const maiorPrioridade = (a, b) => (ORDEM_PRIORIDADE.indexOf(a) >= ORDEM_PRIORIDADE.indexOf(b) ? a : b);

/**
 * A prioridade com que o chamado nasce, e por quê.
 *
 * Antes, o formulário mandava a prioridade e ela valia: vinha com "baixa" já
 * marcada, então quem não mexia no campo (um elevador parado, aberto às pressas)
 * esperava o prazo da "baixa" sem disparar o alerta de 15 minutos; e quem marcava
 * "crítica" para tudo saturava esse mesmo alerta. A regra de distribuição nunca
 * decidia a prioridade de um chamado aberto pela tela.
 *
 * Agora quem abre responde sobre a SITUAÇÃO (urgência, impacto e risco, os três
 * fatores da regra de priorização, RF04) e o servidor calcula com a regra vigente,
 * como a gestão faz na triagem. A divisão de papéis é a da boa prática de
 * atendimento: o solicitante diz o que está acontecendo, o sistema aplica o critério.
 *
 * - Gestão pode definir a prioridade direto (`prioridade`): é decisão dela.
 * - Do solicitante, `prioridade` é ignorada, e não recusada: uma aba com a versão
 *   antiga do aplicativo (o service worker a mantém) ainda a envia, e recusar
 *   impediria de abrir chamado até a página ser recarregada.
 * - A prioridade da regra de distribuição é o MÍNIMO daquela rotina: as respostas
 *   podem subir a prioridade, não descer abaixo do que a gestão definiu.
 * - Sem fatores e sem regra, "média": sem informação nenhuma, "baixa" é a aposta
 *   que mais custa se errar.
 */
async function prioridadeNaAbertura(client, { prioridade, urgencia, impacto, risco }, perfil, regraDeDistribuicao) {
  const ehGestao = ['administrador', 'gestor'].includes(perfil);
  const piso = regraDeDistribuicao?.prioridade ?? null;

  if (ehGestao && prioridade) return { prioridade };

  if ([urgencia, impacto, risco].some((v) => v !== undefined && v !== null)) {
    // Os três ou nenhum: dois fatores calculariam uma prioridade que ninguém decidiu.
    priorizacaoService.validarFatores({ urgencia, impacto, risco });

    let regra;
    try {
      regra = await priorizacaoService.regraVigente(client);
    } catch (err) {
      // Sem regra vigente não se calcula, mas abrir o chamado não pode falhar por isso.
      if (err.code !== 'SEM_REGRA_VIGENTE') throw err;
      return { prioridade: piso ?? 'media' };
    }

    const sugestao = priorizacaoService.calcular({ urgencia, impacto, risco }, regra);
    const final = piso ? maiorPrioridade(sugestao.prioridade, piso) : sugestao.prioridade;
    return {
      prioridade: final,
      fatores: { urgencia, impacto, risco },
      regraId: regra.id,
      motivo:
        final === sugestao.prioridade
          ? sugestao.motivo
          : `${sugestao.motivo} A regra de distribuição define o mínimo de "${piso}".`,
    };
  }

  return { prioridade: piso ?? 'media' };
}

async function criar(
  { titulo, descricao, categoria_id, local_id, equipamento_id, prioridade, urgencia, impacto, risco },
  solicitanteId,
  perfil = 'solicitante'
) {
  const protocolo = gerarProtocolo();

  const { chamado, notificacaoId } = await transacao(async (client) => {
    const alvo = await resolverAlvo(client, { categoria_id, local_id, equipamento_id });

    const regra = await distribuicaoService.regraPara(client, alvo);
    const inicial = await prioridadeNaAbertura(
      client,
      { prioridade, urgencia, impacto, risco },
      perfil,
      regra
    );
    const prioridadeInicial = inicial.prioridade;

    // O prazo nasce junto do chamado, na mesma transação: um chamado sem
    // prazo ficaria invisível para toda a apuração de atraso. A conta (horas
    // corridas ou úteis, conforme a prioridade) é da função prazo_sla, a
    // mesma que repriorizar e reabrir usam.
    const { rows } = await client.query(
      `INSERT INTO chamado (protocolo, titulo, descricao, categoria_id, local_id, equipamento_id,
                            solicitante_id, prioridade, prazo_estimado,
                            urgencia, impacto, risco, prioridade_sugerida, regra_priorizacao_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::prioridade_chamado,
               prazo_sla($8::prioridade_chamado, now(), '0 seconds', '0 seconds', $9),
               $10, $11, $12, $13::prioridade_chamado, $14)
       RETURNING *, ${CALCULADOS}`,
      [
        protocolo,
        titulo,
        descricao,
        alvo.categoria_id,
        alvo.local_id,
        alvo.equipamento_id,
        solicitanteId,
        prioridadeInicial,
        FUSO,
        inicial.fatores?.urgencia ?? null,
        inicial.fatores?.impacto ?? null,
        inicial.fatores?.risco ?? null,
        // A sugestão é a própria prioridade de nascença: a regra de justificativa
        // (RN05) só cobra texto quando a gestão diverge dela, e aqui ninguém divergiu.
        inicial.fatores ? prioridadeInicial : null,
        inicial.regraId ?? null,
      ]
    );

    const criado = rows[0];

    await registrarHistorico(
      client,
      criado.id,
      solicitanteId,
      null,
      'aberto',
      inicial.motivo ? `Chamado aberto. Prioridade pela situação informada: ${inicial.motivo}` : 'Chamado aberto.'
    );

    if (!regra) return { chamado: criado };
    return distribuir(client, criado, regra);
  });

  // Fora da transação, como na atribuição manual: avisar o técnico de um
  // chamado que um rollback desfez seria pior que não avisar.
  if (notificacaoId) await notificacoesService.despacharVarios([notificacaoId]);

  return chamado;
}

/**
 * Entrega o chamado recém-aberto ao técnico que a regra indica.
 *
 * Passa pelos mesmos estados de uma triagem manual (aberto → em triagem →
 * atribuído), como a preventiva: o histórico e os relatórios não veem um
 * atalho que o fluxo não permite, e o autor das duas linhas é quem criou a
 * regra — a decisão foi dele, tomada de antemão. Sem técnico ativo na equipe,
 * o chamado fica aberto para a triagem, como se não houvesse regra.
 */
async function distribuir(client, chamado, regra) {
  const tecnico = await distribuicaoService.escolherTecnico(client, regra);
  if (!tecnico) return { chamado };

  const { rows } = await client.query(
    `UPDATE chamado
        SET estado = 'atribuido', tecnico_id = $1, equipe_id = $2, regra_distribuicao_id = $3
      WHERE id = $4
      RETURNING *, ${CALCULADOS}`,
    [tecnico.id, regra.equipe_id, regra.id, chamado.id]
  );

  await registrarHistorico(
    client,
    chamado.id,
    regra.criado_por,
    'aberto',
    'em_triagem',
    `Triagem automática pela regra de distribuição nº ${regra.id} ` +
      `(${distribuicaoService.descreverAlcance(regra)}): prioridade ` +
      `${distribuicaoService.ROTULO_PRIORIDADE[chamado.prioridade]}.`
  );
  await registrarHistorico(
    client,
    chamado.id,
    regra.criado_por,
    'em_triagem',
    'atribuido',
    `Distribuído automaticamente para ${tecnico.nome}, da equipe ${regra.equipe_nome}: ${tecnico.motivo}.`
  );

  const aviso = await client.query(
    `INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem)
     VALUES ($1, $2, 'atribuicao', $3) RETURNING id`,
    [tecnico.id, chamado.id, `Você recebeu o chamado ${chamado.protocolo} pela distribuição automática.`]
  );

  return { chamado: rows[0], notificacaoId: aviso.rows[0].id };
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
    // RN06: o técnico vê o que lhe foi designado e o que foi atribuído só à
    // equipe dele (sem técnico), até que um deles o assuma.
    condicoes.push(
      `(tecnico_id = $${params.length}
        OR (tecnico_id IS NULL AND equipe_id IN (SELECT equipe_id FROM equipe_tecnico WHERE usuario_id = $${params.length})))`
    );
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
  if (filtros.equipamento_id) {
    params.push(filtros.equipamento_id);
    condicoes.push(`equipamento_id = $${params.length}`);
  }
  // Mapa fechado, como as situações: só os dois valores do enum viram SQL.
  if (['corretiva', 'preventiva'].includes(filtros.origem)) {
    params.push(filtros.origem);
    condicoes.push(`origem = $${params.length}::origem_chamado`);
  }
  if (filtros.atrasados === 'true') {
    condicoes.push(EM_ATRASO);
  }
  // Crítico parado sem atendimento: o recorte que o alerta da gestão abre.
  if (filtros.sem_atendimento === 'true') {
    condicoes.push(SEM_ATENDIMENTO_CRITICO);
  }

  // Chamado em aberto sem técnico designado.
  //
  // É o recorte que a gestão mais precisa e o único que não dava para pedir.
  // A diferença dele para "atrasado" é quem pode agir: num chamado atrasado
  // com técnico, alguém já está com ele na mão; sem técnico, ninguém está —
  // e o relógio corre igual. O atraso da distribuição é invisível na lista
  // ordenada por data, porque o chamado parado não se move nem chama atenção.
  //
  // `estado NOT IN (concluido, cancelado)` junto: chamado encerrado sem
  // técnico é normal (foi cancelado antes de distribuir) e não é pendência.
  // Em aberto ou encerrado, filtrado no servidor.
  //
  // As telas por perfil faziam esse corte no navegador, sobre uma página de
  // cem. Na fila do técnico, ordenada por prazo, os chamados encerrados — os
  // de prazo mais antigo — vinham primeiro e ocupavam a página: com cem
  // encerrados no histórico, a fila aparecia vazia com cinco chamados em
  // aberto designados. Filtro feito depois da paginação só filtra o que
  // coube na página.
  if (SITUACOES[filtros.situacao]) {
    condicoes.push(SITUACOES[filtros.situacao]);
  }

  if (filtros.sem_tecnico === 'true') {
    condicoes.push("tecnico_id IS NULL AND estado NOT IN ('concluido', 'cancelado')");
  }
  // RF03 pede protocolo pesquisável. Buscar também no título custa nada e é
  // o que a pessoa tenta primeiro quando não anotou o número.
  if (filtros.busca && filtros.busca.trim()) {
    params.push(`%${filtros.busca.trim()}%`);
    condicoes.push(`(protocolo ILIKE $${params.length} OR titulo ILIKE $${params.length})`);
  }

  const { pagina, limite } = normalizarPaginacao(filtros);
  const offset = (pagina - 1) * limite;

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const ordem = ORDENACOES[filtros.ordenar] || ORDENACOES.recentes;

  // count(*) OVER () traz o total junto com a página, numa varredura só, em
  // vez de repetir o mesmo WHERE num SELECT count separado.
  params.push(limite, offset);
  const { rows } = await pool.query(
    `SELECT *, ${CALCULADOS}, count(*) OVER () AS total_registros
       FROM chamado
       ${where}
      ORDER BY ${ordem}
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
    // O alerta de crítico sem atendimento diz o tempo na tela; vir daqui evita
    // um segundo número, copiado no navegador, que divergiria do usado na consulta.
    atendimento_critico_minutos: MINUTOS_ATE_ATENDER_CRITICO,
  };
}

/**
 * RN06: chamado atribuído só a uma equipe (sem técnico) é de todos os técnicos
 * dela, até que um o assuma. Quem inicia o atendimento passa a ser o técnico
 * designado; antes disso, o chamado não é de ninguém em particular e, por isso,
 * qualquer um da equipe o enxerga e pode começá-lo.
 */
async function daEquipeDoTecnico(executor, chamado, usuario) {
  if (usuario.perfil !== 'tecnico' || chamado.tecnico_id || !chamado.equipe_id) return false;
  const { rowCount } = await executor.query(
    'SELECT 1 FROM equipe_tecnico WHERE equipe_id = $1 AND usuario_id = $2',
    [chamado.equipe_id, usuario.id]
  );
  return rowCount > 0;
}

/**
 * Quem enxerga o chamado: gestão vê todos; solicitante vê o que abriu;
 * técnico vê o que lhe foi designado, ou à equipe dele enquanto ninguém o assumiu. Usado também por anexos e materiais,
 * para que as rotas filhas não reimplementem (e não divirjam d)essa regra.
 */
async function garantirLeitura(id, usuario) {
  const chamado = await buscarChamadoBruto(id);

  const podeVer =
    usuario.perfil === 'administrador' ||
    usuario.perfil === 'gestor' ||
    chamado.solicitante_id === usuario.id ||
    chamado.tecnico_id === usuario.id ||
    (await daEquipeDoTecnico(pool, chamado, usuario));

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

  // O chamado guarda só os ids. Sem resolvê-los, a tela do técnico designado
  // mostrava o que houve e para quando, mas não onde nem de que tipo — e é
  // justamente onde ele precisa ir. A planilha e o relatório já traziam o
  // local; a tela, que é por onde se trabalha, não trazia.
  const contexto = await pool.query(
    `SELECT ${rotuloSql('l')} AS local_rotulo, cat.nome AS categoria_nome,
            e.codigo AS equipamento_codigo, e.nome AS equipamento_nome,
            p.titulo AS plano_titulo
       FROM chamado c
       JOIN local l ON l.id = c.local_id
       JOIN categoria cat ON cat.id = c.categoria_id
       LEFT JOIN equipamento e ON e.id = c.equipamento_id
       LEFT JOIN plano_preventivo p ON p.id = c.plano_id
      WHERE c.id = $1`,
    [id]
  );

  // A tela precisa saber se o técnico pode começar um chamado que é só da equipe
  // dele; quem decide é o servidor, o mesmo que vai conferir ao mudar o estado.
  const podeAssumir = await daEquipeDoTecnico(pool, chamado, usuario);

  // RF09: a confirmação e a nota do solicitante, para quem abre o chamado. Só
  // enquanto ele está concluído: depois de reaberto, a avaliação do ciclo
  // anterior deixou de valer como confirmação (continua na linha do tempo).
  const avaliacao =
    chamado.estado === 'concluido'
      ? (await pool.query('SELECT nota, comentario, data FROM avaliacao WHERE chamado_id = $1', [id])).rows[0] || null
      : null;

  return { ...chamado, ...contexto.rows[0], historico: historico.rows, pode_assumir: podeAssumir, avaliacao };
}

// Estados em que o chamado já tem responsável: atribuir de novo aqui é
// reatribuição, não a primeira distribuição.
const ESTADOS_COM_RESPONSAVEL = ['atribuido', 'em_andamento', 'aguardando_material'];

/**
 * O destino de uma atribuição precisa existir e fazer sentido.
 *
 * `atribuir` gravava `tecnico_id` e `equipe_id` sem conferir nada: aceitava um
 * solicitante como "técnico", um técnico inativo e até ninguém (estado
 * `atribuido` com `tecnico_id` nulo). Como "atendido" é sair de `aberto`, um
 * crítico atribuído assim deixava de alertar a gestão sem que ninguém tivesse
 * assumido o chamado. A tela só oferece técnicos ativos, mas a regra não pode
 * depender de quem chama a API.
 */
async function validarDestino(client, { tecnico_id: tecnicoId, equipe_id: equipeId }) {
  if (!tecnicoId && !equipeId) {
    throw new AppError('Informe o técnico, a equipe, ou os dois.', 422, 'DESTINO_OBRIGATORIO');
  }

  if (tecnicoId) {
    const { rows } = await client.query('SELECT perfil, ativo FROM usuario WHERE id = $1', [tecnicoId]);
    if (!rows[0]) {
      throw new AppError('Técnico não encontrado.', 422, 'TECNICO_INVALIDO');
    }
    if (rows[0].perfil !== 'tecnico') {
      throw new AppError('Este usuário não é técnico.', 422, 'TECNICO_INVALIDO');
    }
    if (!rows[0].ativo) {
      throw new AppError('Este técnico está inativo.', 422, 'TECNICO_INVALIDO');
    }
  }

  if (equipeId) {
    const { rows } = await client.query('SELECT ativo FROM equipe WHERE id = $1', [equipeId]);
    if (!rows[0]) {
      throw new AppError('Equipe não encontrada.', 422, 'EQUIPE_INVALIDA');
    }
    if (!rows[0].ativo) {
      throw new AppError('Esta equipe está desativada.', 422, 'EQUIPE_INVALIDA');
    }
  }

  if (tecnicoId && equipeId) {
    const { rowCount } = await client.query(
      'SELECT 1 FROM equipe_tecnico WHERE equipe_id = $1 AND usuario_id = $2',
      [equipeId, tecnicoId]
    );
    if (rowCount === 0) {
      throw new AppError('Este técnico não faz parte da equipe escolhida.', 422, 'TECNICO_FORA_DA_EQUIPE');
    }
  }
}

async function atribuir(id, { tecnico_id, equipe_id, justificativa }, usuario) {
  if (!['administrador', 'gestor'].includes(usuario.perfil)) {
    throw new AppError('Apenas gestores ou administradores podem atribuir chamados.', 403, 'ACESSO_NEGADO');
  }

  const { chamado, notificacaoIds } = await transacao(async (client) => {
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

    await validarDestino(client, { tecnico_id, equipe_id });

    const novoEstado = ehReatribuicao ? atual.estado : 'atribuido';

    const { rows } = await client.query(
      `UPDATE chamado SET tecnico_id = $1, equipe_id = $2, estado = $3::estado_chamado
       WHERE id = $4 RETURNING *, ${CALCULADOS}`,
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

    const notificacaoIds = [];
    if (tecnico_id) {
      const aviso = await client.query(
        `INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem)
         VALUES ($1, $2, 'atribuicao', $3) RETURNING id`,
        [tecnico_id, id, `Você foi designado para o chamado ${atual.protocolo}.`]
      );
      notificacaoIds.push(aviso.rows[0].id);
    } else if (equipe_id) {
      // RN06: só a equipe foi designada. Sem aviso, ninguém saberia que o
      // chamado está esperando alguém assumi-lo.
      const avisos = await client.query(
        `INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem)
         SELECT u.id, $1, 'atribuicao', $2
           FROM equipe_tecnico et JOIN usuario u ON u.id = et.usuario_id
          WHERE et.equipe_id = $3 AND u.ativo
         RETURNING id`,
        [id, `O chamado ${atual.protocolo} foi atribuído à sua equipe. Quem iniciar o atendimento o assume.`, equipe_id]
      );
      notificacaoIds.push(...avisos.rows.map((r) => r.id));
    }

    return { chamado: rows[0], notificacaoIds };
  });

  // Fora da transação: enquanto ela está aberta a notificação ainda pode
  // sumir num rollback, e avisar sobre algo que não aconteceu é pior que
  // não avisar.
  await notificacoesService.despacharVarios(notificacaoIds);

  return chamado;
}

async function mudarEstado(id, { estado: novoEstado, observacao, servico_realizado, epi_confirmado }, usuario) {
  const { atualizado, notificacaoId } = await transacao(async (client) => {
    const chamado = await bloquearChamado(client, id);

    const daEquipe = await daEquipeDoTecnico(client, chamado, usuario);
    const podeAlterar =
      usuario.perfil === 'administrador' ||
      usuario.perfil === 'gestor' ||
      chamado.tecnico_id === usuario.id ||
      daEquipe;

    if (!podeAlterar) {
      throw new AppError('Você não tem permissão para alterar o estado deste chamado.', 403, 'ACESSO_NEGADO');
    }

    // RN06: o chamado só da equipe não tem dono. Quem é da equipe pode apenas
    // começá-lo, e começar é assumir: o resto do atendimento (esperar material,
    // concluir) é de quem ficou com ele.
    if (daEquipe && novoEstado !== 'em_andamento') {
      throw new AppError(
        'Este chamado foi atribuído à sua equipe e ainda não tem técnico. Inicie o atendimento para assumi-lo.',
        403,
        'ACESSO_NEGADO'
      );
    }

    // RN05: cancelar é decisão da gestão. O técnico designado muda o estado
    // do próprio trabalho — iniciar, esperar material, concluir —, mas não
    // decide que o serviço deixa de existir: isso tiraria o chamado da fila
    // sem que quem distribui o trabalho soubesse.
    if (novoEstado === 'cancelado' && !['administrador', 'gestor'].includes(usuario.perfil)) {
      throw new AppError('Somente a gestão pode cancelar um chamado (RN05).', 403, 'ACESSO_NEGADO');
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

    // RN08: a espera por material suspende o prazo, e suspender o prazo é uma
    // decisão que precisa de motivo no registro (início, fim e justificativa).
    if (novoEstado === 'aguardando_material' && (!observacao || observacao.trim().length < 10)) {
      throw new AppError(
        'A espera por material suspende o prazo e exige o motivo (ao menos 10 caracteres) (RN08).',
        422,
        'JUSTIFICATIVA_OBRIGATORIA'
      );
    }

    const campos = ['estado = $1'];
    const params = [novoEstado];

    if (daEquipe) {
      params.push(usuario.id);
      campos.push(`tecnico_id = $${params.length}`);
    }

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

      // Uso de EPI: quem conclui declara, e o sistema guarda quem e quando.
      // Estritamente `true`: "true" (texto), 1 ou a ausência do campo não
      // valem como declaração — um cliente antigo, ou um script que esqueceu
      // o campo, não pode concluir por omissão.
      if (epi_confirmado !== true) {
        throw new AppError(
          'A conclusão exige a confirmação do uso dos EPIs exigidos para o serviço.',
          422,
          'EPI_OBRIGATORIO'
        );
      }
      campos.push('epi_confirmado_em = now()');
      params.push(usuario.id);
      campos.push(`epi_confirmado_por = $${params.length}`);
    }

    if (chamado.estado === 'aguardando_material' && novoEstado !== 'aguardando_material') {
      params.push(FUSO);
      const fuso = `$${params.length}`;
      campos.push(
        "tempo_suspenso_total = tempo_suspenso_total + COALESCE(now() - aguardando_material_desde, '0 seconds')"
      );
      campos.push(
        `tempo_suspenso_util = tempo_suspenso_util + horas_uteis_entre(aguardando_material_desde, now(), ${fuso})`
      );
      campos.push('aguardando_material_desde = NULL');
      // O prazo anda junto com a suspensão. Espera por insumo é falha de
      // suprimento, não da equipe de campo: descontar o tempo da métrica de
      // atendimento (como os relatórios já fazem) e ainda assim deixar o
      // relógio do prazo correndo seria cobrar duas coisas incoerentes. Na
      // régua de horas úteis, devolve-se o expediente que a espera consumiu
      // — dois dias de espera num fim de semana não valem dois dias de prazo.
      campos.push(
        `prazo_estimado = CASE
           WHEN origem = 'corretiva'
                AND (SELECT contagem FROM sla WHERE sla.prioridade = chamado.prioridade) = 'uteis'
             THEN somar_horas_uteis(prazo_estimado, horas_uteis_entre(aguardando_material_desde, now(), ${fuso}), ${fuso})
           ELSE prazo_estimado + COALESCE(now() - aguardando_material_desde, '0 seconds')
         END`
      );
    }

    params.push(id);
    const { rows } = await client.query(
      `UPDATE chamado SET ${campos.join(', ')} WHERE id = $${params.length} RETURNING *, ${CALCULADOS}`,
      params
    );

    // A confirmação também vai para a linha do tempo. As colunas do chamado
    // voltam a nulo na reabertura (o novo ciclo precisa da sua própria), e sem
    // este registro a do ciclo anterior sumiria junto.
    const observacaoDoHistorico =
      novoEstado === 'concluido'
        ? [observacao?.trim(), 'Uso de EPI confirmado.'].filter(Boolean).join(' ')
        : daEquipe
          ? [observacao?.trim(), 'Atendimento assumido por técnico da equipe.'].filter(Boolean).join(' ')
          : observacao;
    await registrarHistorico(client, id, usuario.id, chamado.estado, novoEstado, observacaoDoHistorico);

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

    const { rows } = await client.query(
      `UPDATE chamado SET
         urgencia = $1, impacto = $2, risco = $3,
         prioridade_sugerida = $4::prioridade_chamado,
         prioridade = $5::prioridade_chamado,
         prioridade_justificativa = $6,
         regra_priorizacao_id = $7,
         priorizado_em = now(),
         priorizado_por = $8,
         -- A preventiva tem data marcada pelo plano, não prazo de SLA: mudar
         -- a prioridade dela muda a ordem na fila, não o dia combinado.
         prazo_estimado = CASE
           WHEN origem = 'preventiva' THEN prazo_estimado
           ELSE COALESCE(
             prazo_sla($5::prioridade_chamado, data_abertura, tempo_suspenso_total, tempo_suspenso_util, $9),
             prazo_estimado
           )
         END
       WHERE id = $10
       RETURNING *, ${CALCULADOS}`,
      [
        urgencia,
        impacto,
        risco,
        sugestao.prioridade,
        escolhida,
        divergiu ? justificativa.trim() : null,
        regra.id,
        usuario.id,
        FUSO,
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

// Estados em que o chamado ainda não tem responsável designado. É a janela
// em que a RN03 deixa o solicitante corrigir o que escreveu.
const ESTADOS_SEM_RESPONSAVEL = ['aberto', 'em_triagem'];

const CAMPOS_EDITAVEIS = ['titulo', 'descricao', 'categoria_id', 'local_id', 'equipamento_id'];

/**
 * Corrige os dados do chamado (RN03).
 *
 * A regra diz "enquanto ele estiver aberto e ainda não tiver sido atribuído".
 * As duas condições só não são redundantes se "aberto" quiser dizer "não
 * encerrado" — por isso a janela do solicitante vai até a triagem, e não só
 * até a primeira mudança de estado. A gestão edita enquanto o chamado viver,
 * como "ação autorizada" prevista na mesma regra.
 */
async function editar(id, dados, usuario) {
  return transacao(async (client) => {
    const chamado = await bloquearChamado(client, id);

    if (['concluido', 'cancelado'].includes(chamado.estado)) {
      throw new AppError('Chamado encerrado não pode ser editado.', 409, 'ESTADO_INVALIDO');
    }

    const ehGestao = ['administrador', 'gestor'].includes(usuario.perfil);

    if (!ehGestao) {
      if (chamado.solicitante_id !== usuario.id) {
        throw new AppError('Apenas o solicitante ou a gestão podem editar este chamado.', 403, 'ACESSO_NEGADO');
      }
      if (!ESTADOS_SEM_RESPONSAVEL.includes(chamado.estado)) {
        // A RN03 não fecha a porta, muda a porta: depois da atribuição as
        // alterações acontecem "por comentário ou ação autorizada". Dizer só
        // que não pode mais editar deixaria a pessoa sem saber por onde
        // acrescentar o que faltou.
        throw new AppError(
          'O chamado já foi atribuído. Para acrescentar informação, use os comentários; ' +
            'alterações no texto, a partir daqui, só pela gestão.',
          409,
          'JANELA_ENCERRADA'
        );
      }
    }

    const campos = [];
    const params = [];
    const alteracoes = [];
    dados = { ...dados };

    // Equipamento e local andam juntos. Escolher um equipamento leva o local
    // dele; mudar só o local de um chamado que apontava para um equipamento de
    // lá solta o equipamento — ele ficou no lugar antigo, e mantê-lo diria ao
    // técnico para consertar algo que não está onde ele vai.
    if (dados.equipamento_id) {
      const localEfetivo = dados.local_id ?? (dados.equipamento_id === chamado.equipamento_id ? chamado.local_id : undefined);
      const equipamento = await equipamentosService.conferirNoLocal(client, dados.equipamento_id, localEfetivo);
      dados.local_id = equipamento.local_id;
    } else if (
      dados.local_id !== undefined &&
      dados.local_id !== chamado.local_id &&
      chamado.equipamento_id &&
      dados.equipamento_id === undefined
    ) {
      dados.equipamento_id = null;
    }

    for (const campo of CAMPOS_EDITAVEIS) {
      if (dados[campo] === undefined) continue;
      if (dados[campo] === chamado[campo]) continue;

      params.push(dados[campo]);
      campos.push(`${campo} = $${params.length}`);
      alteracoes.push(campo);
    }

    if (campos.length === 0) {
      throw new AppError('Nenhuma alteração informada.', 422, 'NADA_A_ATUALIZAR');
    }

    params.push(id);
    const { rows } = await client.query(
      `UPDATE chamado SET ${campos.join(', ')} WHERE id = $${params.length}
       RETURNING *, ${CALCULADOS}`,
      params
    );

    // Editar não move o chamado no fluxo, mas altera o que a equipe vai
    // atender: sem registro, o técnico veria uma descrição diferente da que
    // motivou a triagem, sem saber que mudou.
    await registrarHistorico(
      client,
      id,
      usuario.id,
      chamado.estado,
      chamado.estado,
      `Chamado editado (${alteracoes.join(', ')}).`
    );

    return rows[0];
  });
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
     RETURNING *, ${CALCULADOS}`,
    params
  );

  return rows[0];
}

// RN09: janela de reabertura contada a partir da conclusão. Vale para o solicitante;
// a gestão reabre também depois dela (RN05), com justificativa.
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
    // RN05: fora da janela do solicitante, reabrir é decisão da gestão. A
    // justificativa já é obrigatória e o histórico diz que foi fora da janela.
    const foraDaJanela = horasDesdeConclusao > HORAS_PARA_REABRIR;
    if (foraDaJanela && !ehGestao) {
      throw new AppError(
        `A janela de ${HORAS_PARA_REABRIR} horas para reabertura expirou. Peça à gestão para reabrir, ou abra um novo chamado referenciando o protocolo ${atual.protocolo}.`,
        409,
        'JANELA_EXPIRADA'
      );
    }

    // O prazo do ciclo anterior já foi gasto; o novo ciclo recebe prazo
    // próprio contado a partir de agora. O que sinaliza a falha do primeiro
    // atendimento é a contagem de reaberturas, não um prazo vencido herdado.
    const { rows } = await client.query(
      `UPDATE chamado SET
         estado = 'em_triagem',
         data_conclusao = NULL,
         -- A descrição do serviço vai para o histórico e sai do chamado: o
         -- novo ciclo precisa da sua própria, e mantê-la aqui deixaria a
         -- conclusão seguinte passar pela RN07 com texto do ciclo anterior.
         servico_realizado = NULL,
         -- Idem a confirmação de EPI: é do ciclo, e a anterior fica na linha
         -- do tempo.
         epi_confirmado_em = NULL,
         epi_confirmado_por = NULL,
         total_reaberturas = total_reaberturas + 1,
         reaberto_em = now(),
         inicio_execucao = NULL,
         tempo_suspenso_util = '0 seconds',
         prazo_estimado = prazo_sla(prioridade, now(), '0 seconds', '0 seconds', $1)
       WHERE id = $2
       RETURNING *, ${CALCULADOS}`,
      [FUSO, id]
    );

    await registrarHistorico(
      client,
      id,
      usuario.id,
      'concluido',
      'em_triagem',
      `Chamado reaberto (ciclo ${rows[0].total_reaberturas + 1})` +
        (foraDaJanela ? ` fora da janela de ${HORAS_PARA_REABRIR} horas, por decisão da gestão (RN05)` : '') +
        `. Justificativa: ${justificativa.trim()}` +
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

/**
 * RF09: o solicitante confirma a solução e avalia o atendimento.
 *
 * Avaliar É confirmar: quem não concorda com a conclusão não avalia, reabre
 * (RN09, 48 horas). A tela diz isso antes do botão, e a confirmação entra na
 * linha do tempo com autor e hora, como toda ação relevante do chamado; antes
 * a nota ia só para a tabela `avaliacao` e ninguém que abrisse o chamado sabia
 * que o solicitante tinha dado o serviço por feito.
 *
 * Uma avaliação por chamado. Reenviar troca a nota e o comentário (depois de
 * uma reabertura, por exemplo), atualiza a data e deixa a troca no histórico.
 */
async function avaliar(id, { nota, comentario }, usuario) {
  const chamado = await buscarChamadoBruto(id);

  if (chamado.solicitante_id !== usuario.id) {
    throw new AppError('Apenas o solicitante pode avaliar este chamado.', 403, 'ACESSO_NEGADO');
  }
  if (chamado.estado !== 'concluido') {
    throw new AppError('Só é possível avaliar chamados concluídos.', 409, 'ESTADO_INVALIDO');
  }

  const texto = typeof comentario === 'string' && comentario.trim() ? comentario.trim() : null;

  return transacao(async (client) => {
    const anterior = await client.query('SELECT nota FROM avaliacao WHERE chamado_id = $1 FOR UPDATE', [id]);

    const { rows } = await client.query(
      `INSERT INTO avaliacao (chamado_id, nota, comentario) VALUES ($1, $2, $3)
       ON CONFLICT (chamado_id) DO UPDATE
         SET nota = EXCLUDED.nota, comentario = EXCLUDED.comentario, data = now()
       RETURNING *`,
      [id, nota, texto]
    );

    // O comentário não é copiado para o histórico: texto livre fica num lugar só
    // (a avaliação), para que uma correção pedida pelo titular não precise caçar
    // cópias em registro que não se edita (docs/lgpd.md).
    await registrarHistorico(
      client,
      id,
      usuario.id,
      chamado.estado,
      chamado.estado,
      anterior.rows[0]
        ? `Solicitante alterou a avaliação do atendimento: nota ${nota} de 5 (antes, ${anterior.rows[0].nota}).`
        : `Solicitante confirmou a solução e avaliou o atendimento: nota ${nota} de 5.`
    );

    return rows[0];
  });
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
    `SELECT *, ${CALCULADOS} FROM chamado WHERE id = $1`,
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
  editar,
  garantirLeitura,
  garantirExecucao,
  ESTADOS,
};

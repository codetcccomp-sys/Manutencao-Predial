const pool = require('../config/db');
const { transacao } = require('../config/transacao');
const notificacoesService = require('./notificacoes.service');

// Tetos por execução. A varredura roda dentro de uma requisição, e função
// serverless tem limite de tempo: é melhor avisar uma parte agora e o resto
// na passagem seguinte do que estourar o limite e não avisar ninguém. Como a
// reivindicação é persistente, o que sobra não se perde — fica para a próxima.
const MAXIMO_CHAMADOS = 200;

// O alcance é o produto de chamados por destinatários, não a soma. Um chamado
// sem técnico avisa toda a gestão, então 200 chamados numa instituição com 5
// gestores já seriam mil avisos numa transação só. O orçamento é sobre os
// avisos, e o lote de chamados é calculado a partir dele.
//
// É um alvo, não um limite rígido: o lote nunca cai abaixo de um chamado, e um
// único chamado numa instituição com centenas de gestores sozinho já passa do
// orçamento. Travar isso exigiria deixar o chamado sem aviso, que é pior.
const ORCAMENTO_AVISOS = 500;

// E-mail é o passo lento: cada envio tem timeout de 5 s. O teto vive no
// serviço de notificações, que é quem envia, para valer também para os outros
// avisos — este aqui só o repete para poder informar na resposta quantos
// envios foram tentados.
const MAXIMO_EMAILS = notificacoesService.LIMITE_ENVIOS;

/**
 * Quem é avisado, além de quem já está no chamado.
 *
 * A gestão entra só quando não há técnico designado: aí ninguém mais pode
 * agir, e o atraso é justamente da distribuição. Avisar toda a gestão de todo
 * atraso geraria um aviso por chamado vencido por gestor, que é o volume que
 * se aprende a ignorar; para a visão de conjunto já existem o filtro "somente
 * atrasados" e o indicador no relatório.
 *
 * A lista é buscada uma vez por varredura, e não por chamado: são os mesmos
 * gestores para todos.
 */
async function buscarGestao(client) {
  const { rows } = await client.query(
    "SELECT id FROM usuario WHERE perfil IN ('administrador', 'gestor') AND ativo"
  );
  return rows.map((r) => r.id);
}

/**
 * Reivindica os chamados que estouraram o prazo e ainda não foram avisados.
 *
 * A reivindicação é o próprio UPDATE ... RETURNING, e não um SELECT seguido
 * de UPDATE: o banco decide quem pegou cada linha. Duas execuções
 * sobrepostas — o agendador disparando de novo antes da anterior terminar, ou
 * um retry dele — não conseguem avisar o mesmo chamado duas vezes, porque a
 * segunda não encontra mais a linha para reivindicar.
 *
 * Marcar antes de avisar é deliberado. Marcar e o e-mail falhar custa um
 * aviso; avisar e falhar ao marcar custa reenviar o mesmo aviso a cada
 * passagem, para sempre. Entre perder um aviso e transformar a caixa de
 * entrada de quem trabalha em ruído, o primeiro é o erro menos grave — e o
 * registro em tela sai de qualquer forma, independente do e-mail.
 */
async function reivindicar(client, limite) {
  const { rows } = await client.query(
    `UPDATE chamado c
        SET atraso_notificado_para = c.prazo_estimado
      WHERE c.id IN (
        SELECT id FROM chamado
         WHERE estado NOT IN ('concluido', 'cancelado')
           AND prazo_estimado IS NOT NULL
           AND now() > prazo_estimado
           AND atraso_notificado_para IS DISTINCT FROM prazo_estimado
         ORDER BY prazo_estimado
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING c.id, c.protocolo, c.titulo, c.prioridade, c.prazo_estimado,
                c.solicitante_id, c.tecnico_id`,
    [limite]
  );

  return rows;
}

function horasDeAtraso(prazo) {
  return Math.max(1, Math.round((Date.now() - new Date(prazo).getTime()) / 3_600_000));
}

// O servidor roda em UTC, e o resto do sistema mostra data pelo relógio do
// navegador de quem lê. Esta mensagem é montada no servidor e vai para o
// e-mail como texto fixo: sem fuso explícito, um prazo das 17h chegaria como
// 20h, silenciosamente, para todo mundo.
const FUSO = process.env.FUSO_HORARIO || 'America/Sao_Paulo';

function dataLocal(valor) {
  return new Date(valor).toLocaleString('pt-BR', { timeZone: FUSO });
}

function mensagemDe(chamado) {
  const horas = horasDeAtraso(chamado.prazo_estimado);
  return (
    `O chamado ${chamado.protocolo} ("${chamado.titulo}") passou do prazo ` +
    `em ${horas} ${horas === 1 ? 'hora' : 'horas'}. ` +
    `Prioridade ${chamado.prioridade}, prazo previsto para ` +
    `${dataLocal(chamado.prazo_estimado)}.`
  );
}

/**
 * Varre os chamados vencidos e registra o aviso de atraso (RF08).
 *
 * Devolve o que fez, porque quem chama é um agendador: sem um número na
 * resposta, um agendamento quebrado e um agendamento sem nada a fazer se
 * parecem exatamente iguais nos dois lados.
 */
async function notificarAtrasados() {
  const { chamados, notificacaoIds, limiteUsado } = await transacao(async (client) => {
    const gestao = await buscarGestao(client);

    // Pior caso por chamado: solicitante + técnico, ou solicitante + toda a
    // gestão. O lote sai do orçamento dividido por esse pior caso, para que
    // o número de avisos numa transação seja previsível.
    const porChamado = Math.max(2, gestao.length + 1);
    const limite = Math.min(MAXIMO_CHAMADOS, Math.max(1, Math.floor(ORCAMENTO_AVISOS / porChamado)));

    const atrasados = await reivindicar(client, limite);
    const ids = [];

    for (const chamado of atrasados) {
      const destinatarios = new Set([chamado.solicitante_id]);
      if (chamado.tecnico_id) {
        destinatarios.add(chamado.tecnico_id);
      } else {
        for (const id of gestao) destinatarios.add(id);
      }

      const mensagem = mensagemDe(chamado);
      for (const usuarioId of destinatarios) {
        const { rows } = await client.query(
          `INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem)
           VALUES ($1, $2, 'atraso', $3) RETURNING id`,
          [usuarioId, chamado.id, mensagem]
        );
        ids.push(rows[0].id);
      }
    }

    return { chamados: atrasados, notificacaoIds: ids, limiteUsado: limite };
  });

  // Fora da transação: enquanto ela está aberta, a notificação ainda pode
  // sumir num rollback, e avisar de algo que não aconteceu é pior que não
  // avisar.
  await notificacoesService.despacharVarios(notificacaoIds);

  return {
    chamados_notificados: chamados.length,
    avisos_gerados: notificacaoIds.length,
    emails_tentados: Math.min(notificacaoIds.length, MAXIMO_EMAILS),
    protocolos: chamados.map((c) => c.protocolo),
    // Diz a quem agenda se vale vir de novo já: com o lote cheio, sobrou
    // trabalho para a próxima passagem.
    havia_mais: chamados.length === limiteUsado,
  };
}

/** Quantos chamados estão vencidos sem aviso — usado só para diagnóstico. */
async function pendentes() {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total
       FROM chamado
      WHERE estado NOT IN ('concluido', 'cancelado')
        AND prazo_estimado IS NOT NULL
        AND now() > prazo_estimado
        AND atraso_notificado_para IS DISTINCT FROM prazo_estimado`
  );
  return rows[0].total;
}

module.exports = {
  notificarAtrasados,
  pendentes,
  MAXIMO_CHAMADOS,
  ORCAMENTO_AVISOS,
  MAXIMO_EMAILS,
};

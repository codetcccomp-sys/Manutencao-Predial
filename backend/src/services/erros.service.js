const pool = require('../config/db');

/**
 * Os erros de servidor (5xx), guardados para a administração ler depois.
 *
 * Nasceu porque o erro só existia no console da função serverless, e na Vercel
 * Hobby os logs de execução duram 1 hora (ver a migração 028). Registrar nunca
 * pode piorar o erro: qualquer falha daqui é engolida e só vai para o console,
 * senão um banco fora do ar transformaria um 500 em dois.
 */

// Como o registro das tarefas agendadas (execucoes.service.js): um mês basta
// para ver o padrão, e mais que isso é tabela crescendo sem ninguém ler.
const RETENCAO_DIAS = 30;

// Teto de linhas por minuto. Um defeito que falha a cada requisição, ou alguém
// provocando erro de propósito, não pode encher o banco: passado o teto, o
// console continua recebendo tudo e a tabela deixa de crescer até o minuto virar.
const TETO_POR_MINUTO = 100;

// Probabilidade de limpar os registros velhos numa gravação qualquer, no lugar
// de um agendador só para isso (mesma escolha de middlewares/rateLimit.js).
const CHANCE_LIMPEZA = 0.02;

const LIMITE_MENSAGEM = 300;
const LIMITE_PILHA = 4000;

const EMAIL = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[^\s@"'<>()]+/g;

/**
 * Mensagem sem e-mail. Erro do banco ou de uma biblioteca pode repetir o valor
 * que a pessoa mandou ("invalid input syntax for type integer: ana@x.com"), e a
 * tabela não deve guardar dado pessoal só porque ele passou por um erro.
 */
function mascarar(texto) {
  return String(texto ?? '').replace(EMAIL, '[e-mail]').slice(0, LIMITE_MENSAGEM);
}

/** As linhas "at ..." do stack, sem a primeira (que repete a mensagem). */
function soAsLinhasDePilha(pilha) {
  if (!pilha) return null;
  return (
    String(pilha)
      .split('\n')
      .filter((linha) => /^\s+at\s/.test(linha))
      .join('\n')
      .slice(0, LIMITE_PILHA) || null
  );
}

/** O caminho, sem query string: ela pode carregar buscas e e-mails. */
function soOCaminho(url) {
  return String(url ?? '').split('?')[0].slice(0, 300);
}

/**
 * Grava o erro. Devolve se gravou; nunca lança.
 *
 * O INSERT carrega o próprio teto (`WHERE (SELECT count(*) ...) < teto`), numa
 * única instrução: assim a contagem e a gravação não se separam entre duas
 * requisições simultâneas.
 */
async function registrar({ metodo, url, status, codigo, mensagem, pilha }) {
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO erro_aplicacao (metodo, rota, status, codigo, mensagem, pilha)
       SELECT $1, $2, $3, $4, $5, $6
        WHERE (SELECT count(*) FROM erro_aplicacao WHERE ocorrido_em > now() - interval '1 minute') < $7`,
      [
        String(metodo ?? '').slice(0, 10),
        soOCaminho(url),
        status,
        codigo ? String(codigo).slice(0, 80) : null,
        mascarar(mensagem),
        soAsLinhasDePilha(pilha),
        TETO_POR_MINUTO,
      ]
    );

    if (Math.random() < CHANCE_LIMPEZA) {
      await pool
        .query(`DELETE FROM erro_aplicacao WHERE ocorrido_em < now() - interval '${RETENCAO_DIAS} days'`)
        .catch(() => {});
    }
    return rowCount === 1;
  } catch (err) {
    console.error('[erros] não foi possível guardar o erro:', err.message);
    return false;
  }
}

/** Os mais recentes primeiro, e quantos houve nas últimas 24 horas. */
async function listar({ limite = 50 } = {}) {
  const teto = Math.min(Math.max(Number(limite) || 50, 1), 200);
  const { rows } = await pool.query(
    `SELECT id, ocorrido_em, metodo, rota, status, codigo, mensagem, pilha
       FROM erro_aplicacao ORDER BY ocorrido_em DESC, id DESC LIMIT $1`,
    [teto]
  );
  const { rows: contagem } = await pool.query(
    `SELECT count(*)::int AS total FROM erro_aplicacao WHERE ocorrido_em > now() - interval '24 hours'`
  );
  return { erros: rows, ultimas_24h: contagem[0].total, retencao_dias: RETENCAO_DIAS };
}

module.exports = { registrar, listar, mascarar, soAsLinhasDePilha, RETENCAO_DIAS, TETO_POR_MINUTO };

const pool = require('../config/db');
const erros = require('./erros.service');
const { FUSO } = require('../config/fuso');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Uso e desempenho do sistema, em contadores por dia (migração 031).
 *
 * Existe para a administração responder "o que se usa, o que está lento, o que
 * quebra" sem ferramenta de terceiros (docs/lgpd.md, seção 8). A regra que
 * manda em tudo aqui é que NADA identifica ninguém: o que chega é uma tela pelo
 * MODELO da rota, uma ação por nome e um número. Sem usuário, sessão, IP, cookie
 * nem endereço com identificador. Quem grava confere cada nome contra uma lista
 * fechada, e o que não está nela é ignorado: a tabela não cresce com o que um
 * cliente invente, e o pior que alguém de fora consegue é distorcer um número.
 *
 * Os erros que acontecem na tela entram em `erro_aplicacao`, a mesma tabela dos
 * erros de servidor, com a mesma máscara de e-mail, o mesmo teto por minuto e a
 * mesma retenção.
 */

// As rotas do frontend (dominio/titulosDeRota.js), pelo modelo e não pelo caminho. Um teste
// confere que nenhuma rota do aplicativo fica de fora; 'outra' recebe o que não casa com nenhuma.
const TELAS = [
  '/login',
  '/cadastro',
  '/recuperar-senha',
  '/redefinir-senha',
  '/privacidade',
  '/termos',
  '/cookies',
  '/suporte',
  '/',
  '/chamados/novo',
  '/chamados/:id',
  '/relatorios',
  '/usuarios',
  '/cadastros',
  '/preventiva',
  '/equipamentos/:id',
  '/etiquetas',
  '/conta',
  'outra',
];

// As ações que se contam. Só o nome, nunca o que a pessoa escreveu nem o número do chamado.
const ACOES = [
  'chamado_aberto',
  'chamado_atribuido',
  'estado_alterado',
  'chamado_concluido',
  'chamado_reaberto',
  'comentario_enviado',
  'anexo_enviado',
  'avaliacao_enviada',
  'relatorio_baixado',
  'equipamento_cadastrado',
  'plano_cadastrado',
];

// Medidas de desempenho da web (web.dev/vitals): o limite é o que o Google chama de "bom",
// e `maximo` descarta o valor impossível (relógio errado, extensão, defeito do navegador).
const METRICAS = {
  LCP: { limite: 2500, maximo: 60000 }, // maior elemento visível, em ms
  FCP: { limite: 1800, maximo: 60000 }, // primeiro conteúdo, em ms
  CLS: { limite: 0.1, maximo: 10 }, // deslocamento de layout, sem unidade
  INP: { limite: 200, maximo: 10000 }, // resposta à interação, em ms
};

const RETENCAO_DIAS = 90;
const CHANCE_LIMPEZA = 0.02;
const MAX_CONTAGEM = 100;
const MAX_MEDIDAS = 12;
const DIAS_PADRAO = 7;

const ehObjetoSimples = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function invalido(motivo) {
  return new AppError(`Dados de uso inválidos: ${motivo}.`, 400, 'TELEMETRIA_INVALIDA');
}

/** `{ nome: n }` → só os nomes da lista, com n inteiro de 1 a MAX_CONTAGEM. Estrutura errada é 400. */
function contagens(entrada, permitidos, campo) {
  if (entrada === undefined) return [];
  if (!ehObjetoSimples(entrada)) throw invalido(`${campo} deve ser um objeto`);
  const achadas = [];
  for (const [nome, n] of Object.entries(entrada)) {
    if (!permitidos.includes(nome)) continue; // cliente mais novo que o servidor: ignora, não recusa
    if (!Number.isInteger(n) || n < 1 || n > MAX_CONTAGEM) throw invalido(`${campo}.${nome} deve ser um inteiro de 1 a ${MAX_CONTAGEM}`);
    achadas.push([nome, n]);
  }
  return achadas;
}

/** Junta as medidas por (métrica, tela): uma linha por chave, que é o que o INSERT exige. */
function medidas(entrada) {
  if (entrada === undefined) return [];
  if (!Array.isArray(entrada) || entrada.length > MAX_MEDIDAS) throw invalido(`desempenho deve ser uma lista de até ${MAX_MEDIDAS}`);
  const porChave = new Map();
  for (const item of entrada) {
    if (!ehObjetoSimples(item)) throw invalido('cada medida deve ser um objeto');
    const metrica = METRICAS[item.metrica];
    if (!metrica || !TELAS.includes(item.tela)) continue;
    if (typeof item.valor !== 'number' || !Number.isFinite(item.valor) || item.valor < 0 || item.valor > metrica.maximo) continue;

    const chave = `${item.metrica}:${item.tela}`;
    const atual = porChave.get(chave) ?? { chave, n: 0, soma: 0, ruins: 0, maximo: 0 };
    atual.n += 1;
    atual.soma += item.valor;
    atual.ruins += item.valor > metrica.limite ? 1 : 0;
    atual.maximo = Math.max(atual.maximo, item.valor);
    porChave.set(chave, atual);
  }
  return [...porChave.values()];
}

/**
 * Soma ao dia de hoje (o de Brasília) o que o aplicativo mediu. Devolve quantas chaves gravou.
 *
 * Uma instrução só, com `ON CONFLICT`: duas requisições simultâneas somam, não se atropelam.
 */
async function registrar({ telas, acoes, desempenho } = {}) {
  const linhas = [
    ...contagens(telas, TELAS, 'telas').map(([nome, n]) => ({ tipo: 'uso', chave: `tela:${nome}`, n, soma: 0, ruins: 0, maximo: 0 })),
    ...contagens(acoes, ACOES, 'acoes').map(([nome, n]) => ({ tipo: 'uso', chave: `acao:${nome}`, n, soma: 0, ruins: 0, maximo: 0 })),
    ...medidas(desempenho).map((m) => ({ tipo: 'desempenho', ...m })),
  ];
  if (linhas.length === 0) return 0;

  await pool.query(
    `INSERT INTO telemetria_diaria (dia, tipo, chave, n, soma, ruins, maximo)
     SELECT (now() AT TIME ZONE $1)::date, x.tipo, x.chave, x.n, x.soma, x.ruins, x.maximo
       FROM unnest($2::text[], $3::text[], $4::bigint[], $5::float8[], $6::bigint[], $7::float8[])
            AS x(tipo, chave, n, soma, ruins, maximo)
     ON CONFLICT (dia, tipo, chave) DO UPDATE
        SET n      = telemetria_diaria.n + EXCLUDED.n,
            soma   = telemetria_diaria.soma + EXCLUDED.soma,
            ruins  = telemetria_diaria.ruins + EXCLUDED.ruins,
            maximo = GREATEST(telemetria_diaria.maximo, EXCLUDED.maximo)`,
    [
      FUSO,
      linhas.map((l) => l.tipo),
      linhas.map((l) => l.chave),
      linhas.map((l) => l.n),
      linhas.map((l) => l.soma),
      linhas.map((l) => l.ruins),
      linhas.map((l) => l.maximo),
    ]
  );

  if (Math.random() < CHANCE_LIMPEZA) {
    await pool
      .query(`DELETE FROM telemetria_diaria WHERE dia < (now() AT TIME ZONE $1)::date - ${RETENCAO_DIAS}`, [FUSO])
      .catch(() => {});
  }
  return linhas.length;
}

/**
 * Um erro que aconteceu na tela. Vai para `erro_aplicacao` (migração 028): método TELA,
 * a tela pelo modelo da rota (nunca o endereço real), e a mensagem sem e-mail.
 */
async function registrarErroDaTela({ mensagem, tela, pilha } = {}) {
  if (typeof mensagem !== 'string' || !mensagem.trim()) throw invalido('mensagem é obrigatória');
  return erros.registrar({
    metodo: 'TELA',
    url: TELAS.includes(tela) ? tela : 'outra',
    status: 0,
    codigo: 'TELA',
    mensagem,
    pilha: typeof pilha === 'string' ? pilha : null,
  });
}

/** O que a administração lê: aberturas e desempenho por tela, ações e erros da tela nas últimas 24 horas. */
async function resumo({ dias = DIAS_PADRAO } = {}) {
  const janela = Math.min(Math.max(Math.trunc(Number(dias)) || DIAS_PADRAO, 1), RETENCAO_DIAS);
  const { rows } = await pool.query(
    `SELECT tipo, chave, sum(n)::int AS n, sum(soma) AS soma, sum(ruins)::int AS ruins, max(maximo) AS maximo
       FROM telemetria_diaria
      WHERE dia > (now() AT TIME ZONE $1)::date - $2::int
      GROUP BY tipo, chave`,
    [FUSO, janela]
  );
  const { rows: erro } = await pool.query(
    `SELECT count(*)::int AS total FROM erro_aplicacao
      WHERE metodo = 'TELA' AND ocorrido_em > now() - interval '24 hours'`
  );

  const telas = new Map(TELAS.map((t) => [t, { tela: t, aberturas: 0, desempenho: {} }]));
  const acoes = new Map(ACOES.map((a) => [a, { acao: a, total: 0 }]));
  for (const linha of rows) {
    const [prefixo, resto] = [linha.chave.split(':')[0], linha.chave.slice(linha.chave.indexOf(':') + 1)];
    if (linha.tipo === 'uso' && prefixo === 'tela' && telas.has(resto)) telas.get(resto).aberturas = linha.n;
    else if (linha.tipo === 'uso' && prefixo === 'acao' && acoes.has(resto)) acoes.get(resto).total = linha.n;
    else if (linha.tipo === 'desempenho' && METRICAS[prefixo] && telas.has(resto)) {
      telas.get(resto).desempenho[prefixo] = {
        medidas: linha.n,
        media: linha.n ? Number((linha.soma / linha.n).toFixed(prefixo === 'CLS' ? 3 : 0)) : 0,
        percentual_acima_do_limite: linha.n ? Math.round((linha.ruins / linha.n) * 100) : 0,
        maximo: Number(Number(linha.maximo).toFixed(prefixo === 'CLS' ? 3 : 0)),
      };
    }
  }

  return {
    dias: janela,
    retencao_dias: RETENCAO_DIAS,
    limites: Object.fromEntries(Object.entries(METRICAS).map(([nome, m]) => [nome, m.limite])),
    telas: [...telas.values()]
      .filter((t) => t.aberturas > 0 || Object.keys(t.desempenho).length > 0)
      .sort((a, b) => b.aberturas - a.aberturas),
    acoes: [...acoes.values()].filter((a) => a.total > 0).sort((a, b) => b.total - a.total),
    erros_da_tela_24h: erro[0].total,
  };
}

module.exports = { registrar, registrarErroDaTela, resumo, TELAS, ACOES, METRICAS, RETENCAO_DIAS };

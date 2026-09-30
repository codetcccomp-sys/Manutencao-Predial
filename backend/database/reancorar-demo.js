#!/usr/bin/env node
/**
 * Traz os dados de demonstração para perto de hoje.
 *
 * A massa de demonstração (docs/dados-demonstracao.md) foi carregada com
 * prazos relativos ao dia da carga. O relógio não para: dez dias depois, 88%
 * dos chamados abertos já apareciam em atraso, e um painel todo vermelho não
 * demonstra nada — nem o que o sistema faz com o prazo, nem o que faz com o
 * atraso, porque não há contraste entre os dois.
 *
 * O script desloca TODAS as datas da demonstração pelo mesmo intervalo, de
 * modo que o momento da carga vire "agora". Deslocar tudo junto preserva o
 * que importa: a ordem dos eventos, os tempos de triagem e de atendimento, e
 * quais chamados estão no prazo e quais estouraram — exatamente como no dia
 * em que a massa foi desenhada.
 *
 * A âncora é a data de criação das pessoas da demonstração, que é também
 * deslocada. Assim a segunda execução mede a partir da primeira, e rodar
 * duas vezes seguidas não empurra nada para o futuro.
 *
 * Só toca o que é da demonstração: chamados com protocolo SMP-DEMO-* (e o
 * que pertence a eles) e pessoas com "+demo." no e-mail. Dado real no mesmo
 * banco fica como está.
 *
 * Por padrão só MOSTRA o que faria. Para aplicar:
 *   node database/reancorar-demo.js --aplicar
 */
require('dotenv').config();
const pool = require('../src/config/db');

const DEMO_CHAMADO = "protocolo LIKE 'SMP-DEMO-%'";
const DEMO_PESSOA = "email LIKE '%+demo.%'";

// Menos que isso não vale a transação: a demonstração já está "de hoje".
const DESLOCAMENTO_MINIMO_HORAS = 1;

async function colunasDeData(client, tabela) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND data_type LIKE 'timestamp%'`,
    [tabela]
  );
  return rows.map((r) => r.column_name);
}

// As tabelas que pertencem a um chamado, descobertas pelo banco e não
// listadas à mão: uma tabela nova ligada ao chamado entra sozinha, em vez de
// ficar com as datas no passado enquanto o resto anda.
async function tabelasDoChamado(client) {
  const { rows } = await client.query(
    `SELECT DISTINCT tc.table_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage k
         ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage cu
         ON cu.constraint_name = tc.constraint_name AND cu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        AND cu.table_name = 'chamado' AND k.column_name = 'chamado_id'`
  );
  return rows.map((r) => r.table_name).sort();
}

async function situacao(client) {
  const { rows } = await client.query(
    `SELECT count(*) FILTER (WHERE estado NOT IN ('concluido', 'cancelado'))::int AS abertos,
            count(*) FILTER (WHERE estado NOT IN ('concluido', 'cancelado')
                               AND prazo_estimado < now())::int AS atrasados
       FROM chamado WHERE ${DEMO_CHAMADO}`
  );
  return rows[0];
}

/**
 * Desloca a demonstração para que a carga aconteça em `agora`.
 * Devolve o deslocamento em horas e o retrato antes/depois.
 */
async function reancorar(client, { agora = new Date(), aplicar = false } = {}) {
  const { rows: [ancora] } = await client.query(
    `SELECT min(criado_em) AS em FROM usuario WHERE ${DEMO_PESSOA}`
  );
  if (!ancora.em) return { horas: 0, motivo: 'SEM_DEMONSTRACAO' };

  const horas = (agora.getTime() - new Date(ancora.em).getTime()) / 3_600_000;
  if (Math.abs(horas) < DESLOCAMENTO_MINIMO_HORAS) return { horas, motivo: 'JA_ATUAL' };

  await client.query('BEGIN');
  try {
    const antes = await situacao(client);
    const intervalo = `${horas} hours`;
    const alteradas = {};

    for (const coluna of await colunasDeData(client, 'chamado')) {
      await client.query(
        `UPDATE chamado SET ${coluna} = ${coluna} + $1::interval
          WHERE ${DEMO_CHAMADO} AND ${coluna} IS NOT NULL`,
        [intervalo]
      );
    }

    for (const tabela of await tabelasDoChamado(client)) {
      for (const coluna of await colunasDeData(client, tabela)) {
        const { rowCount } = await client.query(
          `UPDATE ${tabela} SET ${coluna} = ${coluna} + $1::interval
            WHERE ${coluna} IS NOT NULL
              AND chamado_id IN (SELECT id FROM chamado WHERE ${DEMO_CHAMADO})`,
          [intervalo]
        );
        alteradas[`${tabela}.${coluna}`] = rowCount;
      }
    }

    // A âncora anda junto: é ela que faz a próxima execução medir daqui.
    await client.query(
      `UPDATE usuario SET criado_em = criado_em + $1::interval WHERE ${DEMO_PESSOA}`,
      [intervalo]
    );

    const depois = await situacao(client);
    await client.query(aplicar ? 'COMMIT' : 'ROLLBACK');
    return { horas, antes, depois, alteradas, aplicado: aplicar };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

module.exports = { reancorar };

if (require.main === module) {
  const aplicar = process.argv.includes('--aplicar');
  (async () => {
    const client = await pool.connect();
    try {
      const r = await reancorar(client, { aplicar });
      if (r.motivo === 'SEM_DEMONSTRACAO') {
        console.log('[reancorar-demo] nenhuma pessoa de demonstração neste banco; nada a fazer.');
      } else if (r.motivo === 'JA_ATUAL') {
        console.log('[reancorar-demo] a demonstração já está ancorada em hoje; nada a fazer.');
      } else {
        const dias = (r.horas / 24).toFixed(1);
        console.log(`[reancorar-demo] deslocamento: ${dias} dias`);
        console.log(`  abertos: ${r.antes.abertos} · em atraso antes: ${r.antes.atrasados} · depois: ${r.depois.atrasados}`);
        console.log(
          r.aplicado
            ? '[reancorar-demo] aplicado.'
            : '[reancorar-demo] nada foi gravado. Rode com --aplicar para gravar.'
        );
      }
    } finally {
      client.release();
      await pool.end();
    }
  })().catch((err) => {
    console.error('[reancorar-demo] falhou:', err.message);
    process.exit(1);
  });
}

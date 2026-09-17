#!/usr/bin/env node
/**
 * Aplicador de migrações.
 *
 * Antes havia um único schema.sql, que só servia para criar um banco do zero:
 * não existia caminho para evoluir um banco que já tinha dados — como o de
 * produção. Cada arquivo em database/migrations roda uma vez, em ordem de
 * nome, dentro de uma transação, e fica registrado na tabela "migracao".
 *
 * Uso:
 *   node database/migrate.js              aplica o que estiver pendente
 *   node database/migrate.js --status     só lista o que está aplicado/pendente
 *   node database/migrate.js --baseline=N marca como aplicadas, sem executar,
 *                                         as migrações até N — para adotar o
 *                                         mecanismo num banco que já tem o
 *                                         schema criado por outro caminho.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

const DIR = path.join(__dirname, 'migrations');

function listarArquivos() {
  return fs
    .readdirSync(DIR)
    .filter((nome) => nome.endsWith('.sql'))
    .sort();
}

async function garantirTabela(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migracao (
      nome        TEXT PRIMARY KEY,
      aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function aplicadas(client) {
  const { rows } = await client.query('SELECT nome FROM migracao');
  return new Set(rows.map((r) => r.nome));
}

async function executar() {
  const argumentos = process.argv.slice(2);
  const somenteStatus = argumentos.includes('--status');
  const baseline = argumentos.find((a) => a.startsWith('--baseline='));

  const client = await pool.connect();
  try {
    await garantirTabela(client);
    const jaAplicadas = await aplicadas(client);
    const arquivos = listarArquivos();

    if (somenteStatus) {
      for (const arquivo of arquivos) {
        console.log(`${jaAplicadas.has(arquivo) ? 'aplicada ' : 'pendente '} ${arquivo}`);
      }
      return;
    }

    if (baseline) {
      const limite = baseline.split('=')[1];
      const ateAqui = arquivos.filter((a) => a.split('_')[0] <= limite);
      for (const arquivo of ateAqui) {
        await client.query('INSERT INTO migracao (nome) VALUES ($1) ON CONFLICT DO NOTHING', [arquivo]);
        console.log(`marcada como aplicada (baseline): ${arquivo}`);
      }
      return;
    }

    const pendentes = arquivos.filter((a) => !jaAplicadas.has(a));
    if (pendentes.length === 0) {
      console.log('nenhuma migração pendente');
      return;
    }

    for (const arquivo of pendentes) {
      const sql = fs.readFileSync(path.join(DIR, arquivo), 'utf8');
      // Cada migração é atômica: ou o arquivo inteiro entra, ou nada dele
      // entra e o registro não é gravado. Sem isso, uma migração que falha
      // no meio deixa o banco num estado que o aplicador não sabe descrever.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO migracao (nome) VALUES ($1)', [arquivo]);
        await client.query('COMMIT');
        console.log(`aplicada: ${arquivo}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`falhou em ${arquivo}: ${err.message}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

executar().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

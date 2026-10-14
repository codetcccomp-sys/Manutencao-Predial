const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');
const adminPool = require('../src/config/db');

/**
 * O zeramento do banco da demonstração (database/reiniciar-demonstracao.sql).
 *
 * É o único arquivo do repositório que apaga um schema inteiro, e é feito para
 * ser colado no SQL Editor do Supabase. A trava contra rodar no projeto errado
 * é a marca de demonstração do próprio banco: o teste prova que um banco sem
 * ela sai intacto e que um banco com ela volta a poder ser migrado e marcado.
 */

const SCRIPT = fs.readFileSync(path.join(__dirname, '../database/reiniciar-demonstracao.sql'), 'utf8');
const MARCA = `rd${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const BANCO = `smp_reinicio_${MARCA}`;
const cwd = path.join(__dirname, '..');
const env = { ...process.env, DB_NAME: BANCO, DATABASE_URL: '' };

let pool;

const migrar = () => spawnSync('node', ['database/migrate.js'], { cwd, env, encoding: 'utf8' });
const guarda = (...args) => spawnSync('node', ['database/guarda-demonstracao.js', ...args], { cwd, env, encoding: 'utf8' });
const tabelas = async () =>
  Number((await pool.query(`SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n);

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE ${BANCO}`);
  pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: BANCO,
  });
  expect(migrar().status).toBe(0);
}, 60_000);

afterAll(async () => {
  await pool?.end();
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    try {
      await adminPool.query(`DROP DATABASE IF EXISTS ${BANCO}`);
      break;
    } catch (erro) {
      if (erro.code !== '55006' || tentativa === 49) throw erro;
      await new Promise((ok) => setTimeout(ok, 100));
    }
  }
  await adminPool.end();
});

describe('reiniciar-demonstracao.sql', () => {
  it('num banco sem a marca (a produção), recusa e não apaga nada', async () => {
    const antes = await tabelas();
    expect(antes).toBeGreaterThan(10);

    await expect(pool.query(SCRIPT)).rejects.toThrow(/não está marcado como de demonstração/);
    await pool.query('ROLLBACK').catch(() => {});

    expect(await tabelas()).toBe(antes);
  });

  it('com a marca falsa ou sem valor, também recusa', async () => {
    await pool.query(`INSERT INTO configuracao (chave, valor) VALUES ('ambiente_demonstracao', 'false'::jsonb)`);
    await expect(pool.query(SCRIPT)).rejects.toThrow(/RECUSADO/);
    await pool.query('ROLLBACK').catch(() => {});
    expect(await tabelas()).toBeGreaterThan(10);
  });

  it('marcado, zera o schema — e o banco volta a poder ser migrado, marcado e semeado do zero', async () => {
    await pool.query(`UPDATE configuracao SET valor = 'true'::jsonb WHERE chave = 'ambiente_demonstracao'`);
    await pool.query(
      `INSERT INTO usuario (nome, email, senha_hash, perfil) VALUES ('Conta', 'c@demo.exemplo.com', 'x', 'solicitante')`
    );

    await pool.query(SCRIPT);
    expect(await tabelas()).toBe(0);

    // Banco novo outra vez: a trava libera, migra, marca.
    expect(guarda().status).toBe(0);
    expect(migrar().status).toBe(0);
    expect(guarda('--marcar').status).toBe(0);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM usuario`);
    expect(rows[0].n).toBe(0);
  });

  it('num banco sem tabelas, recusa com a mesma mensagem, e não com um erro de relação', async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

    await expect(pool.query(SCRIPT)).rejects.toThrow(/RECUSADO: este banco não tem as tabelas/);
    await pool.query('ROLLBACK').catch(() => {});
  });
});

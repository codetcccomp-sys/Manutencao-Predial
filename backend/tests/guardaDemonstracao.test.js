const path = require('path');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');
const adminPool = require('../src/config/db');
const { avaliar, PROJETO_DE_PRODUCAO } = require('../database/guarda-demonstracao');

/**
 * A trava do banco da demonstração (database/guarda-demonstracao.js).
 *
 * O que ela impede é o semeador escrever contas e chamados no banco de
 * produção. Por isso o teste cobre cada decisão com o dado que a provoca, e
 * roda o script de verdade, como o GitHub o roda, contra um banco criado só
 * para isto: a marca é uma linha em `configuracao`, e o que importa é que ela
 * só apareça onde pode.
 */

const PRODUCAO = `postgresql://postgres.${PROJETO_DE_PRODUCAO}:x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`;
const VAZIO = { chamados: 0, usuarios: 0, temConfiguracao: true, marcado: false };

describe('avaliar (a decisão, sem banco)', () => {
  it('recusa o endereço da produção em qualquer forma, com ou sem marca no banco', () => {
    for (const endereco of [PRODUCAO, `db.${PROJETO_DE_PRODUCAO}.supabase.co`, PRODUCAO.toUpperCase()]) {
      for (const banco of [null, VAZIO, { ...VAZIO, marcado: true }]) {
        expect(avaliar({ endereco, banco, marcar: true }).ok).toBe(false);
        expect(avaliar({ endereco, banco, marcar: false }).ok).toBe(false);
      }
    }
  });

  it('banco sem tabelas passa para migrar, mas não pode ser marcado ainda', () => {
    expect(avaliar({ endereco: 'localhost', banco: null, marcar: false }).ok).toBe(true);
    expect(avaliar({ endereco: 'localhost', banco: null, marcar: true }).ok).toBe(false);
  });

  it('banco vazio é marcado, e só quando se pede a marca', () => {
    expect(avaliar({ endereco: 'localhost', banco: VAZIO, marcar: true })).toMatchObject({ ok: true, marcar: true });
    expect(avaliar({ endereco: 'localhost', banco: VAZIO, marcar: false })).toMatchObject({ ok: true, marcar: false });
  });

  it('banco com chamado ou com conta e sem a marca é recusado', () => {
    for (const banco of [
      { ...VAZIO, chamados: 1 },
      { ...VAZIO, usuarios: 1 },
      { ...VAZIO, chamados: 40, usuarios: 9 },
    ]) {
      expect(avaliar({ endereco: 'localhost', banco, marcar: true }).ok).toBe(false);
      expect(avaliar({ endereco: 'localhost', banco, marcar: false }).ok).toBe(false);
    }
  });

  it('banco já marcado segue, com dados ou sem, e não regrava a marca', () => {
    const marcado = { chamados: 40, usuarios: 9, temConfiguracao: true, marcado: true };
    expect(avaliar({ endereco: 'localhost', banco: marcado, marcar: true })).toMatchObject({ ok: true, marcar: false });
  });

  it('sem a tabela de configuração não há onde gravar a marca', () => {
    expect(avaliar({ endereco: 'localhost', banco: { ...VAZIO, temConfiguracao: false }, marcar: true }).ok).toBe(false);
  });
});

describe('o script, contra um banco descartável', () => {
  const MARCA = `gd${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const BANCO = `smp_guarda_${MARCA}`;
  const cwd = path.join(__dirname, '..');
  let pool;

  const rodar = (args = [], env = {}) =>
    spawnSync('node', ['database/guarda-demonstracao.js', ...args], {
      cwd,
      env: { ...process.env, DB_NAME: BANCO, DATABASE_URL: '', ...env },
      encoding: 'utf8',
    });
  const marcaGravada = async () =>
    (await pool.query(`SELECT valor FROM configuracao WHERE chave = 'ambiente_demonstracao'`)).rows[0]?.valor;

  beforeAll(async () => {
    await adminPool.query(`CREATE DATABASE ${BANCO}`);
    pool = new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: BANCO,
    });
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

  it('1. banco novo, sem tabelas: libera a migração e recusa marcar', () => {
    expect(rodar().status).toBe(0);
    const marcando = rodar(['--marcar']);
    expect(marcando.status).toBe(1);
    expect(marcando.stdout).toContain('migrate');
  });

  it('2. depois do migrate, o banco vazio é marcado — e marcar de novo não muda nada', async () => {
    const migrar = spawnSync('node', ['database/migrate.js'], {
      cwd,
      env: { ...process.env, DB_NAME: BANCO, DATABASE_URL: '' },
      encoding: 'utf8',
    });
    expect(migrar.status).toBe(0);
    expect(await marcaGravada()).toBeUndefined();

    expect(rodar().status).toBe(0);
    expect(await marcaGravada()).toBeUndefined(); // só conferir não grava

    expect(rodar(['--marcar']).status).toBe(0);
    expect(await marcaGravada()).toBe(true);
    expect(rodar(['--marcar']).status).toBe(0);
  });

  it('3. marcado, o banco aceita dados e continua liberado', async () => {
    await pool.query(
      `INSERT INTO usuario (nome, email, senha_hash, perfil) VALUES ('Admin demo', 'a@demo.exemplo.com', 'x', 'administrador')`
    );
    expect(rodar().status).toBe(0);
    expect(rodar(['--marcar']).status).toBe(0);
  });

  it('4. sem a marca e com conta, recusa — e não grava a marca', async () => {
    await pool.query(`DELETE FROM configuracao WHERE chave = 'ambiente_demonstracao'`);
    for (const args of [[], ['--marcar']]) {
      const resp = rodar(args);
      expect(resp.status).toBe(1);
      expect(resp.stdout).toContain('RECUSADO');
    }
    expect(await marcaGravada()).toBeUndefined();
  });

  it('5. o endereço da produção é recusado antes de qualquer conexão', () => {
    // O banco do teste não é tocado: a recusa acontece só pelo texto da URL.
    const resp = rodar(['--marcar'], { DATABASE_URL: PRODUCAO });
    expect(resp.status).toBe(1);
    expect(resp.stdout).toContain('PRODUÇÃO');
    // E o endereço não vai para o log, nem na recusa nem em falha.
    expect(resp.stdout + resp.stderr).not.toContain(PROJETO_DE_PRODUCAO);
  });
});

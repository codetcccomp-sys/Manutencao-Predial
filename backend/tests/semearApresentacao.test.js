const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');
const adminPool = require('../src/config/db');

/**
 * Os dados fictícios da apresentação, na produção (database/semear-apresentacao.sql e
 * database/remover-apresentacao.sql; docs/apresentacao-na-producao.md).
 *
 * O perigo dos dois lados é o mesmo: dado inventado onde há uso real. Por isso o teste prova as
 * travas (nenhum chamado real, nenhuma rodada anterior), que nada do que o seed grava consegue
 * mandar e-mail, e que a remoção leva o fictício e deixa o real. Roda os arquivos como eles são,
 * num banco só deste teste, criado e migrado aqui e descartado no fim.
 */

const SEMEAR = fs.readFileSync(path.join(__dirname, '../database/semear-apresentacao.sql'), 'utf8');
const REMOVER = fs.readFileSync(path.join(__dirname, '../database/remover-apresentacao.sql'), 'utf8');
const MARCA = `apr${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const BANCO = `smp_apresentacao_${MARCA}`;

let pool; // o banco descartável

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE ${BANCO}`);
  const migrar = spawnSync('node', ['database/migrate.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DB_NAME: BANCO },
    encoding: 'utf8',
  });
  if (migrar.status !== 0) throw new Error(`migração do banco descartável falhou:\n${migrar.stdout}\n${migrar.stderr}`);
  pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: BANCO,
  });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    try {
      await adminPool.query(`DROP DATABASE IF EXISTS ${BANCO}`);
      break;
    } catch (erro) {
      if (erro.code !== '55006' || tentativa === 49) throw erro; // 55006: ainda em uso
      await new Promise((ok) => setTimeout(ok, 100));
    }
  }
  await adminPool.end();
});

async function emTransacao(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const um = async (client, sql, params) => (await client.query(sql, params)).rows[0];
const contar = async (client, sql, params) => Number((await um(client, `SELECT count(*) AS n FROM (${sql}) x`, params)).n);

/** Uma conta real, como as que o dono cadastrou para testar. */
async function contaReal(client, quem, perfil) {
  return (
    await um(
      client,
      `INSERT INTO usuario (nome, email, senha_hash, perfil) VALUES ($1, $2, 'x', $3) RETURNING id`,
      [`Real ${quem}`, `${MARCA}_${quem}@gmail.com`, perfil]
    )
  ).id;
}

async function chamadoReal(client, solicitanteId) {
  const local = (await um(client, `INSERT INTO local (unidade) VALUES ($1) RETURNING id`, [`Real ${MARCA}`])).id;
  return (
    await um(
      client,
      `INSERT INTO chamado (protocolo, titulo, descricao, categoria_id, local_id, solicitante_id, prazo_estimado)
       VALUES ('SMP-20261101-AB12CD', 'Chamado de verdade', 'Veio de uma pessoa de verdade.',
               (SELECT min(id) FROM categoria), $2, $1, now() + interval '1 day')
       RETURNING id`,
      [solicitanteId, local]
    )
  ).id;
}

describe('semear a apresentação', () => {
  test('grava 35 chamados em todos os estados, com histórico, e as contas fictícias nascem inativas', () =>
    emTransacao(async (client) => {
      await client.query(SEMEAR);

      expect(await contar(client, `SELECT 1 FROM chamado WHERE protocolo LIKE 'SMP-%-DEMO%'`)).toBe(35);
      const estados = (await client.query(`SELECT DISTINCT estado::text FROM chamado ORDER BY 1`)).rows.map((r) => r.estado);
      expect(estados).toEqual(
        ['aberto', 'aguardando_material', 'atribuido', 'cancelado', 'concluido', 'em_andamento', 'em_triagem'].sort()
      );
      // Cada chamado tem ao menos a abertura na linha do tempo, e os concluídos têm a conclusão.
      expect(
        await contar(client, `SELECT 1 FROM chamado c WHERE NOT EXISTS (SELECT 1 FROM historico_chamado h WHERE h.chamado_id = c.id AND h.estado_novo = 'aberto')`)
      ).toBe(0);
      expect(
        await contar(client, `SELECT 1 FROM chamado c WHERE estado = 'concluido' AND NOT EXISTS (SELECT 1 FROM historico_chamado h WHERE h.chamado_id = c.id AND h.estado_novo = 'concluido')`)
      ).toBe(0);

      const contas = (await client.query(`SELECT ativo, email FROM usuario WHERE email LIKE '%@conserva.invalid'`)).rows;
      expect(contas.length).toBeGreaterThan(0);
      expect(contas.filter((c) => c.ativo)).toEqual([]);
    }));

  test('sem conta real de técnico e de solicitante, as fictícias ocupam o lugar', () =>
    emTransacao(async (client) => {
      await client.query(SEMEAR);
      expect(await contar(client, `SELECT 1 FROM usuario WHERE email LIKE '%@conserva.invalid'`)).toBe(8);
      expect(await contar(client, `SELECT 1 FROM chamado WHERE tecnico_id IS NULL AND estado IN ('atribuido', 'em_andamento', 'concluido')`)).toBe(0);
    }));

  test('com conta real, a mais antiga de técnico e de solicitante entra na história', () =>
    emTransacao(async (client) => {
      const tecnico = await contaReal(client, 'tec', 'tecnico');
      const solicitante = await contaReal(client, 'sol', 'solicitante');
      await client.query(SEMEAR);

      expect(await contar(client, `SELECT 1 FROM usuario WHERE email LIKE '%@conserva.invalid'`)).toBe(6);
      expect(await contar(client, `SELECT 1 FROM chamado WHERE tecnico_id = $1`, [tecnico])).toBeGreaterThan(0);
      expect(await contar(client, `SELECT 1 FROM chamado WHERE solicitante_id = $1`, [solicitante])).toBeGreaterThan(0);
      // A conta real continua como estava: o seed não a ativa nem a desativa.
      expect((await um(client, `SELECT ativo FROM usuario WHERE id = $1`, [tecnico])).ativo).toBe(true);
    }));

  test('nada do que o seed grava manda e-mail nem dispara a tarefa de 15 minutos', () =>
    emTransacao(async (client) => {
      await client.query(SEMEAR);

      // Aviso sem a hora de envio é o que o despachante pegaria.
      expect(await contar(client, `SELECT 1 FROM notificacao WHERE email_enviado_em IS NULL`)).toBe(0);
      // O que a varredura de atrasos reivindicaria (atrasos.service) e o que o aviso de crítico
      // sem atendimento procuraria (criticos.service): nada.
      expect(
        await contar(
          client,
          `SELECT 1 FROM chamado WHERE estado NOT IN ('concluido', 'cancelado') AND prazo_estimado IS NOT NULL
              AND now() > prazo_estimado AND atraso_notificado_para IS DISTINCT FROM prazo_estimado`
        )
      ).toBe(0);
      expect(
        await contar(client, `SELECT 1 FROM chamado WHERE estado = 'aberto' AND prioridade = 'critica'`)
      ).toBe(0);
      // Mas a demonstração mostra atraso de verdade na tela.
      expect(
        await contar(client, `SELECT 1 FROM chamado WHERE estado NOT IN ('concluido', 'cancelado') AND now() > prazo_estimado`)
      ).toBeGreaterThan(0);
    }));

  test('a prioridade sai da regra vigente e só um chamado diverge, com justificativa', () =>
    emTransacao(async (client) => {
      await client.query(SEMEAR);
      const divergentes = (
        await client.query(`SELECT protocolo, prioridade_justificativa FROM chamado WHERE prioridade IS DISTINCT FROM prioridade_sugerida`)
      ).rows;
      expect(divergentes).toHaveLength(1);
      expect(divergentes[0].prioridade_justificativa.length).toBeGreaterThanOrEqual(10);
      // Risco 4 é crítico pela regra (RN04), qualquer que seja a soma.
      expect(
        await contar(client, `SELECT 1 FROM chamado WHERE risco >= 4 AND prioridade <> 'critica'`)
      ).toBe(0);
    }));

  test('recusa onde há chamado real, e não grava nada', () =>
    emTransacao(async (client) => {
      const solicitante = await contaReal(client, 'sol2', 'solicitante');
      await chamadoReal(client, solicitante);

      await expect(client.query(SEMEAR)).rejects.toThrow(/uso real/);
    }));

  test('recusa uma segunda rodada, para refazer com datas de hoje é preciso remover antes', () =>
    emTransacao(async (client) => {
      await client.query(SEMEAR);
      await expect(client.query(SEMEAR)).rejects.toThrow(/já está semeada/);
    }));
});

describe('remover a apresentação', () => {
  test('leva os chamados e as contas fictícias e deixa o que é real', () =>
    emTransacao(async (client) => {
      const tecnico = await contaReal(client, 'tec3', 'tecnico');
      const solicitante = await contaReal(client, 'sol3', 'solicitante');
      await client.query(SEMEAR);
      // Depois do seed, o uso real começa: um chamado de verdade, com um comentário e um aviso.
      const real = await chamadoReal(client, solicitante);
      await client.query(`INSERT INTO comentario (chamado_id, usuario_id, texto) VALUES ($1, $2, 'Comentário real')`, [real, tecnico]);
      await client.query(
        `INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem, email_enviado_em) VALUES ($1, $2, 'comentario', 'Aviso real', now())`,
        [solicitante, real]
      );
      const locais = await contar(client, `SELECT 1 FROM local`);
      const categorias = await contar(client, `SELECT 1 FROM categoria`);

      await client.query(REMOVER);

      expect(await contar(client, `SELECT 1 FROM chamado WHERE protocolo LIKE 'SMP-%-DEMO%'`)).toBe(0);
      expect(await contar(client, `SELECT 1 FROM usuario WHERE email LIKE '%@conserva.invalid'`)).toBe(0);
      // O real fica inteiro.
      expect(await contar(client, `SELECT 1 FROM chamado WHERE id = $1`, [real])).toBe(1);
      expect(await contar(client, `SELECT 1 FROM comentario WHERE chamado_id = $1`, [real])).toBe(1);
      expect(await contar(client, `SELECT 1 FROM notificacao WHERE chamado_id = $1`, [real])).toBe(1);
      expect(await contar(client, `SELECT 1 FROM usuario WHERE id IN ($1, $2)`, [tecnico, solicitante])).toBe(2);
      // E tudo que pendurava nos chamados fictícios sumiu com eles.
      expect(await contar(client, `SELECT 1 FROM historico_chamado h WHERE h.chamado_id <> $1`, [real])).toBe(0);
      expect(await contar(client, `SELECT 1 FROM avaliacao`)).toBe(0);
      expect(await contar(client, `SELECT 1 FROM comentario WHERE chamado_id <> $1`, [real])).toBe(0);
      // O cadastro (locais, categorias) não é do seed.
      expect(await contar(client, `SELECT 1 FROM local`)).toBe(locais);
      expect(await contar(client, `SELECT 1 FROM categoria`)).toBe(categorias);
    }));

  test('recusa apagar conta fictícia que alguém ativou', () =>
    emTransacao(async (client) => {
      await client.query(SEMEAR);
      await client.query(`UPDATE usuario SET ativo = true WHERE email = 'ana.ribeiro@conserva.invalid'`);
      await expect(client.query(REMOVER)).rejects.toThrow(/conta fictícia ativa/);
    }));

  test('depois de remover, o seed roda de novo na mesma sessão', () =>
    emTransacao(async (client) => {
      await client.query(SEMEAR);
      await client.query(REMOVER);
      await client.query(SEMEAR);
      expect(await contar(client, `SELECT 1 FROM chamado WHERE protocolo LIKE 'SMP-%-DEMO%'`)).toBe(35);
    }));
});

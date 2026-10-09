const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');
const adminPool = require('../src/config/db');

/**
 * A limpeza da demonstração (database/limpar-demonstracao.sql), que roda uma
 * vez, em produção, no dia em que o piloto começa.
 *
 * Por isso o teste roda o arquivo como ele é, numa transação desfeita no fim,
 * sobre uma demonstração em miniatura que toca toda tabela que aponta para
 * conta ou chamado.
 *
 * E num banco só dele, criado e migrado aqui e descartado no fim. O script
 * apaga o banco inteiro e trava as tabelas até o fim da transação; no banco
 * compartilhado, isso derrubaria (ou deixaria em deadlock) as outras suítes
 * quando rodam juntas, e uma delas deixa dado que o script, de propósito,
 * recusa. A migração real é a que constrói o banco: se uma tabela nova passar
 * a apontar para conta ou chamado, o teste de chaves estrangeiras abaixo vê.
 */

const SCRIPT = fs.readFileSync(path.join(__dirname, '../database/limpar-demonstracao.sql'), 'utf8');
const MARCA = `limp${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const BANCO = `smp_limpeza_${MARCA}`;
const email = (quem) => `${MARCA}_${quem}@exemplo.com`;

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
  // Sem FORCE: ele derruba as conexões à força, e uma que ainda estava
  // fechando chega ao Node como erro sem tratador. As conexões do banco saem
  // sozinhas em milissegundos; basta esperar por elas.
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

async function conta(client, quem, perfil) {
  const { rows } = await client.query(
    `INSERT INTO usuario (nome, email, senha_hash, perfil) VALUES ($1, $2, 'x', $3) RETURNING id`,
    [`Limpeza ${quem}`, email(quem), perfil]
  );
  return rows[0].id;
}

/** Uma demonstração pequena: cada tabela ligada a conta ou chamado com uma linha. */
async function demonstracao(client) {
  const d = {};
  d.admin = await conta(client, 'admin', 'administrador');
  d.gestorDemo = await conta(client, 'gestordemo', 'gestor');
  d.gestorReal = await conta(client, 'gestorreal', 'gestor');
  d.tecnico = await conta(client, 'tecnico', 'tecnico');
  d.solicitante = await conta(client, 'solicitante', 'solicitante');

  const um = async (sql, params) => (await client.query(sql, params)).rows[0]?.id;

  d.local = await um('INSERT INTO local (unidade) VALUES ($1) RETURNING id', [MARCA]);
  d.categoria = await um('INSERT INTO categoria (nome) VALUES ($1) RETURNING id', [MARCA]);
  d.equipe = await um('INSERT INTO equipe (nome) VALUES ($1) RETURNING id', [MARCA]);
  await client.query('INSERT INTO equipe_tecnico (equipe_id, usuario_id) VALUES ($1, $2)', [d.equipe, d.tecnico]);
  d.material = await um(`INSERT INTO material (nome, unidade_medida) VALUES ($1, 'un') RETURNING id`, [MARCA]);

  // Plano mensal que já gerou novembro e dezembro, com a próxima em janeiro.
  d.plano = await um(
    `INSERT INTO plano_preventivo (titulo, descricao, local_id, categoria_id, repetir_a_cada, unidade_repeticao,
                                   data_inicio, proxima_execucao, criado_por, tecnico_id)
     VALUES ($1, 'Inspeção mensal.', $2, $3, 1, 'mes', '2026-01-03', '2027-01-03', $4, $5) RETURNING id`,
    [MARCA, d.local, d.categoria, d.gestorDemo, d.tecnico]
  );
  const chamado = async (campos) =>
    um(
      `INSERT INTO chamado (protocolo, titulo, descricao, categoria_id, local_id, solicitante_id, tecnico_id,
                            estado, origem, plano_id, data_prevista, servico_realizado, data_conclusao)
       VALUES ($1, $2, 'Demonstração.', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        `${MARCA}-${Math.random().toString(36).slice(2, 8)}`,
        MARCA,
        d.categoria,
        d.local,
        campos.solicitante ?? d.solicitante,
        campos.tecnico ?? null,
        campos.estado ?? 'aberto',
        campos.plano ? 'preventiva' : 'corretiva',
        campos.plano ?? null,
        campos.data ?? null,
        campos.estado === 'concluido' ? 'Serviço feito na demonstração.' : null,
        campos.estado === 'concluido' ? '2026-10-04' : null,
      ]
    );
  await chamado({ plano: d.plano, data: '2026-10-03', estado: 'concluido', solicitante: d.gestorDemo });
  await chamado({ plano: d.plano, data: '2026-11-03', estado: 'atribuido', solicitante: d.gestorDemo, tecnico: d.tecnico });
  await chamado({ plano: d.plano, data: '2026-12-03', estado: 'aberto', solicitante: d.gestorDemo });

  d.corretivo = await chamado({ estado: 'em_andamento', tecnico: d.tecnico });
  await client.query(
    `INSERT INTO historico_chamado (chamado_id, usuario_id, estado_novo) VALUES ($1, $2, 'aberto')`,
    [d.corretivo, d.solicitante]
  );
  await client.query(`INSERT INTO comentario (chamado_id, usuario_id, texto) VALUES ($1, $2, 'A caminho.')`, [
    d.corretivo,
    d.tecnico,
  ]);
  await client.query(
    `INSERT INTO anexo (chamado_id, usuario_id, tipo, nome_arquivo, mime_type, tamanho_bytes, conteudo)
     VALUES ($1, $2, 'foto', 'foto.jpg', 'image/jpeg', 3, '\\xffd8ff')`,
    [d.corretivo, d.solicitante]
  );
  await client.query('INSERT INTO avaliacao (chamado_id, nota) VALUES ($1, 5)', [d.corretivo]);
  await client.query('INSERT INTO chamado_material (chamado_id, material_id, quantidade) VALUES ($1, $2, 1)', [
    d.corretivo,
    d.material,
  ]);
  await client.query(
    `INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem) VALUES ($1, $2, 'atribuicao', 'Novo.')`,
    [d.gestorReal, d.corretivo]
  );

  d.regra = await um(
    `INSERT INTO regra_distribuicao (categoria_id, equipe_id, tecnico_id, criado_por) VALUES ($1, $2, $3, $4) RETURNING id`,
    [d.categoria, d.equipe, d.tecnico, d.gestorDemo]
  );
  await client.query(
    `INSERT INTO configuracao (chave, valor, atualizado_por) VALUES ('cadastro_exige_aprovacao', 'false', $1)
     ON CONFLICT (chave) DO UPDATE SET atualizado_por = EXCLUDED.atualizado_por`,
    [d.gestorDemo]
  );
  await client.query(
    `INSERT INTO recuperacao_senha (usuario_id, token_hash, expira_em) VALUES ($1, $2, now() + interval '1 hour')`,
    [d.gestorDemo, MARCA]
  );
  await client.query(`INSERT INTO codigo_recuperacao_2fa (usuario_id, codigo_hash) VALUES ($1, $2)`, [
    d.gestorDemo,
    MARCA,
  ]);
  await client.query(`INSERT INTO tentativa_login (email, ip, sucesso) VALUES ($1, '10.0.0.1', false)`, [
    email('gestordemo'),
  ]);
  return d;
}

async function limpar(client, manter) {
  await client.query(`SELECT set_config('limpeza.manter', $1, true)`, [manter]);
  const resultados = await client.query(SCRIPT);
  return resultados.at(-1).rows;
}

const contar = async (client, tabela) => Number((await client.query(`SELECT count(*) FROM ${tabela}`)).rows[0].count);

jest.setTimeout(30_000);

describe('Limpeza da demonstração', () => {
  test('apaga chamados e contas que saem, e mantém o cadastro', async () => {
    await emTransacao(async (client) => {
      const d = await demonstracao(client);
      const resumo = await limpar(client, ` ${email('gestorreal').toUpperCase()} `);

      for (const tabela of ['chamado', 'historico_chamado', 'comentario', 'anexo', 'avaliacao', 'chamado_material', 'notificacao', 'tentativa_login']) {
        expect([tabela, await contar(client, tabela)]).toEqual([tabela, 0]);
      }

      const { rows: ficaram } = await client.query('SELECT id FROM usuario WHERE email LIKE $1', [`${MARCA}%`]);
      expect(ficaram.map((u) => u.id).sort()).toEqual([d.admin, d.gestorReal].sort());
      // Nenhuma conta fora de administrador e da lista sobrevive.
      expect(
        Number((await client.query(`SELECT count(*) FROM usuario WHERE perfil <> 'administrador' AND id <> $1`, [d.gestorReal])).rows[0].count)
      ).toBe(0);

      // O cadastro fica, solto de quem saiu.
      const { rows: [herdeiro] } = await client.query(
        `SELECT min(id) AS id FROM usuario WHERE perfil = 'administrador' AND ativo AND anonimizado_em IS NULL`
      );
      const { rows: [plano] } = await client.query('SELECT * FROM plano_preventivo WHERE id = $1', [d.plano]);
      expect(plano).toMatchObject({ tecnico_id: null, criado_por: herdeiro.id });
      const { rows: [regra] } = await client.query('SELECT * FROM regra_distribuicao WHERE id = $1', [d.regra]);
      expect(regra).toMatchObject({ tecnico_id: null, criado_por: herdeiro.id, equipe_id: d.equipe });
      expect(await contar(client, `equipe WHERE id = ${d.equipe}`)).toBe(1);
      expect(await contar(client, `local WHERE id = ${d.local}`)).toBe(1);
      expect(await contar(client, `material WHERE id = ${d.material}`)).toBe(1);
      const { rows: [config] } = await client.query(
        `SELECT atualizado_por FROM configuracao WHERE chave = 'cadastro_exige_aprovacao'`
      );
      expect(config.atualizado_por).toBeNull();

      // O resumo diz quanto havia, quanto ficou e quem ficou.
      const linha = (item) => resumo.find((r) => r.item === item);
      expect(Number(linha('chamado').depois)).toBe(0);
      expect(Number(linha('chamado').antes)).toBeGreaterThanOrEqual(4);
      expect(Number(linha('local').antes)).toBe(Number(linha('local').depois));
      expect(resumo.map((r) => r.item)).toContain(`fica: ${email('gestorreal')} (gestor)`);
      expect(resumo.map((r) => r.item)).toContain(`fica: ${email('admin')} (administrador)`);
    });
  });

  test('a preventiva aberta que sai volta para a fila do plano', async () => {
    await emTransacao(async (client) => {
      const d = await demonstracao(client);
      await limpar(client, 'so-administradores');
      // Novembro estava gerado e aberto: o plano volta para ele, e não pula
      // para janeiro. Outubro, concluído, não volta.
      const { rows } = await client.query('SELECT proxima_execucao FROM plano_preventivo WHERE id = $1', [d.plano]);
      expect(rows[0].proxima_execucao).toBe('2026-11-03');
    });
  });

  // A trava vale até o fim da transação: uma escrita de fora espera, e não
  // entra no meio da limpeza.
  test('enquanto a limpeza não termina, ninguém escreve num chamado', async () => {
    await emTransacao(async (client) => {
      await demonstracao(client);
      await limpar(client, 'so-administradores');
      const outra = await pool.connect();
      try {
        await outra.query("SET lock_timeout = '200ms'");
        await expect(outra.query("UPDATE chamado SET titulo = titulo WHERE false")).rejects.toThrow(/lock timeout/);
      } finally {
        // Destruída, não devolvida: a conexão voltaria ao pool com o limite de
        // 200 ms na sessão, e o teste da espera da limpeza passaria por ele.
        outra.release(true);
      }
    });
  });

  // Uma escrita em andamento segura a tabela: a limpeza espera um pouco e
  // desiste, sem apagar nada, em vez de travar a fila de quem usa o sistema.
  test('com uma escrita em andamento, a limpeza desiste da espera em vez de travar a fila', async () => {
    const escrita = await pool.connect();
    try {
      // Escrita aberta e não concluída: segura a tabela do chamado.
      await escrita.query('BEGIN');
      await demonstracao(escrita);

      await emTransacao(async (client) => {
        await client.query(`SELECT set_config('limpeza.espera', '200ms', true)`);
        // Rede de segurança do próprio teste: sem o limite do script, a espera
        // seria eterna e o Jest não conseguiria encerrar. Com ela, o teste
        // falha em segundos dizendo "statement timeout", não "lock timeout".
        await client.query(`SELECT set_config('statement_timeout', '3s', true)`);
        await expect(limpar(client, 'so-administradores')).rejects.toThrow(/lock timeout/);
      });
    } finally {
      await escrita.query('ROLLBACK');
      escrita.release();
    }
  });

  test('roda duas vezes sem erro: a segunda não acha o que apagar', async () => {
    await emTransacao(async (client) => {
      await demonstracao(client);
      await limpar(client, email('gestorreal'));
      const resumo = await limpar(client, email('gestorreal'));
      const chamado = resumo.find((r) => r.item === 'chamado');
      expect([Number(chamado.antes), Number(chamado.depois)]).toEqual([0, 0]);
    });
  });

  describe('travas', () => {
    test('sem dizer quem fica, não apaga nada', async () => {
      await emTransacao(async (client) => {
        await expect(client.query(SCRIPT)).rejects.toThrow(/Diga antes quais contas ficam/);
      });
    });

    // Na conexão reaproveitada a variável já usada volta vazia, não ausente.
    // Vazio não pode virar "fica só a administração".
    test('lista vazia também não apaga nada', async () => {
      await emTransacao(async (client) => {
        await expect(limpar(client, '  ')).rejects.toThrow(/Diga antes quais contas ficam/);
      });
    });

    test('e-mail que não existe na lista para tudo (um erro de digitação apagaria a conta certa)', async () => {
      await emTransacao(async (client) => {
        await demonstracao(client);
        await expect(limpar(client, `${email('gestorreal')}, ${MARCA}_digitado_errado@exemplo.com`)).rejects.toThrow(
          new RegExp(`Sem conta com este e-mail.*${MARCA}_digitado_errado`)
        );
      });
    });

    test('anexo no Storage para tudo: a linha sairia, o arquivo ficaria', async () => {
      await emTransacao(async (client) => {
        const d = await demonstracao(client);
        await client.query(
          `INSERT INTO anexo (chamado_id, usuario_id, tipo, nome_arquivo, mime_type, tamanho_bytes, armazenamento, chave_externa)
           VALUES ($1, $2, 'foto', 'f.jpg', 'image/jpeg', 3, 'supabase', $3)`,
          [d.corretivo, d.solicitante, `${MARCA}/f.jpg`]
        );
        await expect(limpar(client, 'so-administradores')).rejects.toThrow(/anexos no Supabase Storage/);
      });
    });

    test('sem administrador ativo, não roda', async () => {
      await emTransacao(async (client) => {
        await client.query(`UPDATE usuario SET ativo = FALSE WHERE perfil = 'administrador'`);
        await expect(limpar(client, 'so-administradores')).rejects.toThrow(/Nenhum administrador ativo/);
      });
    });
  });

  // A trava que importa para o futuro: uma tabela nova que aponte para conta
  // ou chamado e que o script não trate faria a limpeza falhar no dia do
  // piloto. Aqui ela falha antes, no CI, com o nome da tabela.
  test('trata toda chave estrangeira que aponta para usuario ou chamado', async () => {
    const { rows } = await pool.query(
      `SELECT c.conrelid::regclass::text AS tabela, a.attname AS coluna
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.confrelid IN ('usuario'::regclass, 'chamado'::regclass)`
    );
    expect(rows.length).toBeGreaterThan(10);
    const semTratamento = rows
      .filter(({ tabela, coluna }) => {
        const apagaTudo = new RegExp(`DELETE FROM ${tabela};`).test(SCRIPT);
        const trataColuna = new RegExp(`(UPDATE|DELETE FROM) ${tabela}\\b[^;]*\\b${coluna}\\b`).test(SCRIPT);
        return !apagaTudo && !trataColuna && tabela !== 'chamado';
      })
      .map(({ tabela, coluna }) => `${tabela}.${coluna}`);
    expect(semTratamento).toEqual([]);
  });
});


const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

/**
 * Guardas sobre as migrações que só a produção acusaria.
 *
 * Em produção o backend conecta como smp_backend, que não é dono do schema, e
 * os privilégios padrão do projeto não dão a ele EXECUTE em função nova (ver
 * migração 023, que tirou o EXECUTE de PUBLIC). Uma migração que cria função
 * sem o GRANT passa no CI — onde o papel pode nem existir — e quebra a
 * produção na primeira chamada.
 */
const DIR = path.join(__dirname, '../database/migrations');
const arquivos = fs.readdirSync(DIR).filter((n) => n.endsWith('.sql')).sort();

// Funções de gatilho não precisam: o gatilho dispara sem conferir EXECUTE de
// quem escreveu na tabela.
const DE_GATILHO = ['set_atualizado_em'];

describe('Migrações', () => {
  it.each(arquivos)('%s: toda função nova é concedida ao smp_backend', (arquivo) => {
    const sql = fs.readFileSync(path.join(DIR, arquivo), 'utf8');
    const criadas = [...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+(\w+)\s*\(/gi)]
      .map((m) => m[1])
      .filter((nome) => !DE_GATILHO.includes(nome));

    for (const funcao of criadas) {
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${funcao}\\s*\\([^)]*\\) TO smp_backend`, 'i'));
    }
  });

  it.each(arquivos)('%s: não liga RLS (bloquearia o smp_backend, que não é dono)', (arquivo) => {
    const sql = fs.readFileSync(path.join(DIR, arquivo), 'utf8').replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });
});

describe('Privilégios no banco migrado', () => {
  afterAll(async () => {
    await pool.end();
  });

  // anon e authenticated herdam o que PUBLIC tem, e a API automática do
  // Supabase expõe toda função executável em /rest/v1/rpc. As tabelas já
  // estavam fechadas (migração 005); as funções, só depois da 023.
  it('nenhuma função do schema public é executável por PUBLIC', async () => {
    const { rows } = await pool.query(
      `SELECT p.proname
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
          AND has_function_privilege('public', p.oid, 'EXECUTE')`
    );
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  // Sem search_path próprio, a função resolve nomes pelo de quem chama, e um
  // objeto homônimo num schema anterior a desviaria (lint
  // function_search_path_mutable do Supabase).
  it('toda função do schema public fixa o próprio search_path', async () => {
    const { rows } = await pool.query(
      `SELECT p.proname
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
          AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')`
    );
    expect(rows.map((r) => r.proname)).toEqual([]);
  });
});

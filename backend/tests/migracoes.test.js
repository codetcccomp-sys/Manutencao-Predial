const fs = require('fs');
const path = require('path');

/**
 * Guardas sobre as migrações que só a produção acusaria.
 *
 * Em produção o backend conecta como smp_backend, que não é dono do schema, e
 * os privilégios padrão do projeto não dão a ele EXECUTE em função nova (ver
 * migração 005). Uma migração que cria função sem o GRANT passa no CI — onde o
 * papel nem existe — e quebra a produção na primeira chamada.
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

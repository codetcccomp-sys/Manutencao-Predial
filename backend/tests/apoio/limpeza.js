/**
 * Limpeza dos chamados que a suíte cria.
 *
 * Os testes abrem chamados de verdade e não apagam nenhum: cada rodada deixa
 * algumas dezenas para trás. Num banco que vive entre rodadas — o de
 * desenvolvimento, e o do CI nunca, porque nasce vazio — isso soma, e chegou
 * a 20.169 chamados, acima do teto de 20.000 da exportação. O resultado foi um
 * teste de exportação que falhava por motivo nenhum do código: a recusa
 * 'EXPORTACAO_GRANDE' estava certa, o banco é que tinha enchido.
 *
 * O critério é quem abriu: chamado cujo solicitante tem e-mail de teste
 * (`@exemplo.com`, o domínio reservado que todas as suítes usam). Não é a
 * data nem "tudo desde o início da rodada": data apagaria o que outra pessoa
 * abriu à mão no mesmo banco, e o e-mail de teste só existe nas contas que a
 * própria suíte registrou.
 *
 * Só apaga chamados e o que depende deles. As contas de teste ficam: são
 * referenciadas por equipes, avisos e tentativas de login, e não atrapalham
 * ninguém — ao contrário do teto da exportação.
 */

const PADRAO_DE_TESTE = '%@exemplo.com';

// Duas travas, porque o contrário disso é apagar a apresentação: com
// DATABASE_URL o `db.js` fala com o pooler do Supabase, e NODE_ENV=production
// é como a Vercel roda. Em nenhum dos dois cabe uma limpeza de teste.
function recusarSeNaoForBancoDeTeste(ambiente = process.env) {
  if (ambiente.DATABASE_URL || ambiente.NODE_ENV === 'production') {
    throw new Error(
      'limpeza de testes recusada: DATABASE_URL ou NODE_ENV=production indicam banco real.'
    );
  }
}

// As tabelas que apontam para `chamado` por `chamado_id`, descobertas pelo
// banco e não listadas à mão: uma tabela nova ligada ao chamado entra sozinha,
// em vez de fazer a limpeza morrer numa violação de chave estrangeira.
async function tabelasDependentes(client) {
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

/**
 * Apaga os chamados de `ids` e o que depende deles, numa transação só.
 *
 * É a peça de baixo, para quem sabe exatamente o que criou: o teste de
 * anonimização abre um chamado com uma conta que ele mesmo anonimiza em
 * seguida, e dali em diante o e-mail dela é `removido-N@anonimizado.invalid`,
 * que nenhum padrão de teste alcança. Esse teste apaga pelo id.
 */
async function apagarChamados(client, ids) {
  if (ids.length === 0) return 0;

  await client.query('BEGIN');
  try {
    for (const tabela of await tabelasDependentes(client)) {
      await client.query(`DELETE FROM ${tabela} WHERE chamado_id = ANY($1::int[])`, [ids]);
    }
    await client.query('DELETE FROM chamado WHERE id = ANY($1::int[])', [ids]);
    await client.query('COMMIT');
    return ids.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/**
 * Apaga os chamados abertos por contas que casam com `padrao`, e o que
 * depende deles. Devolve quantos chamados saíram.
 *
 * `padrao` existe para o teste da própria limpeza: ele usa um domínio só dele
 * e não toca nos chamados das outras suítes, que podem estar rodando juntas.
 *
 * Contas anonimizadas ficam de fora de propósito: o e-mail delas deixou de
 * ser de teste, e ampliar o padrão para `.invalid` apagaria também o chamado
 * de uma pessoa anonimizada de verdade — justamente o que a anonimização
 * promete preservar. Quem anonimiza no teste apaga o que criou, por id.
 */
async function limparChamadosDeTeste(client, { padrao = PADRAO_DE_TESTE, ambiente = process.env } = {}) {
  recusarSeNaoForBancoDeTeste(ambiente);

  const { rows } = await client.query(
    `SELECT c.id FROM chamado c
       JOIN usuario u ON u.id = c.solicitante_id
      WHERE u.email LIKE $1`,
    [padrao]
  );
  return apagarChamados(
    client,
    rows.map((r) => r.id)
  );
}

module.exports = { limparChamadosDeTeste, apagarChamados, recusarSeNaoForBancoDeTeste, PADRAO_DE_TESTE };

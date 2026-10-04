const pool = require('../src/config/db');
const {
  limparChamadosDeTeste,
  recusarSeNaoForBancoDeTeste,
  PADRAO_DE_TESTE,
} = require('./apoio/limpeza');

// Domínio só desta suíte: a limpeza que roda aqui não pode levar os chamados
// das outras, que no modo paralelo podem estar no meio de um teste.
const marca = `${Date.now()}`;
const DOMINIO = `limpeza${marca}.exemplo.com`;
const PADRAO = `%@${DOMINIO}`;

let doTeste;
let deFora;
let chamadoDoTeste;
let chamadoDeFora;

async function inserirPessoa(email) {
  const { rows } = await pool.query(
    `INSERT INTO usuario (nome, email, senha_hash, perfil) VALUES ('Pessoa de teste', $1, 'x', 'solicitante') RETURNING id`,
    [email]
  );
  return rows[0].id;
}

async function inserirChamado(protocolo, solicitanteId) {
  const categoria = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
  const local = (await pool.query('SELECT id FROM local LIMIT 1')).rows[0].id;
  const { rows } = await pool.query(
    `INSERT INTO chamado (protocolo, titulo, descricao, categoria_id, local_id, solicitante_id)
     VALUES ($1, 'Chamado de teste', 'Descrição do chamado de teste.', $2, $3, $4) RETURNING id`,
    [protocolo, categoria, local, solicitanteId]
  );
  const id = rows[0].id;
  // Um dependente de cada espécie que a limpeza precisa levar junto.
  await pool.query(
    `INSERT INTO historico_chamado (chamado_id, usuario_id, estado_anterior, estado_novo) VALUES ($1, $2, 'aberto', 'em_triagem')`,
    [id, solicitanteId]
  );
  await pool.query(`INSERT INTO comentario (chamado_id, usuario_id, texto) VALUES ($1, $2, 'Comentário de teste')`, [
    id,
    solicitanteId,
  ]);
  return id;
}

const contar = async (tabela, id) =>
  (await pool.query(`SELECT count(*)::int AS n FROM ${tabela} WHERE chamado_id = $1`, [id])).rows[0].n;

async function rodar(opcoes = {}) {
  const client = await pool.connect();
  try {
    return await limparChamadosDeTeste(client, { padrao: PADRAO, ...opcoes });
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  doTeste = await inserirPessoa(`quem@${DOMINIO}`);
  deFora = await inserirPessoa(`quem.abriu.${marca}@real.exemplo.org`);
  chamadoDoTeste = await inserirChamado(`SMP-LIMPEZA-A${marca}`, doTeste);
  chamadoDeFora = await inserirChamado(`SMP-LIMPEZA-B${marca}`, deFora);
});

afterAll(async () => {
  const ids = [chamadoDoTeste, chamadoDeFora];
  for (const tabela of ['historico_chamado', 'comentario']) {
    await pool.query(`DELETE FROM ${tabela} WHERE chamado_id = ANY($1)`, [ids]);
  }
  await pool.query('DELETE FROM chamado WHERE id = ANY($1)', [ids]);
  await pool.query('DELETE FROM usuario WHERE id = ANY($1)', [[doTeste, deFora]]);
  await pool.end();
});

describe('Limpeza dos chamados de teste', () => {
  it('apaga o chamado da conta de teste e o que depende dele', async () => {
    expect(await rodar()).toBe(1);

    const { rows } = await pool.query('SELECT 1 FROM chamado WHERE id = $1', [chamadoDoTeste]);
    expect(rows).toHaveLength(0);
    // O histórico e o comentário saíram junto: sem eles o DELETE do chamado
    // morreria numa violação de chave estrangeira.
    expect(await contar('historico_chamado', chamadoDoTeste)).toBe(0);
    expect(await contar('comentario', chamadoDoTeste)).toBe(0);
  });

  it('não toca no chamado aberto por quem não é conta de teste', async () => {
    const { rows } = await pool.query('SELECT 1 FROM chamado WHERE id = $1', [chamadoDeFora]);
    expect(rows).toHaveLength(1);
    expect(await contar('historico_chamado', chamadoDeFora)).toBe(1);
    expect(await contar('comentario', chamadoDeFora)).toBe(1);
  });

  it('rodar de novo não acha nada e não erra', async () => {
    expect(await rodar()).toBe(0);
  });

  it('o padrão de produção é o domínio que as suítes usam', () => {
    expect(PADRAO_DE_TESTE).toBe('%@exemplo.com');
  });
});

describe('Trava contra banco real', () => {
  it('recusa com DATABASE_URL, que é o pooler do Supabase', async () => {
    expect(() => recusarSeNaoForBancoDeTeste({ DATABASE_URL: 'postgresql://x' })).toThrow(/banco real/);
    // E recusa antes de abrir transação ou ler uma linha.
    await expect(rodar({ ambiente: { DATABASE_URL: 'postgresql://x' } })).rejects.toThrow(/banco real/);
  });

  it('recusa com NODE_ENV=production', () => {
    expect(() => recusarSeNaoForBancoDeTeste({ NODE_ENV: 'production' })).toThrow(/banco real/);
  });

  it('deixa passar o ambiente de teste', () => {
    expect(() => recusarSeNaoForBancoDeTeste({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => recusarSeNaoForBancoDeTeste({})).not.toThrow();
  });
});

const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const {
  limparChamadosDeTeste,
  limparPlanosDeTeste,
  limparRegrasDeTeste,
  limparVersoesDeSlaDeTeste,
  limparUsuariosDeTeste,
  contasSemeadas,
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
let contaSolta;
let contaAutora;
let contaForaDoPadrao;
let contaSemeada;

async function inserirPessoa(email) {
  const { rows } = await pool.query(
    `INSERT INTO usuario (nome, email, senha_hash, perfil) VALUES ('Pessoa de teste', $1, 'x', 'solicitante') RETURNING id`,
    [email]
  );
  return rows[0].id;
}

async function inserirChamado(protocolo, solicitanteId) {
  const categoria = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
  const local = await garantirLocal({ unidade: 'Unidade da suíte de limpeza' });
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
  const contas = [doTeste, deFora, contaSolta, contaAutora, contaForaDoPadrao, contaSemeada].filter(Boolean);
  for (const tabela of ['historico_chamado', 'comentario']) {
    await pool.query(`DELETE FROM ${tabela} WHERE chamado_id = ANY($1)`, [ids]);
  }
  await pool.query('DELETE FROM chamado WHERE id = ANY($1)', [ids]);
  await pool.query('DELETE FROM notificacao WHERE usuario_id = ANY($1)', [contas]);
  await pool.query('DELETE FROM usuario WHERE id = ANY($1)', [contas]);
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

describe('Limpeza dos planos preventivos de teste', () => {
  async function inserirPlano(criadoPor) {
    const categoria = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
    const local = await garantirLocal({ unidade: 'Unidade da suíte de limpeza' });
    const { rows } = await pool.query(
      `INSERT INTO plano_preventivo
         (titulo, descricao, local_id, categoria_id, repetir_a_cada, unidade_repeticao,
          data_inicio, proxima_execucao, criado_por)
       VALUES ('Plano de teste', 'Roteiro de teste.', $1, $2, 1, 'mes', '2031-01-01', '2031-01-01', $3)
       RETURNING id`,
      [local, categoria, criadoPor]
    );
    return rows[0].id;
  }

  it('apaga o plano da conta de teste e preserva o de quem não é', async () => {
    const doTesteId = await inserirPlano(doTeste);
    const deForaId = await inserirPlano(deFora);

    const client = await pool.connect();
    try {
      expect(await limparPlanosDeTeste(client, { padrao: PADRAO })).toBe(1);
    } finally {
      client.release();
    }

    const restantes = (
      await pool.query('SELECT id FROM plano_preventivo WHERE id = ANY($1::int[])', [[doTesteId, deForaId]])
    ).rows.map((r) => r.id);
    expect(restantes).toEqual([deForaId]);
    await pool.query('DELETE FROM plano_preventivo WHERE id = $1', [deForaId]);
  });
});

describe('Limpeza das regras de distribuição de teste', () => {
  // Desligadas: uma regra ligada numa categoria compartilhada distribuiria os
  // chamados das outras suítes durante este teste.
  async function inserirRegra(criadoPor) {
    const categoria = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
    const equipe = (await pool.query("INSERT INTO equipe (nome) VALUES ('Equipe da limpeza') RETURNING id")).rows[0].id;
    const { rows } = await pool.query(
      `INSERT INTO regra_distribuicao (categoria_id, equipe_id, ativo, criado_por)
       VALUES ($1, $2, FALSE, $3) RETURNING id, equipe_id`,
      [categoria, equipe, criadoPor]
    );
    return rows[0];
  }

  it('apaga a regra da conta de teste e preserva a de quem não é', async () => {
    const doTesteRegra = await inserirRegra(doTeste);
    const deForaRegra = await inserirRegra(deFora);

    const client = await pool.connect();
    try {
      expect(await limparRegrasDeTeste(client, { padrao: PADRAO })).toBe(1);
    } finally {
      client.release();
    }

    const restantes = (
      await pool.query('SELECT id FROM regra_distribuicao WHERE id = ANY($1::int[])', [
        [doTesteRegra.id, deForaRegra.id],
      ])
    ).rows.map((r) => r.id);
    expect(restantes).toEqual([deForaRegra.id]);
    await pool.query('DELETE FROM regra_distribuicao WHERE id = $1', [deForaRegra.id]);
    await pool.query('DELETE FROM equipe WHERE id = ANY($1::int[])', [
      [doTesteRegra.equipe_id, deForaRegra.equipe_id],
    ]);
  });
});

describe('Versões de SLA de teste (RN12)', () => {
  test('apaga a versão assinada por conta de teste e preserva a de fora e a sem autor', async () => {
    const autorDeTeste = await inserirPessoa(`sla@${DOMINIO}`);
    const autorDeFora = await inserirPessoa(`sla-${marca}@fora.exemplo.org`);
    const inserir = async (autor) =>
      (
        await pool.query(
          "INSERT INTO sla_versao (prioridade, prazo_horas, contagem, alterado_por) VALUES ('baixa', 99, 'corridas', $1) RETURNING id",
          [autor]
        )
      ).rows[0].id;
    const [doTesteVersao, deForaVersao, semAutor] = [await inserir(autorDeTeste), await inserir(autorDeFora), await inserir(null)];

    const client = await pool.connect();
    try {
      expect(await limparVersoesDeSlaDeTeste(client, { padrao: PADRAO })).toBe(1);
    } finally {
      client.release();
    }

    const restantes = (
      await pool.query('SELECT id FROM sla_versao WHERE id = ANY($1::int[]) ORDER BY id', [
        [doTesteVersao, deForaVersao, semAutor],
      ])
    ).rows.map((r) => r.id);
    expect(restantes).toEqual([deForaVersao, semAutor]);
    await pool.query('DELETE FROM sla_versao WHERE id = ANY($1::int[])', [[deForaVersao, semAutor]]);
    await pool.query('DELETE FROM usuario WHERE id = ANY($1::int[])', [[autorDeTeste, autorDeFora]]);
  });
});

async function rodarContas(opcoes = {}) {
  const client = await pool.connect();
  try {
    return await limparUsuariosDeTeste(client, { padrao: PADRAO, ...opcoes });
  } finally {
    client.release();
  }
}

const existe = async (id) =>
  (await pool.query('SELECT 1 FROM usuario WHERE id = $1', [id])).rows.length === 1;

describe('Limpeza das contas de teste', () => {
  beforeAll(async () => {
    contaSolta = await inserirPessoa(`solta@${DOMINIO}`);
    contaAutora = await inserirPessoa(`autora@${DOMINIO}`);
    contaForaDoPadrao = await inserirPessoa(`solta.${marca}@real.exemplo.org`);

    // A conta solta só deixou ruído: um aviso. Some junto com ela.
    await pool.query(
      `INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem) VALUES ($1, $2, 'atraso', 'aviso de teste')`,
      [contaSolta, chamadoDeFora]
    );
    // A autora comentou no chamado de outra pessoa: é história que sobrou.
    await pool.query(`INSERT INTO comentario (chamado_id, usuario_id, texto) VALUES ($1, $2, 'Comentário de quem é de teste')`, [
      chamadoDeFora,
      contaAutora,
    ]);
  });

  it('apaga a conta de teste que não deixou nada para trás, e o aviso dela', async () => {
    expect(await rodarContas()).toBeGreaterThanOrEqual(1);

    expect(await existe(contaSolta)).toBe(false);
    const { rows } = await pool.query('SELECT 1 FROM notificacao WHERE usuario_id = $1', [contaSolta]);
    expect(rows).toHaveLength(0);
  });

  it('mantém a conta de teste que ainda é autora de algo', async () => {
    expect(await existe(contaAutora)).toBe(true);
    const { rows } = await pool.query('SELECT 1 FROM comentario WHERE usuario_id = $1', [contaAutora]);
    expect(rows).toHaveLength(1);
  });

  it('não toca na conta fora do padrão de teste', async () => {
    expect(await existe(contaForaDoPadrao)).toBe(true);
  });

  it('preserva a conta semeada para a ponta a ponta, mesmo sem nenhum vínculo', async () => {
    // Nasce aqui, e não no beforeAll: os testes de cima rodam a limpeza com a
    // lista padrão, e uma conta de fixture já teria saído antes deste.
    contaSemeada = await inserirPessoa(`semeada@${DOMINIO}`);
    await rodarContas({ preservar: [`semeada@${DOMINIO}`] });
    expect(await existe(contaSemeada)).toBe(true);

    // Sem a lista de preservação, a mesma conta sairia: é ela que a protege.
    await rodarContas({ preservar: [] });
    expect(await existe(contaSemeada)).toBe(false);
  });

  it('o administrador do e2e está na lista padrão de contas preservadas', () => {
    expect(contasSemeadas({})).toEqual(['admin_e2e@exemplo.com']);
    expect(contasSemeadas({ E2E_ADMIN_EMAIL: 'Outro@Exemplo.com' })).toEqual(['outro@exemplo.com']);
  });

  it('rodar de novo não apaga a autora nem erra', async () => {
    await rodarContas();
    expect(await existe(contaAutora)).toBe(true);
  });

  it('recusa com DATABASE_URL, antes de abrir transação', async () => {
    await expect(rodarContas({ ambiente: { DATABASE_URL: 'postgresql://x' } })).rejects.toThrow(/banco real/);
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

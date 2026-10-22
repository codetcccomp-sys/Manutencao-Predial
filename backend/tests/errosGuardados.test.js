const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const erros = require('../src/services/erros.service');
const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);

/**
 * Os erros de servidor (5xx) ficam guardados no banco.
 *
 * Antes só existiam no console da função serverless, e na Vercel Hobby os logs de
 * execução duram 1 hora: um erro das 2h da manhã já não existia às 9h. A tabela
 * `erro_aplicacao` (migração 028) não guarda pessoa: nem usuário, nem IP, nem a
 * query string, e a mensagem sai com os e-mails mascarados.
 */

const MARCA = `/erros-teste-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let admin;
let gestor;
let solicitante;

async function conta(perfil) {
  const email = `${perfil}_err_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Erros ${perfil}`, email, senha: 'senha-teste-123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app)
    .post('/auth/login')
    .set('X-Real-IP', `${IP}-${Math.random()}`)
    .send({ email, senha: 'senha-teste-123' });
  return { token: login.body.token };
}

const como = (quem) => ({ Authorization: `Bearer ${quem.token}` });

/** Provoca um 500 de verdade: o banco recusa só a consulta do login, e o resto segue. */
async function provocarErro500(url, mensagem) {
  const original = pool.query.bind(pool);
  const espiao = jest.spyOn(pool, 'query').mockImplementation((sql, ...resto) =>
    typeof sql === 'string' && /FROM usuario WHERE email/.test(sql)
      ? Promise.reject(new Error(mensagem))
      : original(sql, ...resto)
  );
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    return await request(app)
      .post(url)
      .set('X-Real-IP', `${IP}-${Math.random()}`)
      .send({ email: 'quebra@exemplo.com', senha: 'senha-teste-123' });
  } finally {
    espiao.mockRestore();
    log.mockRestore();
  }
}

async function limparMarca() {
  await pool.query('DELETE FROM erro_aplicacao WHERE rota LIKE $1 OR rota = $2', [`${MARCA}%`, '/auth/login']);
}

beforeAll(async () => {
  admin = await conta('administrador');
  gestor = await conta('gestor');
  solicitante = await conta('solicitante');
  await limparMarca();
});

afterAll(async () => {
  await limparMarca();
  await pool.end();
});

describe('Guardar o erro', () => {
  it('um 500 vira uma linha, com a rota sem a query string e sem a primeira linha do stack', async () => {
    const resp = await provocarErro500('/auth/login?busca=ana@exemplo.com', 'banco caiu');
    expect(resp.status).toBe(500);

    const { rows } = await pool.query(
      `SELECT * FROM erro_aplicacao WHERE rota = '/auth/login' ORDER BY id DESC LIMIT 1`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ metodo: 'POST', status: 500, mensagem: 'banco caiu' });
    // A query string pode carregar busca e e-mail: não é guardada.
    expect(rows[0].rota).not.toContain('?');
    // A pilha só tem as linhas "at ...": a primeira repete a mensagem sem a máscara.
    expect(rows[0].pilha).toMatch(/^\s+at /);
    expect(rows[0].pilha).not.toContain('banco caiu');
  });

  it('o e-mail que o erro repetir sai mascarado', async () => {
    await provocarErro500('/auth/login', 'invalid input syntax: ana.souza@exemplo.com');

    const { rows } = await pool.query(`SELECT mensagem FROM erro_aplicacao WHERE rota = '/auth/login' ORDER BY id DESC LIMIT 1`);
    expect(rows[0].mensagem).toBe('invalid input syntax: [e-mail]');
  });

  it('recusa de cliente (4xx) não é erro nosso: não grava', async () => {
    const antes = (await pool.query('SELECT count(*)::int AS n FROM erro_aplicacao')).rows[0].n;

    const resp = await request(app).post('/auth/login').send({ email: 'sem@senha.com' });

    expect(resp.status).toBe(422);
    expect((await pool.query('SELECT count(*)::int AS n FROM erro_aplicacao')).rows[0].n).toBe(antes);
  });

  it('se o banco falhar ao gravar, o erro original ainda é respondido', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const consulta = jest.spyOn(pool, 'query').mockRejectedValue(new Error('banco caiu'));
    try {
      const resp = await request(app)
        .post('/auth/registrar')
        .send({ nome: 'Quem Quer Que Seja', email: 'quebra@exemplo.com', senha: 'senha-teste-123' });

      expect(resp.status).toBe(500);
      expect(log.mock.calls.flat().join(' ')).toContain('não foi possível guardar o erro');
    } finally {
      consulta.mockRestore();
      log.mockRestore();
    }
  });

  it('passado o teto por minuto, o console segue recebendo e a tabela para de crescer', async () => {
    await pool.query(
      `INSERT INTO erro_aplicacao (metodo, rota, status, mensagem)
       SELECT 'GET', $1, 500, 'preenchimento' FROM generate_series(1, $2)`,
      [MARCA, erros.TETO_POR_MINUTO]
    );
    try {
      const gravou = await erros.registrar({ metodo: 'GET', url: `${MARCA}/depois`, status: 500, mensagem: 'x' });
      expect(gravou).toBe(false);
    } finally {
      await pool.query('DELETE FROM erro_aplicacao WHERE rota = $1', [MARCA]);
    }

    // Esvaziado o minuto, volta a gravar.
    const voltou = await erros.registrar({ metodo: 'GET', url: `${MARCA}/depois`, status: 500, mensagem: 'x' });
    expect(voltou).toBe(true);
    await pool.query('DELETE FROM erro_aplicacao WHERE rota LIKE $1', [`${MARCA}%`]);
  });

  it('apaga o que passou de 30 dias, sem agendador', async () => {
    await pool.query(
      `INSERT INTO erro_aplicacao (ocorrido_em, metodo, rota, status, mensagem)
       VALUES (now() - interval '31 days', 'GET', $1, 500, 'velho')`,
      [`${MARCA}/velho`]
    );
    // A limpeza roda ao acaso; aqui o acaso é fixado.
    const sorteio = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      await erros.registrar({ metodo: 'GET', url: `${MARCA}/novo`, status: 500, mensagem: 'novo' });
    } finally {
      sorteio.mockRestore();
    }

    const { rows } = await pool.query('SELECT rota FROM erro_aplicacao WHERE rota LIKE $1', [`${MARCA}/%`]);
    expect(rows.map((r) => r.rota)).toEqual([`${MARCA}/novo`]);
  });
});

describe('Máscara e pilha', () => {
  it('mascara e-mails em qualquer posição e corta a mensagem', () => {
    expect(erros.mascarar('a@b.com e ana.souza+x@exemplo.com.br falharam')).toBe('[e-mail] e [e-mail] falharam');
    expect(erros.mascarar('x'.repeat(1000))).toHaveLength(300);
    expect(erros.mascarar(undefined)).toBe('');
  });

  it('a pilha perde a primeira linha, que repete a mensagem', () => {
    const pilha = 'Error: contém ana@exemplo.com\n    at a (arquivo.js:1:1)\n    at b (arquivo.js:2:2)';
    expect(erros.soAsLinhasDePilha(pilha)).toBe('    at a (arquivo.js:1:1)\n    at b (arquivo.js:2:2)');
    expect(erros.soAsLinhasDePilha(undefined)).toBeNull();
  });
});

describe('GET /operacao/erros', () => {
  it('o administrador lê os erros, com a contagem das últimas 24 horas', async () => {
    await erros.registrar({ metodo: 'GET', url: `${MARCA}/lista?x=1`, status: 500, codigo: 'X', mensagem: 'm' });

    const resp = await request(app).get('/operacao/erros').set(como(admin));

    expect(resp.status).toBe(200);
    expect(resp.body.retencao_dias).toBe(30);
    expect(resp.body.ultimas_24h).toBeGreaterThanOrEqual(1);
    const nossa = resp.body.erros.find((e) => e.rota === `${MARCA}/lista`);
    expect(nossa).toMatchObject({ metodo: 'GET', status: 500, codigo: 'X' });
  });

  it('gestor e solicitante não leem (a pilha mostra caminhos e nomes internos)', async () => {
    expect((await request(app).get('/operacao/erros').set(como(gestor))).status).toBe(403);
    expect((await request(app).get('/operacao/erros').set(como(solicitante))).status).toBe(403);
    expect((await request(app).get('/operacao/erros')).status).toBe(401);
  });

  it('o limite pedido tem teto de 200, piso de 1 e padrão de 50', async () => {
    // Linhas antigas, para não encostar no teto por minuto, e em número que passa de 200.
    await pool.query(
      `INSERT INTO erro_aplicacao (ocorrido_em, metodo, rota, status, mensagem)
       SELECT now() - interval '2 days', 'GET', $1, 500, 'volume' FROM generate_series(1, 210)`,
      [`${MARCA}/volume`]
    );
    try {
      expect((await erros.listar({ limite: 999999 })).erros).toHaveLength(200);
      expect((await erros.listar({ limite: 3 })).erros).toHaveLength(3);
      expect((await erros.listar({ limite: -5 })).erros).toHaveLength(1);
      expect((await erros.listar({})).erros).toHaveLength(50);
      expect((await erros.listar({ limite: 'abc' })).erros).toHaveLength(50);
    } finally {
      await pool.query('DELETE FROM erro_aplicacao WHERE rota = $1', [`${MARCA}/volume`]);
    }
  });
});

const http = require('http');
const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const { ipDaSuite } = require('./apoio/ip');

/**
 * Anexos no Supabase Storage, contra um servidor de mentira que fala o pedaço
 * da API do Storage que o sistema usa (enviar, ler, apagar objeto).
 *
 * O que importa provar: com a configuração ligada, os bytes não entram no
 * banco; a leitura continua passando pela permissão do chamado; os anexos
 * antigos (em bytea) continuam abrindo; e o Storage fora do ar vira uma
 * recusa clara, sem linha órfã no banco.
 */

const IP = ipDaSuite(__filename);
const CHAVE = 'chave-de-servico-de-teste';
const objetos = new Map();
const pedidos = [];
let servidor;
let foraDoAr = false;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function storageFalso(req, res) {
  const corpo = [];
  req.on('data', (p) => corpo.push(p));
  req.on('end', () => {
    pedidos.push({ metodo: req.method, url: req.url, auth: req.headers.authorization });
    if (foraDoAr) {
      res.writeHead(503).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${CHAVE}`) {
      res.writeHead(403).end();
      return;
    }
    const caminho = req.url.replace('/storage/v1/object/', '');
    if (req.method === 'POST') {
      objetos.set(caminho, { bytes: Buffer.concat(corpo), tipo: req.headers['content-type'] });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ Key: caminho }));
    } else if (req.method === 'GET') {
      const objeto = objetos.get(caminho);
      if (!objeto) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': objeto.tipo }).end(objeto.bytes);
    } else if (req.method === 'DELETE') {
      objetos.delete(caminho);
      res.writeHead(200).end('{}');
    }
  });
}

const ambienteOriginal = {};
let dono;
let estranho;
let chamadoId;

async function pessoa(prefixo) {
  const email = `${prefixo}_storage_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: 'Storage', email, senha: 'senha123' });
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha123' });
  return login.body.token;
}

const como = (token) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  servidor = http.createServer(storageFalso);
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));

  for (const chave of ['ANEXOS_ARMAZENAMENTO', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANEXOS_BUCKET']) {
    ambienteOriginal[chave] = process.env[chave];
  }

  [dono, estranho] = await Promise.all([pessoa('dono'), pessoa('estranho')]);
  const local = await garantirLocal({ unidade: 'Unidade Storage' });
  const categoria = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
  const criado = await request(app)
    .post('/chamados')
    .set(como(dono))
    .send({ titulo: 'Chamado com foto', descricao: 'Foto no Storage.', categoria_id: categoria, local_id: local });
  chamadoId = criado.body.chamado.id;
});

afterAll(async () => {
  for (const [chave, valor] of Object.entries(ambienteOriginal)) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
  await new Promise((ok) => servidor.close(ok));
  await pool.end();
});

function ligarStorage() {
  process.env.ANEXOS_ARMAZENAMENTO = 'supabase';
  process.env.SUPABASE_URL = `http://127.0.0.1:${servidor.address().port}/`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = CHAVE;
  process.env.ANEXOS_BUCKET = 'anexos-teste';
}

function desligarStorage() {
  delete process.env.ANEXOS_ARMAZENAMENTO;
}

const enviar = (token) =>
  request(app)
    .post(`/chamados/${chamadoId}/anexos`)
    .set(como(token))
    .attach('arquivo', PNG, { filename: 'foto.png', contentType: 'image/png' });

describe('Anexos no Supabase Storage', () => {
  afterEach(() => {
    desligarStorage();
    foraDoAr = false;
  });

  it('o arquivo vai para o bucket privado, e o banco guarda só a chave', async () => {
    ligarStorage();
    const resp = await enviar(dono);
    expect(resp.status).toBe(201);

    const { rows } = await pool.query(
      'SELECT armazenamento, chave_externa, conteudo FROM anexo WHERE id = $1',
      [resp.body.anexo.id]
    );
    expect(rows[0].armazenamento).toBe('supabase');
    expect(rows[0].conteudo).toBeNull();
    expect(rows[0].chave_externa).toMatch(new RegExp(`^chamados/${chamadoId}/[0-9a-f-]{36}$`));
    expect(objetos.get(`anexos-teste/${rows[0].chave_externa}`).bytes.equals(PNG)).toBe(true);
    // A chave de serviço vai só no cabeçalho, do servidor para o Storage.
    expect(pedidos.at(-1).auth).toBe(`Bearer ${CHAVE}`);
  });

  it('o download passa pela permissão do chamado, e devolve os mesmos bytes', async () => {
    ligarStorage();
    const { body } = await enviar(dono);
    const antes = pedidos.length;

    const alheio = await request(app)
      .get(`/chamados/${chamadoId}/anexos/${body.anexo.id}/conteudo`)
      .set(como(estranho));
    expect(alheio.status).toBe(403);
    // Recusado sem nem pedir o objeto ao Storage.
    expect(pedidos.length).toBe(antes);

    const meu = await request(app)
      .get(`/chamados/${chamadoId}/anexos/${body.anexo.id}/conteudo`)
      .set(como(dono))
      .buffer(true)
      .parse((res, fim) => {
        const partes = [];
        res.on('data', (p) => partes.push(p));
        res.on('end', () => fim(null, Buffer.concat(partes)));
      });
    expect(meu.status).toBe(200);
    expect(meu.body.equals(PNG)).toBe(true);
    expect(meu.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('anexo antigo, em bytea, continua abrindo depois de ligar o Storage', async () => {
    const antigo = await enviar(dono); // Storage desligado: vai para o banco.
    ligarStorage();
    const resp = await request(app)
      .get(`/chamados/${chamadoId}/anexos/${antigo.body.anexo.id}/conteudo`)
      .set(como(dono));
    expect(resp.status).toBe(200);
  });

  it('remover o anexo apaga o objeto no Storage', async () => {
    ligarStorage();
    const { body } = await enviar(dono);
    const { rows } = await pool.query('SELECT chave_externa FROM anexo WHERE id = $1', [body.anexo.id]);

    const resp = await request(app)
      .delete(`/chamados/${chamadoId}/anexos/${body.anexo.id}`)
      .set(como(dono));
    expect(resp.status).toBe(204);
    expect(objetos.has(`anexos-teste/${rows[0].chave_externa}`)).toBe(false);
  });

  it('Storage fora do ar: recusa clara, e nenhuma linha órfã no banco', async () => {
    ligarStorage();
    foraDoAr = true;
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const antes = (await pool.query('SELECT count(*)::int AS n FROM anexo WHERE chamado_id = $1', [chamadoId])).rows[0].n;

    try {
      const resp = await enviar(dono);
      expect(resp.status).toBe(502);
      expect(resp.body.erro.codigo).toBe('ARMAZENAMENTO_INDISPONIVEL');
    } finally {
      log.mockRestore();
    }

    const depois = (await pool.query('SELECT count(*)::int AS n FROM anexo WHERE chamado_id = $1', [chamadoId])).rows[0].n;
    expect(depois).toBe(antes);
  });

  it('configuração pela metade (sem a chave) recusa em vez de gravar no lugar errado', async () => {
    ligarStorage();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const resp = await enviar(dono);
      expect(resp.status).toBe(503);
      // O nome da variável vai para o log, não para quem tentou anexar.
      expect(JSON.stringify(resp.body)).not.toMatch(/SERVICE_ROLE/);
      expect(log.mock.calls.flat().join(' ')).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    } finally {
      log.mockRestore();
    }
  });
});

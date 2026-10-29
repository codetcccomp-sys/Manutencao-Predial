const request = require('supertest');
const http = require('http');
const zlib = require('zlib');
const pool = require('../src/config/db');
const app = require('../src/app');
const { garantirLocal } = require('./apoio/local');
const { ipDaSuite } = require('./apoio/ip');

// Ver tests/apoio/ip.js: cada suíte se apresenta ao login como um cliente distinto.
const IP = ipDaSuite(__filename);

const UNIDADE = 'Unidade Compressao Teste';
const QUANTOS = 40;

let gestor;

let servidor;

// Pede direto pelo http do Node e devolve os bytes como chegaram pela rede: o supertest
// (superagent) descompacta sozinho e esconderia o tamanho, que é o que o 4G cobra.
const pedirLocais = (codificacao) =>
  new Promise((resolve, reject) => {
    const { port } = servidor.address();
    const req = http.get(
      {
        port,
        path: '/locais?incluir_inativos=true',
        headers: { Authorization: `Bearer ${gestor.token}`, 'Accept-Encoding': codificacao },
      },
      (res) => {
        const pedacos = [];
        res.on('data', (p) => pedacos.push(p));
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(pedacos) }));
      }
    );
    req.on('error', reject);
  });

beforeAll(async () => {
  servidor = app.listen(0);
  const email = `gestor_compressao_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: 'Compressao', email, senha: 'senha-teste-123' });
  await pool.query("UPDATE usuario SET perfil = 'gestor' WHERE email = $1", [email]);
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha-teste-123' });
  gestor = { token: login.body.token };

  // Lista longa o bastante para passar do limite de 1 kB abaixo do qual nada é comprimido.
  for (let i = 0; i < QUANTOS; i += 1) {
    await garantirLocal({ unidade: UNIDADE, bloco: `Bloco ${i}`, pavimento: 'Térreo', setor: 'Setor de teste', ambiente: `Sala ${i}` });
  }
});

afterAll(async () => {
  await new Promise((fechou) => servidor.close(fechou));
  await pool.query('DELETE FROM local WHERE unidade = $1', [UNIDADE]);
  await pool.end();
});

describe('Compressão das respostas da API (RNF03)', () => {
  it('comprime uma lista longa quando o cliente aceita gzip, e o conteúdo é o mesmo', async () => {
    const [semCompressao, comGzip] = await Promise.all([pedirLocais('identity'), pedirLocais('gzip')]);

    expect(comGzip.headers['content-encoding']).toBe('gzip');
    const texto = zlib.gunzipSync(comGzip.body).toString('utf8');
    expect(texto).toBe(semCompressao.body.toString('utf8'));
    expect(JSON.parse(texto).locais.filter((l) => l.unidade === UNIDADE)).toHaveLength(QUANTOS);
  });

  it('encolhe a lista a menos de um quinto do tamanho', async () => {
    const [semCompressao, comGzip] = await Promise.all([pedirLocais('identity'), pedirLocais('gzip')]);

    expect(comGzip.body.length).toBeLessThan(semCompressao.body.length / 5);
  });

  it('não comprime para quem não aceita compressão', async () => {
    const resp = await pedirLocais('identity');

    expect(resp.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(resp.body.toString('utf8')).locais.length).toBeGreaterThanOrEqual(QUANTOS);
  });

  it('avisa as caches que a resposta varia conforme o Accept-Encoding', async () => {
    const resp = await pedirLocais('gzip');

    expect(resp.headers.vary).toMatch(/Accept-Encoding/i);
  });

  it('deixa como está a resposta pequena, que não compensa comprimir', async () => {
    const resp = await request(app).get('/health').set('Accept-Encoding', 'gzip');

    expect(resp.status).toBe(200);
    expect(resp.headers['content-encoding']).toBeUndefined();
  });
});

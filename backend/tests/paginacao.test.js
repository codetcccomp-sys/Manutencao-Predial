const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

const { ipDaSuite } = require('./apoio/ip');

// Ver tests/apoio/ip.js: cada suíte se apresenta ao login como um cliente
// distinto, para não dividir a cota por IP com as suítes que rodam em paralelo.
const IP = ipDaSuite(__filename);

const TOTAL_CHAMADOS = 25;

let solicitante;
let localId;
let categoriaId;

beforeAll(async () => {
  const email = `paginacao_${Date.now()}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: 'Paginação', email, senha: 'senha123' });
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha123' });
  solicitante = { token: login.body.token, usuario: login.body.usuario };

  const local = await pool.query("INSERT INTO local (unidade) VALUES ('Unidade Paginação') RETURNING id");
  const categoria = await pool.query('SELECT id FROM categoria LIMIT 1');
  localId = local.rows[0].id;
  categoriaId = categoria.rows[0].id;

  for (let i = 0; i < TOTAL_CHAMADOS; i += 1) {
    await request(app)
      .post('/chamados')
      .set('Authorization', `Bearer ${solicitante.token}`)
      .send({
        titulo: `Chamado ${String(i).padStart(2, '0')}`,
        descricao: 'Descrição de teste de paginação',
        categoria_id: categoriaId,
        local_id: localId,
      });
  }
});

afterAll(async () => {
  await pool.end();
});

function listar(query = '') {
  return request(app)
    .get(`/chamados${query}`)
    .set('Authorization', `Bearer ${solicitante.token}`);
}

describe('Paginação de GET /chamados', () => {
  it('limita a 20 registros por padrão e informa o total real', async () => {
    const resp = await listar();

    expect(resp.status).toBe(200);
    expect(resp.body.chamados).toHaveLength(20);
    expect(resp.body.paginacao).toEqual({
      pagina: 1,
      limite: 20,
      total: TOTAL_CHAMADOS,
      paginas: 2,
    });
  });

  it('devolve o restante na segunda página, sem repetir nem pular registros', async () => {
    const primeira = await listar('?limite=10&pagina=1');
    const segunda = await listar('?limite=10&pagina=2');
    const terceira = await listar('?limite=10&pagina=3');

    expect(primeira.body.chamados).toHaveLength(10);
    expect(segunda.body.chamados).toHaveLength(10);
    expect(terceira.body.chamados).toHaveLength(5);

    const ids = [
      ...primeira.body.chamados,
      ...segunda.body.chamados,
      ...terceira.body.chamados,
    ].map((c) => c.id);

    expect(new Set(ids).size).toBe(TOTAL_CHAMADOS);
  });

  it('devolve página vazia além do fim, mas preservando o total', async () => {
    const resp = await listar('?pagina=99');

    expect(resp.status).toBe(200);
    expect(resp.body.chamados).toEqual([]);
    // O total não pode zerar só porque a página pedida não tem linhas: é o
    // que a interface usa para dizer quantos resultados existem.
    expect(resp.body.paginacao.total).toBe(TOTAL_CHAMADOS);
    expect(resp.body.paginacao.paginas).toBe(2);
  });

  it('trava o limite no teto mesmo se o cliente pedir mais', async () => {
    const resp = await listar('?limite=99999');
    expect(resp.body.paginacao.limite).toBe(100);
  });

  it('cai no padrão para parâmetros inválidos em vez de recusar o pedido', async () => {
    const resp = await listar('?limite=abc&pagina=-3');

    expect(resp.status).toBe(200);
    expect(resp.body.paginacao.limite).toBe(20);
    expect(resp.body.paginacao.pagina).toBe(1);
  });

  it('não vaza o total_registros da janela para o corpo da resposta', async () => {
    const resp = await listar('?limite=1');
    expect(resp.body.chamados[0]).not.toHaveProperty('total_registros');
  });

  it('mantém a paginação junto com o filtro por estado', async () => {
    const resp = await listar('?estado=aberto&limite=5');

    expect(resp.body.chamados).toHaveLength(5);
    expect(resp.body.chamados.every((c) => c.estado === 'aberto')).toBe(true);
    expect(resp.body.paginacao.total).toBe(TOTAL_CHAMADOS);
  });
});

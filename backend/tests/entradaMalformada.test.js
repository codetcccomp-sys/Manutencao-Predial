const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const { ipDaSuite } = require('./apoio/ip');
const { criarUsuarioELogar } = require('./apoio/contas');

/**
 * Entrada malformada é recusa do cliente (4xx), nunca erro interno.
 *
 * `/chamados/abc`, `prazo_horas: 2.5`, `?estado=zzz`, `?busca=a&busca=b` e um
 * caractere nulo chegavam ao banco (ou a um `.trim()`) e voltavam 500. Todo 5xx
 * é gravado em `erro_aplicacao` e aparece ao administrador como defeito: um
 * endereço digitado errado enchia o painel de ruído.
 */
const IP = ipDaSuite(__filename);

let admin;
let solicitante;
let categoriaId;
let localId;

const errosGravados = async () => (await pool.query('SELECT count(*)::int AS n FROM erro_aplicacao')).rows[0].n;

beforeAll(async () => {
  admin = await criarUsuarioELogar('administrador', { ip: IP, rotulo: 'entrada' });
  solicitante = await criarUsuarioELogar('solicitante', { ip: IP, rotulo: 'entrada' });
  categoriaId = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
  localId = await garantirLocal({ unidade: 'Unidade Entrada' });
});

afterAll(async () => {
  await pool.end();
});

describe('Identificador na rota', () => {
  it.each(['abc', '1.5', '-1', '0', '007', '99999999999999999999', '2147483648'])(
    'GET /chamados/%s responde 404, sem gravar erro do sistema',
    async (id) => {
      const antes = await errosGravados();

      const resp = await request(app).get(`/chamados/${id}`).set(admin.cabecalho);

      expect(resp.status).toBe(404);
      expect(resp.body.erro.codigo).toBe('IDENTIFICADOR_INVALIDO');
      expect(await errosGravados()).toBe(antes);
    }
  );

  it('vale para os identificadores secundários da rota (anexo, material, técnico da equipe)', async () => {
    const respostas = await Promise.all([
      request(app).get('/chamados/1/anexos/abc/conteudo').set(admin.cabecalho),
      request(app).delete('/chamados/1/materiais/abc').set(admin.cabecalho),
      request(app).delete('/equipes/1/tecnicos/abc').set(admin.cabecalho),
    ]);

    expect(respostas.map((r) => r.body.erro?.codigo)).toEqual(Array(3).fill('IDENTIFICADOR_INVALIDO'));
  });

  it('vale em todos os roteadores, e não só no de chamados', async () => {
    const caminhos = [
      ['get', '/equipamentos/abc'],
      ['get', '/planos-preventivos/abc'],
      ['get', '/equipes/abc'],
      ['patch', '/usuarios/abc'],
      ['patch', '/notificacoes/abc/lida'],
      ['patch', '/locais/abc'],
      ['patch', '/categorias/abc'],
      ['patch', '/materiais/abc'],
      ['patch', '/regras-distribuicao/abc'],
    ];

    for (const [metodo, caminho] of caminhos) {
      const resp = await request(app)[metodo](caminho).set(admin.cabecalho).send({});
      expect([caminho, resp.status]).toEqual([caminho, 404]);
    }
  });

  it('quem não entrou continua recebendo 401, e não uma pista sobre o formato do endereço', async () => {
    const resp = await request(app).get('/chamados/abc');

    expect(resp.status).toBe(401);
  });

  it('um identificador válido que não existe segue sendo o 404 da própria rota', async () => {
    const resp = await request(app).get('/chamados/2147483647').set(admin.cabecalho);

    expect(resp.status).toBe(404);
    expect(resp.body.erro.codigo).not.toBe('IDENTIFICADOR_INVALIDO');
  });

  it('DELETE /sla/feriados/abc responde 404 em vez de erro interno', async () => {
    const resp = await request(app).delete('/sla/feriados/abc').set(admin.cabecalho);

    expect(resp.status).toBe(404);
    expect(resp.body.erro.codigo).toBe('FERIADO_NAO_ENCONTRADO');
  });
});

describe('Número inteiro no corpo', () => {
  it('recusa prazo com casa decimal (422), sem alterar o SLA', async () => {
    const antes = (await pool.query("SELECT prazo_horas FROM sla WHERE prioridade = 'baixa'")).rows[0].prazo_horas;

    const resp = await request(app).patch('/sla/baixa').set(admin.cabecalho).send({ prazo_horas: 2.5 });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.mensagem).toMatch(/prazo_horas.*inteiro/);
    expect((await pool.query("SELECT prazo_horas FROM sla WHERE prioridade = 'baixa'")).rows[0].prazo_horas).toBe(antes);
  });

  it('recusa chave fracionada e chave que não cabe num INTEGER ao abrir chamado', async () => {
    const base = { titulo: 'Chamado de entrada', descricao: 'Descrição do chamado de entrada', local_id: localId };

    const fracionada = await request(app).post('/chamados').set(solicitante.cabecalho).send({ ...base, categoria_id: 1.5 });
    const enorme = await request(app).post('/chamados').set(solicitante.cabecalho).send({ ...base, categoria_id: 99999999999 });

    expect([fracionada.status, enorme.status]).toEqual([422, 422]);
    expect(fracionada.body.erro.mensagem).toMatch(/categoria_id.*inteiro/);
  });

  it('quantidade de material continua aceitando casa decimal', async () => {
    const chamado = await request(app)
      .post('/chamados')
      .set(admin.cabecalho)
      .send({ titulo: 'Chamado de entrada', descricao: 'Descrição do chamado de entrada', categoria_id: categoriaId, local_id: localId });
    const material = await pool.query(
      "INSERT INTO material (nome, unidade_medida) VALUES ($1, 'm') RETURNING id",
      [`Fio de entrada ${Date.now()}`]
    );

    const resp = await request(app)
      .post(`/chamados/${chamado.body.chamado.id}/materiais`)
      .set(admin.cabecalho)
      .send({ material_id: material.rows[0].id, quantidade: 2.5 });

    expect(resp.status).toBeLessThan(300);
    await pool.query('DELETE FROM chamado_material WHERE material_id = $1', [material.rows[0].id]);
    await pool.query('DELETE FROM material WHERE id = $1', [material.rows[0].id]);
  });

  it('recusa "ativo" que não é verdadeiro ou falso ao editar equipe', async () => {
    const equipe = await pool.query('INSERT INTO equipe (nome) VALUES ($1) RETURNING id', [`Equipe entrada ${Date.now()}`]);

    const resp = await request(app).patch(`/equipes/${equipe.rows[0].id}`).set(admin.cabecalho).send({ ativo: 'sim' });

    expect(resp.status).toBe(422);
    await pool.query('DELETE FROM equipe WHERE id = $1', [equipe.rows[0].id]);
  });
});

describe('Filtros de consulta', () => {
  it.each([
    ['/chamados?estado=zzz', /estado/],
    ['/chamados?categoria_id=abc', /categoria_id/],
    ['/chamados?equipamento_id=1.5', /equipamento_id/],
    ['/usuarios?perfil=zzz', /perfil/],
    ['/equipamentos?local_id=abc', /local_id/],
    ['/planos-preventivos?equipamento_id=abc', /equipamento_id/],
  ])('GET %s responde 422 dizendo qual filtro', async (caminho, campo) => {
    const resp = await request(app).get(caminho).set(admin.cabecalho);

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('FILTRO_INVALIDO');
    expect(resp.body.erro.mensagem).toMatch(campo);
  });

  it('filtro válido continua filtrando', async () => {
    const resp = await request(app).get(`/chamados?estado=aberto&categoria_id=${categoriaId}`).set(admin.cabecalho);

    expect(resp.status).toBe(200);
    expect(resp.body.chamados.every((c) => c.estado === 'aberto' && c.categoria_id === categoriaId)).toBe(true);
  });

  it.each(['/chamados?busca=a&busca=b', '/chamados?pagina[]=1', '/chamados?ordenar[x]=1'])(
    'GET %s (filtro repetido ou aninhado) responde 400',
    async (caminho) => {
      const resp = await request(app).get(caminho).set(admin.cabecalho);

      expect(resp.status).toBe(400);
      expect(resp.body.erro.codigo).toBe('CONSULTA_INVALIDA');
    }
  );
});

describe('Caractere nulo', () => {
  it('no filtro e no endereço responde 400, sem gravar erro do sistema', async () => {
    const antes = await errosGravados();

    const filtro = await request(app).get('/chamados?busca=%00').set(admin.cabecalho);
    const endereco = await request(app).get('/equipamentos/codigo/%00').set(admin.cabecalho);

    expect([filtro.status, endereco.status]).toEqual([400, 400]);
    expect(filtro.body.erro.codigo).toBe('CARACTERE_INVALIDO');
    expect(await errosGravados()).toBe(antes);
  });

  it('no corpo, em qualquer profundidade, responde 400', async () => {
    const raso = await request(app)
      .post('/chamados')
      .set(solicitante.cabecalho)
      .send({ titulo: 'Chamado com \u0000 nulo', descricao: 'Descrição do chamado de entrada', categoria_id: categoriaId, local_id: localId });
    const fundo = await request(app)
      .put('/sla/expediente')
      .set(admin.cabecalho)
      .send({ dias: [{ dia_semana: 1, inicio: '08:00\u0000', fim: '18:00' }] });

    expect([raso.status, fundo.status]).toEqual([400, 400]);
  });
});

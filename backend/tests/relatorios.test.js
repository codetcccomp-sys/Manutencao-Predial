const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

let gestor;
let tecnico;
let solicitante;
let localId;
let categoriaId;

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_rel_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Rel ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').send({ email, senha: 'senha123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

async function abrirChamado(titulo) {
  const resp = await request(app)
    .post('/chamados')
    .set('Authorization', `Bearer ${solicitante.token}`)
    .send({ titulo, descricao: 'Descrição para relatório', categoria_id: categoriaId, local_id: localId });
  return resp.body.chamado.id;
}

async function levarAteConcluido(id) {
  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor.token)).send({ estado: 'em_triagem' });
  await request(app).patch(`/chamados/${id}/atribuir`).set(auth(gestor.token)).send({ tecnico_id: tecnico.usuario.id });
  await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor.token)).send({ estado: 'em_andamento' });
  await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor.token)).send({ estado: 'concluido' });
}

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor');
  tecnico = await criarUsuarioELogar('tecnico');
  solicitante = await criarUsuarioELogar('solicitante');

  const local = await pool.query("INSERT INTO local (unidade) VALUES ('Unidade Relatorio') RETURNING id");
  const categoria = await pool.query('SELECT id FROM categoria LIMIT 1');
  localId = local.rows[0].id;
  categoriaId = categoria.rows[0].id;

  const concluido = await abrirChamado('Relatório concluído');
  await levarAteConcluido(concluido);

  await request(app)
    .post(`/chamados/${concluido}/avaliacao`)
    .set('Authorization', `Bearer ${solicitante.token}`)
    .send({ nota: 4 });

  await abrirChamado('Relatório em aberto');
});

afterAll(async () => {
  await pool.end();
});

function comoGestor(caminho) {
  return request(app).get(caminho).set('Authorization', `Bearer ${gestor.token}`);
}

describe('Autorização dos relatórios', () => {
  it('nega acesso a solicitante e a técnico', async () => {
    for (const quem of [solicitante, tecnico]) {
      const resp = await request(app)
        .get('/relatorios/resumo')
        .set('Authorization', `Bearer ${quem.token}`);
      expect(resp.status).toBe(403);
    }
  });

  it('exige autenticação', async () => {
    const resp = await request(app).get('/relatorios/resumo');
    expect(resp.status).toBe(401);
  });
});

describe('GET /relatorios/resumo', () => {
  it('soma os chamados por estado, categoria e prioridade', async () => {
    const resp = await comoGestor('/relatorios/resumo');

    expect(resp.status).toBe(200);
    expect(resp.body.totais.total).toBeGreaterThanOrEqual(2);
    expect(resp.body.totais.concluidos).toBeGreaterThanOrEqual(1);
    expect(resp.body.totais.em_aberto).toBeGreaterThanOrEqual(1);

    // Os recortes precisam fechar com o total, senão algum chamado está
    // sendo contado duas vezes ou nenhuma.
    const somaEstados = resp.body.por_estado.reduce((acc, l) => acc + l.total, 0);
    const somaCategorias = resp.body.por_categoria.reduce((acc, l) => acc + l.total, 0);
    const somaPrioridades = resp.body.por_prioridade.reduce((acc, l) => acc + l.total, 0);

    expect(somaEstados).toBe(resp.body.totais.total);
    expect(somaCategorias).toBe(resp.body.totais.total);
    expect(somaPrioridades).toBe(resp.body.totais.total);
  });

  it('recusa data malformada em vez de ignorar o filtro', async () => {
    const resp = await comoGestor('/relatorios/resumo?de=ontem');
    expect(resp.status).toBe(422);
  });

  it('respeita o período informado', async () => {
    const futuro = await comoGestor('/relatorios/resumo?de=2099-01-01');
    expect(futuro.body.totais.total).toBe(0);

    const hoje = new Date().toISOString().slice(0, 10);
    const ateHoje = await comoGestor(`/relatorios/resumo?ate=${hoje}`);
    // "ate" inclui o dia inteiro: os chamados criados agora têm de entrar.
    expect(ateHoje.body.totais.total).toBeGreaterThanOrEqual(2);
  });
});

describe('GET /relatorios/desempenho', () => {
  it('calcula tempo de atendimento e nota média dos concluídos', async () => {
    const resp = await comoGestor('/relatorios/desempenho');

    expect(resp.status).toBe(200);
    expect(resp.body.geral.chamados_concluidos).toBeGreaterThanOrEqual(1);
    expect(Number(resp.body.geral.tempo_medio_segundos)).toBeGreaterThanOrEqual(0);
    expect(Number(resp.body.avaliacoes.nota_media)).toBeGreaterThan(0);
  });

  it('devolve estrutura utilizável quando não há nada concluído no período', async () => {
    const resp = await comoGestor('/relatorios/desempenho?de=2099-01-01');

    expect(resp.status).toBe(200);
    expect(resp.body.geral.chamados_concluidos).toBe(0);
    expect(resp.body.geral.tempo_medio_segundos).toBeNull();
    expect(resp.body.por_categoria).toEqual([]);
  });
});

describe('GET /relatorios/tecnicos', () => {
  it('lista carga por técnico', async () => {
    const resp = await comoGestor('/relatorios/tecnicos');

    expect(resp.status).toBe(200);
    const linha = resp.body.tecnicos.find((t) => t.tecnico_id === tecnico.usuario.id);
    expect(linha).toBeDefined();
    expect(linha.atribuidos).toBeGreaterThanOrEqual(1);
    expect(linha.concluidos).toBeGreaterThanOrEqual(1);
  });
});

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');

const { ipDaSuite } = require('./apoio/ip');

// Ver tests/apoio/ip.js: cada suíte se apresenta ao login como um cliente
// distinto, para não dividir a cota por IP com as suítes que rodam em paralelo.
const IP = ipDaSuite(__filename);

let gestor;
let solicitante;
let outroSolicitante;
let tecnico;
let localId;
let categoriaId;

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_cad_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Cad ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

const auth = (quem) => ({ Authorization: `Bearer ${quem.token}` });

async function abrir(titulo = 'Chamado de cadastro') {
  const resp = await request(app)
    .post('/chamados')
    .set(auth(solicitante))
    .send({ titulo, descricao: 'Descrição do problema relatado', categoria_id: categoriaId, local_id: localId });
  return resp.body.chamado;
}

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor');
  solicitante = await criarUsuarioELogar('solicitante');
  outroSolicitante = await criarUsuarioELogar('solicitante');
  tecnico = await criarUsuarioELogar('tecnico');

  const categoria = await pool.query('SELECT id FROM categoria LIMIT 1');
  localId = await garantirLocal({ unidade: 'Unidade Cad', bloco: 'B' });
  categoriaId = categoria.rows[0].id;
});

afterAll(async () => {
  await pool.end();
});

describe('Busca por protocolo e título (RF03)', () => {
  it('encontra pelo protocolo completo', async () => {
    const chamado = await abrir();

    const resp = await request(app)
      .get(`/chamados?busca=${chamado.protocolo}`)
      .set(auth(solicitante));

    expect(resp.status).toBe(200);
    expect(resp.body.chamados.map((c) => c.id)).toEqual([chamado.id]);
  });

  it('encontra por parte do protocolo', async () => {
    const chamado = await abrir();
    const pedaco = chamado.protocolo.slice(-6);

    const resp = await request(app).get(`/chamados?busca=${pedaco}`).set(auth(solicitante));
    expect(resp.body.chamados.map((c) => c.id)).toContain(chamado.id);
  });

  it('encontra por título, ignorando maiúsculas', async () => {
    const chamado = await abrir('Infiltração no Auditório');

    const resp = await request(app).get('/chamados?busca=INFILTRAÇÃO').set(auth(solicitante));
    expect(resp.body.chamados.map((c) => c.id)).toContain(chamado.id);
  });

  it('a busca não fura o escopo do perfil', async () => {
    const meu = await abrir('Chamado privado do solicitante');

    // O outro solicitante busca exatamente o protocolo alheio e não acha:
    // a busca é mais um filtro, nunca uma porta lateral para ver tudo.
    const resp = await request(app)
      .get(`/chamados?busca=${meu.protocolo}`)
      .set(auth(outroSolicitante));

    expect(resp.body.chamados).toEqual([]);
  });

  it('busca sem resultado devolve lista vazia, não erro', async () => {
    const resp = await request(app).get('/chamados?busca=xyzinexistente123').set(auth(solicitante));
    expect(resp.status).toBe(200);
    expect(resp.body.chamados).toEqual([]);
    expect(resp.body.paginacao.total).toBe(0);
  });
});

describe('Edição do chamado (RN03)', () => {
  it('solicitante corrige o que escreveu enquanto não foi atribuído', async () => {
    const chamado = await abrir();

    const resp = await request(app)
      .patch(`/chamados/${chamado.id}`)
      .set(auth(solicitante))
      .send({ titulo: 'Título corrigido pelo solicitante', descricao: 'Descrição mais detalhada do problema.' });

    expect(resp.status).toBe(200);
    expect(resp.body.chamado.titulo).toBe('Título corrigido pelo solicitante');
  });

  it('ainda pode editar durante a triagem', async () => {
    const chamado = await abrir();
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth(gestor)).send({ estado: 'em_triagem' });

    const resp = await request(app)
      .patch(`/chamados/${chamado.id}`)
      .set(auth(solicitante))
      .send({ descricao: 'Detalhe que lembrei depois de abrir o chamado.' });

    expect(resp.status).toBe(200);
  });

  it('perde a janela depois da atribuição', async () => {
    const chamado = await abrir();
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth(gestor)).send({ estado: 'em_triagem' });
    await request(app)
      .patch(`/chamados/${chamado.id}/atribuir`)
      .set(auth(gestor))
      .send({ tecnico_id: tecnico.usuario.id });

    const resp = await request(app)
      .patch(`/chamados/${chamado.id}`)
      .set(auth(solicitante))
      .send({ titulo: 'Tentativa tardia de edição' });

    expect(resp.status).toBe(409);
    expect(resp.body.erro.codigo).toBe('JANELA_ENCERRADA');
  });

  it('gestão edita mesmo depois da atribuição', async () => {
    const chamado = await abrir();
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth(gestor)).send({ estado: 'em_triagem' });
    await request(app)
      .patch(`/chamados/${chamado.id}/atribuir`)
      .set(auth(gestor))
      .send({ tecnico_id: tecnico.usuario.id });

    const resp = await request(app)
      .patch(`/chamados/${chamado.id}`)
      .set(auth(gestor))
      .send({ titulo: 'Título ajustado pela gestão na triagem' });

    expect(resp.status).toBe(200);
  });

  it('não edita chamado de outra pessoa', async () => {
    const chamado = await abrir();
    const resp = await request(app)
      .patch(`/chamados/${chamado.id}`)
      .set(auth(outroSolicitante))
      .send({ titulo: 'Edição indevida em chamado alheio' });

    expect(resp.status).toBe(403);
  });

  it('registra a edição no histórico, dizendo o que mudou', async () => {
    const chamado = await abrir();
    await request(app)
      .patch(`/chamados/${chamado.id}`)
      .set(auth(solicitante))
      .send({ titulo: 'Novo título para conferir o histórico' });

    const detalhe = await request(app).get(`/chamados/${chamado.id}`).set(auth(solicitante));
    const entrada = detalhe.body.chamado.historico.find((h) => /editado/i.test(h.observacao || ''));

    // Sem registro, o técnico veria uma descrição diferente da que motivou a
    // triagem, sem saber que mudou.
    expect(entrada).toBeDefined();
    expect(entrada.observacao).toContain('titulo');
  });

  it('recusa edição sem mudança real', async () => {
    const chamado = await abrir('Título que não vai mudar');
    const resp = await request(app)
      .patch(`/chamados/${chamado.id}`)
      .set(auth(solicitante))
      .send({ titulo: 'Título que não vai mudar' });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('NADA_A_ATUALIZAR');
  });

  it('não edita chamado encerrado', async () => {
    const chamado = await abrir();
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth(gestor)).send({ estado: 'cancelado' });

    const resp = await request(app)
      .patch(`/chamados/${chamado.id}`)
      .set(auth(gestor))
      .send({ titulo: 'Tentativa em chamado encerrado' });

    expect(resp.status).toBe(409);
  });
});

describe('Cadastro de categorias (RF11)', () => {
  it('gestor cria e renomeia categoria', async () => {
    const nome = `Categoria ${Date.now()}`;
    const criada = await request(app).post('/categorias').set(auth(gestor)).send({ nome });
    expect(criada.status).toBe(201);

    const renomeada = await request(app)
      .patch(`/categorias/${criada.body.categoria.id}`)
      .set(auth(gestor))
      .send({ nome: `${nome} revisada` });
    expect(renomeada.status).toBe(200);
    expect(renomeada.body.categoria.nome).toBe(`${nome} revisada`);
  });

  it('recusa nome repetido com mensagem própria, não erro interno', async () => {
    const nome = `Repetida ${Date.now()}`;
    await request(app).post('/categorias').set(auth(gestor)).send({ nome });

    const segunda = await request(app).post('/categorias').set(auth(gestor)).send({ nome });
    expect(segunda.status).toBe(409);
    expect(segunda.body.erro.codigo).toBe('NOME_EM_USO');
  });

  it('solicitante lê mas não cria', async () => {
    const leitura = await request(app).get('/categorias').set(auth(solicitante));
    expect(leitura.status).toBe(200);

    const escrita = await request(app)
      .post('/categorias')
      .set(auth(solicitante))
      .send({ nome: `Proibida ${Date.now()}` });
    expect(escrita.status).toBe(403);
  });
});

describe('Cadastro de locais (RF11)', () => {
  it('gestor cria local e o desativa sem perder o vínculo', async () => {
    const criado = await request(app)
      .post('/locais')
      .set(auth(gestor))
      // Nome único por execução: o local tem chave natural, e um nome fixo
      // faria a segunda rodada da suíte receber 409 em vez de 201.
      .send({ unidade: `Unidade Nova ${Date.now()}`, bloco: 'C', ambiente: 'Sala 101' });
    expect(criado.status).toBe(201);
    const id = criado.body.local.id;

    const chamado = await request(app)
      .post('/chamados')
      .set(auth(solicitante))
      .send({
        titulo: 'Chamado no local que será desativado',
        descricao: 'Descrição do problema relatado',
        categoria_id: categoriaId,
        local_id: id,
      });

    await request(app).patch(`/locais/${id}`).set(auth(gestor)).send({ ativo: false });

    // RN10: desativar não apaga; o chamado antigo continua apontando para cá.
    const vinculo = await pool.query('SELECT local_id FROM chamado WHERE id = $1', [
      chamado.body.chamado.id,
    ]);
    expect(vinculo.rows[0].local_id).toBe(id);
  });

  it('omite inativos por padrão e os inclui quando pedido', async () => {
    const criado = await request(app)
      .post('/locais')
      .set(auth(gestor))
      .send({ unidade: `Some ${Date.now()}` });
    const id = criado.body.local.id;
    await request(app).patch(`/locais/${id}`).set(auth(gestor)).send({ ativo: false });

    const padrao = await request(app).get('/locais').set(auth(solicitante));
    expect(padrao.body.locais.map((l) => l.id)).not.toContain(id);

    const completo = await request(app).get('/locais?incluir_inativos=true').set(auth(gestor));
    expect(completo.body.locais.map((l) => l.id)).toContain(id);
  });
});

describe('Contexto do chamado', () => {
  it('o detalhe traz o local e a categoria por extenso, não só os ids', async () => {
    const chamado = await abrir('Chamado com contexto');

    const resp = await request(app).get(`/chamados/${chamado.id}`).set(auth(gestor));

    // Quem atende precisa saber onde é. Os ids sozinhos obrigariam a tela a
    // baixar a lista inteira de locais só para traduzir um número.
    expect(resp.body.chamado.local_rotulo).toBe('Unidade Cad / B');
    expect(typeof resp.body.chamado.categoria_nome).toBe('string');
  });
});

describe('Recorte por local nos relatórios (RF10)', () => {
  it('agrupa por local com rótulo hierárquico legível', async () => {
    await abrir();

    const resp = await request(app).get('/relatorios/resumo').set(auth(gestor));

    expect(resp.status).toBe(200);
    expect(Array.isArray(resp.body.por_local)).toBe(true);

    const linha = resp.body.por_local.find((l) => l.local.startsWith('Unidade Cad'));
    expect(linha).toBeDefined();
    // Os níveis preenchidos aparecem encadeados; os vazios não deixam buraco.
    expect(linha.local).toBe('Unidade Cad / B');
    expect(linha.total).toBeGreaterThanOrEqual(1);
  });

  it('separa o que está em aberto do que já venceu o prazo', async () => {
    const chamado = await abrir();
    await pool.query("UPDATE chamado SET prazo_estimado = now() - interval '1 hour' WHERE id = $1", [
      chamado.id,
    ]);

    const resp = await request(app).get('/relatorios/resumo').set(auth(gestor));
    const linha = resp.body.por_local.find((l) => l.local === 'Unidade Cad / B');

    // Atrasado é subconjunto de em aberto, e em aberto é subconjunto do total:
    // se essa ordem se inverter, a leitura do painel deixa de fazer sentido.
    expect(linha.atrasados).toBeGreaterThanOrEqual(1);
    expect(linha.em_aberto).toBeGreaterThanOrEqual(linha.atrasados);
    expect(linha.total).toBeGreaterThanOrEqual(linha.em_aberto);
  });
});

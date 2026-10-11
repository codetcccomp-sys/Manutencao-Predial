const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');

const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);

/**
 * Os dois recortes que faltavam para as telas por perfil.
 *
 * A lista servia a uma pergunta só — "o que chegou por último" — e as três
 * pessoas que usam o sistema fazem perguntas diferentes:
 *
 * - o técnico pergunta "o que eu faço agora", e a resposta é o que está mais
 *   perto de estourar o prazo, que costuma ser o mais ANTIGO — o último da
 *   ordenação por data;
 * - a gestão pergunta "onde ninguém pode agir", e a resposta é o chamado sem
 *   técnico designado, que não dava para pedir de jeito nenhum.
 */

let admin;
let tecnico;
let categoriaId;
let localId;

async function conta(perfil) {
  const email = `fila_${perfil}_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Fila ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app)
    .post('/auth/login')
    .set('X-Real-IP', `${IP}-${Math.random()}`)
    .send({ email, senha: 'senha123' });
  return { ...login.body.usuario, token: login.body.token };
}

// Cria o chamado pela API e depois ajusta o prazo direto no banco: o prazo
// nasce da prioridade, e aqui o que se quer controlar é a ordem entre eles.
async function chamadoCom({ titulo, prazoEmHoras, tecnicoId = null }) {
  const { body } = await request(app)
    .post('/chamados')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ titulo, descricao: `${titulo} — descrição de teste.`, categoria_id: categoriaId, local_id: localId });

  const id = body.chamado.id;
  await pool.query(
    `UPDATE chamado SET prazo_estimado = now() + ($1 * interval '1 hour'), tecnico_id = $2 WHERE id = $3`,
    [prazoEmHoras, tecnicoId, id]
  );
  return id;
}

beforeAll(async () => {
  admin = await conta('administrador');
  tecnico = await conta('tecnico');
  categoriaId = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
  localId = await garantirLocal({ unidade: 'Unidade da suíte de fila' });
});

afterAll(async () => {
  await pool.end();
});

describe('Ordenação por prazo', () => {
  it('traz primeiro o que vence antes, mesmo sendo o mais antigo', async () => {
    // O marcador isola estes dois chamados do resto do banco. Sem ele o teste
    // dependeria de eles caberem na primeira página de uma lista que cresce a
    // cada execução da suíte — e passaria ou falharia pelo tamanho do banco,
    // não pela ordenação, que é o que se quer medir.
    const marca = `ord${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    // A ORDEM DE CRIAÇÃO importa, e é o que faz este teste valer alguma coisa.
    //
    // O urgente é criado PRIMEIRO, então ele é o mais antigo. Na ordenação por
    // data — mais novo primeiro — ele sairia por último. Só a ordenação por
    // prazo o coloca à frente.
    //
    // A primeira versão criava na ordem inversa, e por isso as duas
    // ordenações devolviam a mesma lista: o teste passava com `ordenar=prazo`
    // completamente ignorado. Só a mutação percebeu.
    const urgente = await chamadoCom({ titulo: `${marca} urgente`, prazoEmHoras: 1 });
    const folgado = await chamadoCom({ titulo: `${marca} folgado`, prazoEmHoras: 200 });

    // `urgente` foi criado DEPOIS, então na ordenação por data ele viria
    // primeiro de qualquer jeito. É `folgado` quem prova a diferença: criado
    // antes, prazo distante, tem de ficar atrás.
    const resp = await request(app)
      .get('/chamados')
      .query({ ordenar: 'prazo', busca: marca, limite: 100 })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(resp.status).toBe(200);
    const ids = resp.body.chamados.map((c) => c.id);
    expect(ids).toEqual([urgente, folgado]);
  });

  it('a ordenação padrão continua sendo por data', async () => {
    // Quem já usa a lista não pode ter o chão trocado por causa da tela nova.
    const marca = `pad${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const antigo = await chamadoCom({ titulo: `${marca} antigo`, prazoEmHoras: 1 });
    const novo = await chamadoCom({ titulo: `${marca} novo`, prazoEmHoras: 999 });

    const resp = await request(app)
      .get('/chamados')
      .query({ busca: marca, limite: 100 })
      .set('Authorization', `Bearer ${admin.token}`);

    const ids = resp.body.chamados.map((c) => c.id);
    expect(ids).toEqual([novo, antigo]);
  });

  it('chamado sem prazo vai para o fim, não para o topo', async () => {
    // Guarda de regressão, e não prova do NULLS LAST: no Postgres o ASC já
    // ordena nulo por último por conta própria, então tirar a cláusula não
    // muda nada — conferido, e o comentário que dizia o contrário no serviço
    // foi corrigido. O que este teste pega é alguém inverter a ordenação para
    // DESC, onde o padrão passa a ser NULLS FIRST e a fila do técnico abriria
    // com o que não tem prazo nenhum.
    const marca = `nul${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const semPrazo = await chamadoCom({ titulo: `${marca} sem prazo`, prazoEmHoras: 1 });
    await pool.query('UPDATE chamado SET prazo_estimado = NULL WHERE id = $1', [semPrazo]);
    const comPrazo = await chamadoCom({ titulo: `${marca} com prazo`, prazoEmHoras: 500 });

    const resp = await request(app)
      .get('/chamados')
      .query({ ordenar: 'prazo', busca: marca, limite: 100 })
      .set('Authorization', `Bearer ${admin.token}`);

    const ids = resp.body.chamados.map((c) => c.id);
    expect(ids).toEqual([comPrazo, semPrazo]);
  });

  it('nome de ordenação desconhecido cai no padrão em vez de quebrar', async () => {
    // `ORDER BY` não aceita parâmetro do driver, então o valor é escolhido
    // num mapa fechado. Se um dia alguém trocar o mapa por interpolação, é
    // injeção de SQL — e este teste é o que percebe.
    const resp = await request(app)
      .get('/chamados')
      .query({ ordenar: "data_abertura; DROP TABLE chamado--" })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(resp.status).toBe(200);

    const { rows } = await pool.query("SELECT to_regclass('public.chamado') AS tabela");
    expect(rows[0].tabela).toBe('chamado');
  });
});

describe('Situação: em aberto ou encerrado', () => {
  it('a fila por prazo não é tomada pelo histórico encerrado', async () => {
    // O cenário exato do achado da revisão. Encerrados têm os prazos mais
    // antigos, então na ordenação por prazo vêm primeiro; a tela cortava os
    // encerrados DEPOIS de receber a página, e com histórico longo os
    // chamados em aberto nem chegavam.
    const marca = `sit${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const encerrados = [];
    for (let i = 0; i < 3; i += 1) {
      const id = await chamadoCom({ titulo: `${marca} velho ${i}`, prazoEmHoras: -500 - i, tecnicoId: tecnico.id });
      await pool.query(
        "UPDATE chamado SET estado = 'concluido', servico_realizado = 'Serviço concluído no teste.', epi_confirmado_em = now(), epi_confirmado_por = COALESCE(tecnico_id, solicitante_id) WHERE id = $1",
        [id]
      );
      encerrados.push(id);
    }
    const aberto = await chamadoCom({ titulo: `${marca} aberto`, prazoEmHoras: 5, tecnicoId: tecnico.id });

    // Página de 2: sem o filtro, só caberiam encerrados.
    const semFiltro = await request(app)
      .get('/chamados')
      .query({ ordenar: 'prazo', busca: marca, limite: 2 })
      .set('Authorization', `Bearer ${tecnico.token}`);
    expect(semFiltro.body.chamados.map((c) => c.id)).not.toContain(aberto);

    const comFiltro = await request(app)
      .get('/chamados')
      .query({ ordenar: 'prazo', busca: marca, limite: 2, situacao: 'abertos' })
      .set('Authorization', `Bearer ${tecnico.token}`);
    expect(comFiltro.body.chamados.map((c) => c.id)).toEqual([aberto]);
    // E o total da paginação conta só os abertos — é o número que as telas
    // usam para contar.
    expect(comFiltro.body.paginacao.total).toBe(1);
  });

  it('"encerrados" traz concluídos e cancelados, e nada em aberto', async () => {
    const marca = `enc${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const concluido = await chamadoCom({ titulo: `${marca} a`, prazoEmHoras: 5 });
    const cancelado = await chamadoCom({ titulo: `${marca} b`, prazoEmHoras: 5 });
    const aberto = await chamadoCom({ titulo: `${marca} c`, prazoEmHoras: 5 });
    await pool.query(
      "UPDATE chamado SET estado = 'concluido', servico_realizado = 'Serviço concluído no teste.', epi_confirmado_em = now(), epi_confirmado_por = COALESCE(tecnico_id, solicitante_id) WHERE id = $1",
      [concluido]
    );
    await pool.query("UPDATE chamado SET estado = 'cancelado' WHERE id = $1", [cancelado]);

    const resp = await request(app)
      .get('/chamados')
      .query({ busca: marca, situacao: 'encerrados' })
      .set('Authorization', `Bearer ${admin.token}`);

    const ids = resp.body.chamados.map((c) => c.id).sort();
    expect(ids).toEqual([concluido, cancelado].sort());
    expect(ids).not.toContain(aberto);
  });

  it('valor desconhecido não filtra nem quebra', async () => {
    const resp = await request(app)
      .get('/chamados')
      .query({ situacao: "abertos' OR 1=1--" })
      .set('Authorization', `Bearer ${admin.token}`);
    expect(resp.status).toBe(200);
  });
});

describe('Chamados sem técnico', () => {
  it('traz só os que estão em aberto e sem ninguém designado', async () => {
    const semNinguem = await chamadoCom({ titulo: `Orfao ${Date.now()}`, prazoEmHoras: 50 });
    const comTecnico = await chamadoCom({
      titulo: `Designado ${Date.now()}`,
      prazoEmHoras: 50,
      tecnicoId: tecnico.id,
    });

    const resp = await request(app)
      .get('/chamados')
      .query({ sem_tecnico: 'true', limite: 100 })
      .set('Authorization', `Bearer ${admin.token}`);

    const ids = resp.body.chamados.map((c) => c.id);
    expect(ids).toContain(semNinguem);
    expect(ids).not.toContain(comTecnico);
    // E nenhum dos devolvidos tem técnico: a asserção acima passaria mesmo se
    // o filtro trouxesse metade certo por acaso.
    expect(resp.body.chamados.every((c) => c.tecnico_id === null)).toBe(true);
  });

  it('não conta chamado encerrado sem técnico como pendência', async () => {
    // Cancelar antes de distribuir é o caminho normal, não trabalho parado.
    const cancelado = await chamadoCom({ titulo: `Cancelado ${Date.now()}`, prazoEmHoras: 50 });
    await pool.query("UPDATE chamado SET estado = 'cancelado' WHERE id = $1", [cancelado]);

    const resp = await request(app)
      .get('/chamados')
      .query({ sem_tecnico: 'true', limite: 100 })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(resp.body.chamados.map((c) => c.id)).not.toContain(cancelado);
  });

  it('o filtro não fura o recorte por perfil', async () => {
    // Um solicitante pedindo sem_tecnico continua vendo só o que ele abriu:
    // o filtro é um AND a mais, não um caminho alternativo para a lista.
    const solicitante = await conta('solicitante');
    const deOutraPessoa = await chamadoCom({ titulo: `Alheio ${Date.now()}`, prazoEmHoras: 50 });

    const resp = await request(app)
      .get('/chamados')
      .query({ sem_tecnico: 'true', limite: 100 })
      .set('Authorization', `Bearer ${solicitante.token}`);

    expect(resp.status).toBe(200);
    expect(resp.body.chamados.map((c) => c.id)).not.toContain(deOutraPessoa);
  });
});

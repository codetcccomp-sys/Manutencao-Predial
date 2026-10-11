const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const { apagarChamados } = require('./apoio/limpeza');
const { ipDaSuite } = require('./apoio/ip');
const { FUSO } = require('../src/config/fuso');
const distribuicaoService = require('../src/services/distribuicao.service');

const IP = ipDaSuite(__filename);

/**
 * Distribuição automática: a resposta ao gargalo da triagem manual.
 *
 * Tudo aqui usa categoria e equipes criadas pela própria suíte. Uma regra
 * ligada numa categoria compartilhada distribuiria os chamados das outras
 * suítes, que rodam em paralelo no mesmo banco — e elas falhariam por um
 * motivo que não é delas.
 */

const MARCA = `dist${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

let admin;
let solicitante;
let tecnicoAvulso;
const criados = { chamados: [], regras: [], equipes: [], categorias: [], equipamentos: [] };

async function conta(perfil) {
  const email = `${MARCA}_${perfil}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Dist ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app)
    .post('/auth/login')
    .set('X-Real-IP', `${IP}-${Math.random()}`)
    .send({ email, senha: 'senha123' });
  return { ...login.body.usuario, token: login.body.token };
}

async function categoria() {
  const nome = `${MARCA}-${criados.categorias.length}`.slice(0, 50);
  const { rows } = await pool.query('INSERT INTO categoria (nome) VALUES ($1) RETURNING id', [nome]);
  criados.categorias.push(rows[0].id);
  return rows[0].id;
}

async function equipe(tecnicos = []) {
  const { rows } = await pool.query('INSERT INTO equipe (nome) VALUES ($1) RETURNING id', [
    `${MARCA} equipe ${criados.equipes.length}`,
  ]);
  const id = rows[0].id;
  criados.equipes.push(id);
  for (const t of tecnicos) {
    await pool.query('INSERT INTO equipe_tecnico (equipe_id, usuario_id) VALUES ($1, $2)', [id, t.id]);
  }
  return id;
}

async function regra(campos, quem = admin) {
  const resp = await request(app)
    .post('/regras-distribuicao')
    .set('Authorization', `Bearer ${quem.token}`)
    .send(campos);
  if (resp.body.regra) criados.regras.push(resp.body.regra.id);
  return resp;
}

async function abrir(campos, quem = solicitante) {
  const resp = await request(app)
    .post('/chamados')
    .set('Authorization', `Bearer ${quem.token}`)
    .send({ titulo: `${MARCA} chamado`, descricao: 'Lâmpada queimada no corredor.', ...campos });
  if (resp.body.chamado) criados.chamados.push(resp.body.chamado.id);
  return resp;
}

let localPadrao;

beforeAll(async () => {
  admin = await conta('administrador');
  solicitante = await conta('solicitante');
  tecnicoAvulso = await conta('tecnico');
  localPadrao = await garantirLocal({ unidade: `${MARCA} Sede`, bloco: 'A', ambiente: 'Sala 1' });
});

afterAll(async () => {
  // Na ordem das chaves: os chamados apontam para as regras, as regras para
  // equipes e categorias. As contas saem na limpeza global, quando nada mais
  // aponta para elas.
  const client = await pool.connect();
  try {
    await apagarChamados(client, criados.chamados);
    await client.query('DELETE FROM equipamento WHERE id = ANY($1::int[])', [criados.equipamentos]);
    await client.query('DELETE FROM regra_distribuicao WHERE id = ANY($1::int[])', [criados.regras]);
    await client.query('DELETE FROM equipe_tecnico WHERE equipe_id = ANY($1::int[])', [criados.equipes]);
    await client.query('DELETE FROM equipe WHERE id = ANY($1::int[])', [criados.equipes]);
    await client.query('DELETE FROM categoria WHERE id = ANY($1::int[])', [criados.categorias]);
  } finally {
    client.release();
  }
  await pool.end();
});

describe('Distribuição automática na abertura do chamado', () => {
  it('sem regra, o chamado continua indo para a triagem do gestor', async () => {
    const cat = await categoria();
    const resp = await abrir({ categoria_id: cat, local_id: localPadrao });

    expect(resp.status).toBe(201);
    expect(resp.body.chamado.estado).toBe('aberto');
    expect(resp.body.chamado.tecnico_id).toBeNull();
    expect(resp.body.chamado.regra_distribuicao_id).toBeNull();
  });

  it('com regra, nasce atribuído ao técnico da equipe, com a prioridade e o prazo da regra', async () => {
    const tecnico = await conta('tecnico');
    const cat = await categoria();
    const eq = await equipe([tecnico]);
    const criada = await regra({ categoria_id: cat, equipe_id: eq, prioridade: 'alta' });
    expect(criada.status).toBe(201);

    const resp = await abrir({ categoria_id: cat, local_id: localPadrao });
    const c = resp.body.chamado;

    expect(resp.status).toBe(201);
    expect(c.estado).toBe('atribuido');
    expect(c.tecnico_id).toBe(tecnico.id);
    expect(c.equipe_id).toBe(eq);
    expect(c.regra_distribuicao_id).toBe(criada.body.regra.id);
    expect(c.prioridade).toBe('alta');

    // O prazo é o da prioridade da regra, pela mesma função da abertura comum:
    // um prazo calculado como "baixa" num chamado "alta" atrasaria a cobrança.
    const prazo = await pool.query(
      `SELECT prazo_estimado = prazo_sla('alta', data_abertura, '0 seconds', '0 seconds', $2) AS confere
         FROM chamado WHERE id = $1`,
      [c.id, FUSO]
    );
    expect(prazo.rows[0].confere).toBe(true);

    // Os mesmos estados de uma triagem manual, sem atalho no histórico.
    const historico = await pool.query(
      'SELECT estado_anterior, estado_novo, observacao FROM historico_chamado WHERE chamado_id = $1 ORDER BY id',
      [c.id]
    );
    expect(historico.rows.map((h) => [h.estado_anterior, h.estado_novo])).toEqual([
      [null, 'aberto'],
      ['aberto', 'em_triagem'],
      ['em_triagem', 'atribuido'],
    ]);
    expect(historico.rows[1].observacao).toContain(`regra de distribuição nº ${criada.body.regra.id}`);
    expect(historico.rows[2].observacao).toContain('Distribuído automaticamente');

    const aviso = await pool.query(
      "SELECT 1 FROM notificacao WHERE chamado_id = $1 AND usuario_id = $2 AND tipo = 'atribuicao'",
      [c.id, tecnico.id]
    );
    expect(aviso.rowCount).toBe(1);
  });

  it('divide pela carga: vai para quem tem menos chamados em aberto', async () => {
    const a = await conta('tecnico');
    const b = await conta('tecnico');
    const cat = await categoria();
    await regra({ categoria_id: cat, equipe_id: await equipe([a, b]) });

    const destinos = [];
    for (let i = 0; i < 3; i++) {
      destinos.push((await abrir({ categoria_id: cat, local_id: localPadrao })).body.chamado.tecnico_id);
    }

    // 1º: empate em zero, nenhum recebeu ainda — o de menor id.
    // 2º: o outro, que tem menos em aberto.
    // 3º: empate em um — quem recebeu há mais tempo, para não ser sempre o mesmo.
    const [primeiro, segundo, terceiro] = destinos;
    expect(new Set([primeiro, segundo])).toEqual(new Set([a.id, b.id]));
    expect(terceiro).toBe(primeiro);
    expect(primeiro).toBe(Math.min(a.id, b.id));
  });

  it('chamado concluído deixa de pesar na carga', async () => {
    const a = await conta('tecnico');
    const b = await conta('tecnico');
    const cat = await categoria();
    await regra({ categoria_id: cat, equipe_id: await equipe([a, b]) });

    const abrirUm = async () => (await abrir({ categoria_id: cat, local_id: localPadrao })).body.chamado;
    const c1 = await abrirUm();
    const c2 = await abrirUm();
    const c3 = await abrirUm();
    expect(c3.tecnico_id).toBe(c1.tecnico_id);

    // Quem recebeu dois conclui os dois: fica com zero em aberto contra um do
    // outro. Se o concluído ainda contasse, seriam dois contra um, e o
    // próximo iria para o outro técnico.
    await pool.query(
      `UPDATE chamado SET estado = 'concluido', servico_realizado = 'Lâmpada trocada.', data_conclusao = now(),
              epi_confirmado_em = now(), epi_confirmado_por = COALESCE(tecnico_id, solicitante_id)
        WHERE id = ANY($1::int[])`,
      [[c1.id, c3.id]]
    );
    const c4 = await abrirUm();
    expect(c4.tecnico_id).toBe(c1.tecnico_id);
    expect(c4.tecnico_id).not.toBe(c2.tecnico_id);
  });

  it('o técnico de plantão recebe mesmo com mais carga; desativado, a equipe divide', async () => {
    const plantao = await conta('tecnico');
    const outro = await conta('tecnico');
    const cat = await categoria();
    await regra({ categoria_id: cat, equipe_id: await equipe([plantao, outro]), tecnico_id: plantao.id });

    for (let i = 0; i < 2; i++) {
      const c = (await abrir({ categoria_id: cat, local_id: localPadrao })).body.chamado;
      expect(c.tecnico_id).toBe(plantao.id);
    }

    await pool.query('UPDATE usuario SET ativo = FALSE WHERE id = $1', [plantao.id]);
    const depois = (await abrir({ categoria_id: cat, local_id: localPadrao })).body.chamado;
    expect(depois.estado).toBe('atribuido');
    expect(depois.tecnico_id).toBe(outro.id);
  });

  it('a regra mais específica vence, e a de equipe desativada cede à mais geral', async () => {
    const t1 = await conta('tecnico');
    const t2 = await conta('tecnico');
    const t3 = await conta('tecnico');
    const cat = await categoria();
    const geral = await equipe([t1]);
    const daUnidade = await equipe([t2]);
    const doBloco = await equipe([t3]);
    const unidade = `${MARCA} Campus`;

    await regra({ categoria_id: cat, equipe_id: geral });
    // Escrita com outra caixa e espaço sobrando: o local é comparado como a
    // chave natural dele, e "campus" digitado à mão é o mesmo lugar.
    await regra({ categoria_id: cat, equipe_id: daUnidade, unidade: ` ${unidade.toUpperCase()} ` });
    await regra({ categoria_id: cat, equipe_id: doBloco, unidade, bloco: 'b' });

    const noBloco = await garantirLocal({ unidade, bloco: 'B', ambiente: 'Lab 1' });
    const outroBloco = await garantirLocal({ unidade, bloco: 'C', ambiente: 'Lab 2' });
    const semBloco = await garantirLocal({ unidade, ambiente: 'Portaria' });

    const destino = async (local) => (await abrir({ categoria_id: cat, local_id: local })).body.chamado.equipe_id;

    expect(await destino(noBloco)).toBe(doBloco);
    expect(await destino(outroBloco)).toBe(daUnidade);
    expect(await destino(semBloco)).toBe(daUnidade);
    expect(await destino(localPadrao)).toBe(geral);

    await pool.query('UPDATE equipe SET ativo = FALSE WHERE id = $1', [doBloco]);
    expect(await destino(noBloco)).toBe(daUnidade);
  });

  it('equipe sem técnico ativo: o chamado fica para a triagem, como sem regra', async () => {
    const parado = await conta('tecnico');
    const cat = await categoria();
    await regra({ categoria_id: cat, equipe_id: await equipe([parado]) });
    await pool.query('UPDATE usuario SET ativo = FALSE WHERE id = $1', [parado.id]);

    const c = (await abrir({ categoria_id: cat, local_id: localPadrao })).body.chamado;
    expect(c.estado).toBe('aberto');
    expect(c.tecnico_id).toBeNull();
    expect(c.regra_distribuicao_id).toBeNull();
  });

  it('regra desligada não distribui', async () => {
    const tecnico = await conta('tecnico');
    const cat = await categoria();
    const criada = await regra({ categoria_id: cat, equipe_id: await equipe([tecnico]) });

    const desligada = await request(app)
      .patch(`/regras-distribuicao/${criada.body.regra.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ ativo: false });
    expect(desligada.status).toBe(200);
    expect(desligada.body.regra.ativo).toBe(false);

    const c = (await abrir({ categoria_id: cat, local_id: localPadrao })).body.chamado;
    expect(c.estado).toBe('aberto');
  });

  it('prioridade informada na abertura vence a da regra', async () => {
    const tecnico = await conta('tecnico');
    const cat = await categoria();
    await regra({ categoria_id: cat, equipe_id: await equipe([tecnico]), prioridade: 'baixa' });

    const c = (await abrir({ categoria_id: cat, local_id: localPadrao, prioridade: 'critica' }, admin)).body
      .chamado;
    expect(c.prioridade).toBe('critica');
    expect(c.estado).toBe('atribuido');
  });

  it('abertura pelo QR do equipamento também distribui, pela categoria dele', async () => {
    const tecnico = await conta('tecnico');
    const cat = await categoria();
    await regra({ categoria_id: cat, equipe_id: await equipe([tecnico]) });
    const { rows } = await pool.query(
      `INSERT INTO equipamento (codigo, nome, categoria_id, local_id)
       VALUES ($1, 'Bomba de teste', $2, $3) RETURNING id`,
      [`${MARCA}`.toUpperCase().slice(0, 40), cat, localPadrao]
    );
    criados.equipamentos.push(rows[0].id);

    const c = (await abrir({ equipamento_id: rows[0].id })).body.chamado;
    expect(c.categoria_id).toBe(cat);
    expect(c.tecnico_id).toBe(tecnico.id);
  });

  it('a escolha espera a vez da equipe: duas aberturas simultâneas não leem a mesma carga', async () => {
    // Duas requisições ao mesmo tempo raramente se cruzam no ponto exato, e um
    // teste assim passaria com ou sem a trava. Aqui o cruzamento é forçado:
    // a primeira transação escolhe e atribui, mas ainda não confirmou, quando
    // a segunda vai escolher. Sem a trava, a segunda lê a carga de antes e
    // escolhe o mesmo técnico; com ela, espera a primeira terminar.
    const a = await conta('tecnico');
    const b = await conta('tecnico');
    const cat = await categoria();
    const primeiroChamado = (await abrir({ categoria_id: cat, local_id: localPadrao })).body.chamado;
    const criada = await regra({ categoria_id: cat, equipe_id: await equipe([a, b]) });
    const { rows } = await pool.query('SELECT * FROM regra_distribuicao WHERE id = $1', [criada.body.regra.id]);

    const t1 = await pool.connect();
    const t2 = await pool.connect();
    try {
      await t1.query('BEGIN');
      await t2.query('BEGIN');
      const primeiro = await distribuicaoService.escolherTecnico(t1, rows[0]);
      await t1.query("UPDATE chamado SET estado = 'atribuido', tecnico_id = $1 WHERE id = $2", [
        primeiro.id,
        primeiroChamado.id,
      ]);

      const segundaEscolha = distribuicaoService.escolherTecnico(t2, rows[0]);
      await new Promise((resolver) => setTimeout(resolver, 150));
      await t1.query('COMMIT');
      const segundo = await segundaEscolha;
      await t2.query('ROLLBACK');

      expect(segundo.id).not.toBe(primeiro.id);
    } finally {
      t1.release();
      t2.release();
    }
  });
});

describe('Cadastro das regras de distribuição', () => {
  it('é da gestão: técnico e solicitante não leem nem criam', async () => {
    const cat = await categoria();
    const eq = await equipe([tecnicoAvulso]);
    for (const quem of [tecnicoAvulso, solicitante]) {
      const lista = await request(app).get('/regras-distribuicao').set('Authorization', `Bearer ${quem.token}`);
      expect(lista.status).toBe(403);
      const nova = await regra({ categoria_id: cat, equipe_id: eq }, quem);
      expect(nova.status).toBe(403);
    }
  });

  it('lista a regra com os nomes e quantos técnicos ativos a equipe tem', async () => {
    const tecnico = await conta('tecnico');
    const cat = await categoria();
    const eq = await equipe([tecnico]);
    const criada = await regra({ categoria_id: cat, equipe_id: eq, unidade: 'Sede', bloco: 'A', tecnico_id: tecnico.id });
    expect(criada.status).toBe(201);

    const lista = await request(app).get('/regras-distribuicao').set('Authorization', `Bearer ${admin.token}`);
    const r = lista.body.regras.find((x) => x.id === criada.body.regra.id);
    expect(r).toMatchObject({
      categoria_id: cat,
      equipe_id: eq,
      unidade: 'Sede',
      bloco: 'A',
      tecnico_id: tecnico.id,
      tecnico_nome: 'Dist tecnico',
      prioridade: 'baixa',
      ativo: true,
      tecnicos_ativos: 1,
    });
    expect(r.categoria_nome).toContain(MARCA.slice(0, 10));
  });

  it('o plantonista precisa ser técnico ativo da equipe', async () => {
    const dentro = await conta('tecnico');
    const fora = await conta('tecnico');
    const cat = await categoria();
    const resp = await regra({ categoria_id: cat, equipe_id: await equipe([dentro]), tecnico_id: fora.id });
    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('PLANTONISTA_FORA_DA_EQUIPE');
  });

  it('bloco sem unidade é recusado', async () => {
    const cat = await categoria();
    const resp = await regra({ categoria_id: cat, equipe_id: await equipe([tecnicoAvulso]), bloco: 'A' });
    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('ALCANCE_INVALIDO');
  });

  it('duas regras ligadas com o mesmo alcance são recusadas; desligada a primeira, a nova entra', async () => {
    const cat = await categoria();
    const eq = await equipe([tecnicoAvulso]);
    const primeira = await regra({ categoria_id: cat, equipe_id: eq, unidade: 'Sede' });
    expect(primeira.status).toBe(201);

    const repetida = await regra({ categoria_id: cat, equipe_id: eq, unidade: ' sede ' });
    expect(repetida.status).toBe(409);
    expect(repetida.body.erro.codigo).toBe('REGRA_DUPLICADA');

    await request(app)
      .patch(`/regras-distribuicao/${primeira.body.regra.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ ativo: false });
    const nova = await regra({ categoria_id: cat, equipe_id: eq, unidade: 'Sede' });
    expect(nova.status).toBe(201);

    // E religar a antiga agora bateria na nova.
    const religar = await request(app)
      .patch(`/regras-distribuicao/${primeira.body.regra.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ ativo: true });
    expect(religar.status).toBe(409);
  });

  it('equipe desativada e categoria inexistente são recusadas', async () => {
    const cat = await categoria();
    const eq = await equipe([tecnicoAvulso]);
    await pool.query('UPDATE equipe SET ativo = FALSE WHERE id = $1', [eq]);

    const inativa = await regra({ categoria_id: cat, equipe_id: eq });
    expect(inativa.status).toBe(422);
    expect(inativa.body.erro.codigo).toBe('EQUIPE_INATIVA');

    const semCategoria = await regra({ categoria_id: 999999999, equipe_id: await equipe([tecnicoAvulso]) });
    expect(semCategoria.status).toBe(422);
    expect(semCategoria.body.erro.codigo).toBe('REFERENCIA_INVALIDA');
  });

  it('trocar a equipe solta o plantonista da equipe antiga', async () => {
    const plantao = await conta('tecnico');
    const cat = await categoria();
    const criada = await regra({ categoria_id: cat, equipe_id: await equipe([plantao]), tecnico_id: plantao.id });
    const nova = await equipe([tecnicoAvulso]);

    const resp = await request(app)
      .patch(`/regras-distribuicao/${criada.body.regra.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ equipe_id: nova });
    expect(resp.status).toBe(200);
    expect(resp.body.regra.equipe_id).toBe(nova);
    expect(resp.body.regra.tecnico_id).toBeNull();
  });

  it('valida o corpo e o id', async () => {
    const cat = await categoria();
    const criada = await regra({ categoria_id: cat, equipe_id: await equipe([tecnicoAvulso]) });

    const naoBooleano = await request(app)
      .patch(`/regras-distribuicao/${criada.body.regra.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ ativo: 'sim' });
    expect(naoBooleano.status).toBe(422);

    const prioridade = await regra({ categoria_id: cat, equipe_id: 1, prioridade: 'urgentissima' });
    expect(prioridade.status).toBe(422);

    const idTexto = await request(app)
      .patch('/regras-distribuicao/abc')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ ativo: false });
    expect(idTexto.status).toBe(404);
  });
});

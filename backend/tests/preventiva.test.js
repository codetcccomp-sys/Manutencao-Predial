const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const preventivaService = require('../src/services/preventiva.service');
const { garantirLocal } = require('./apoio/local');
const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);
const SEGREDO = 'segredo-do-agendador-preventiva';
process.env.CRON_SECRET = SEGREDO;

const marca = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

let gestor;
let solicitante;
let tecnico;
let localA;
let localB;
let categoria;
let outraCategoria;
const planosCriados = [];

async function pessoa(perfil) {
  const email = `${perfil}_prev_${marca}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Preventiva ${perfil}`, email, senha: 'senha-teste-123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha-teste-123' });
  return { token: login.body.token, id: login.body.usuario.id };
}

const como = (quem) => ({ Authorization: `Bearer ${quem.token}` });

async function novoEquipamento(campos = {}) {
  const resp = await request(app)
    .post('/equipamentos')
    .set(como(gestor))
    .send({
      codigo: `EQ-${marca}-${Math.random().toString(36).slice(2, 7)}`,
      nome: 'Bomba de recalque',
      categoria_id: categoria,
      local_id: localA,
      ...campos,
    });
  if (resp.status !== 201) throw new Error(`equipamento não criado: ${JSON.stringify(resp.body)}`);
  return resp.body.equipamento;
}

async function novoPlano(campos = {}) {
  const resp = await request(app)
    .post('/planos-preventivos')
    .set(como(gestor))
    .send({
      titulo: `Limpeza do filtro ${marca}`,
      descricao: 'Desligar, retirar o filtro, lavar, secar e recolocar. Medir a corrente.',
      local_id: localA,
      categoria_id: categoria,
      repetir_a_cada: 1,
      unidade_repeticao: 'mes',
      proxima_execucao: '2031-03-10',
      ...campos,
    });
  if (resp.status !== 201) throw new Error(`plano não criado: ${JSON.stringify(resp.body)}`);
  planosCriados.push(resp.body.plano.id);
  return resp.body.plano;
}

const chamadosDoPlano = async (planoId) =>
  (
    await pool.query(
      'SELECT * FROM chamado WHERE plano_id = $1 ORDER BY data_prevista',
      [planoId]
    )
  ).rows;

const planoNoBanco = async (id) =>
  (await pool.query('SELECT * FROM plano_preventivo WHERE id = $1', [id])).rows[0];

beforeAll(async () => {
  [gestor, solicitante, tecnico] = await Promise.all([pessoa('gestor'), pessoa('solicitante'), pessoa('tecnico')]);
  localA = await garantirLocal({ unidade: 'Unidade Preventiva', bloco: 'A' });
  localB = await garantirLocal({ unidade: 'Unidade Preventiva', bloco: 'B' });
  const categorias = (await pool.query('SELECT id FROM categoria ORDER BY id LIMIT 2')).rows;
  categoria = categorias[0].id;
  outraCategoria = categorias[1].id;
});

afterAll(async () => {
  // Os planos ficam no banco (o histórico dos chamados aponta para eles), mas
  // desligados: a próxima rodada, com outro "hoje", não pode gerar chamados
  // a partir deles e bagunçar a contagem de outra suíte.
  if (planosCriados.length) {
    await pool.query('UPDATE plano_preventivo SET ativo = FALSE WHERE id = ANY($1::int[])', [planosCriados]);
  }
  await pool.end();
});

describe('Equipamentos', () => {
  it('a gestão cadastra, e o código da etiqueta é guardado normalizado', async () => {
    const codigo = `  bomba-${marca}  `;
    const resp = await request(app)
      .post('/equipamentos')
      .set(como(gestor))
      .send({ codigo, nome: 'Bomba d\'água', categoria_id: categoria, local_id: localA, data_instalacao: '2024-05-02' });

    expect(resp.status).toBe(201);
    expect(resp.body.equipamento.codigo).toBe(`BOMBA-${marca}`);
    expect(resp.body.equipamento.data_instalacao).toBe('2024-05-02');
    expect(resp.body.equipamento.local_rotulo).toBe('Unidade Preventiva / A');
  });

  it('o mesmo código, escrito de outro jeito, é recusado como duplicado', async () => {
    const eq = await novoEquipamento();
    const resp = await request(app)
      .post('/equipamentos')
      .set(como(gestor))
      .send({ codigo: eq.codigo.toLowerCase(), nome: 'Outra', categoria_id: categoria, local_id: localA });
    expect(resp.status).toBe(409);
    expect(resp.body.erro.codigo).toBe('CODIGO_DUPLICADO');
  });

  it('código com espaço no meio não vira etiqueta', async () => {
    const resp = await request(app)
      .post('/equipamentos')
      .set(como(gestor))
      .send({ codigo: 'BOMBA 01', nome: 'Bomba', categoria_id: categoria, local_id: localA });
    expect(resp.status).toBe(422);
  });

  it('solicitante não cadastra equipamento', async () => {
    const resp = await request(app)
      .post('/equipamentos')
      .set(como(solicitante))
      .send({ codigo: `X-${marca}`, nome: 'Bomba', categoria_id: categoria, local_id: localA });
    expect(resp.status).toBe(403);
  });

  it('acha pelo código da etiqueta, em qualquer caixa; desativado deixa de achar', async () => {
    const eq = await novoEquipamento();
    const achado = await request(app)
      .get(`/equipamentos/codigo/${encodeURIComponent(eq.codigo.toLowerCase())}`)
      .set(como(solicitante));
    expect(achado.status).toBe(200);
    expect(achado.body.equipamento.id).toBe(eq.id);

    await request(app).patch(`/equipamentos/${eq.id}`).set(como(gestor)).send({ ativo: false });
    const depois = await request(app).get(`/equipamentos/codigo/${eq.codigo}`).set(como(solicitante));
    expect(depois.status).toBe(404);
  });

  it('a ficha traz o histórico de chamados para a gestão, e não para o solicitante', async () => {
    const eq = await novoEquipamento();
    await request(app)
      .post('/chamados')
      .set(como(solicitante))
      .send({ titulo: 'Bomba fazendo barulho', descricao: 'Ruído forte ao ligar.', equipamento_id: eq.id });

    const daGestao = await request(app).get(`/equipamentos/${eq.id}`).set(como(gestor));
    expect(daGestao.status).toBe(200);
    expect(daGestao.body.equipamento.chamados).toHaveLength(1);
    expect(daGestao.body.equipamento.totais).toMatchObject({ chamados: 1, corretivos: 1, preventivos: 0 });

    const doSolicitante = await request(app).get(`/equipamentos/${eq.id}`).set(como(solicitante));
    expect(doSolicitante.status).toBe(200);
    expect(doSolicitante.body.equipamento.chamados).toBeUndefined();
  });
});

describe('Chamado aberto para um equipamento', () => {
  it('só com o equipamento, herda local e categoria dele (o caminho do QR Code)', async () => {
    const eq = await novoEquipamento({ categoria_id: outraCategoria });
    const resp = await request(app)
      .post('/chamados')
      .set(como(solicitante))
      .send({ titulo: 'Vazamento na bomba', descricao: 'Pinga água embaixo.', equipamento_id: eq.id });

    expect(resp.status).toBe(201);
    expect(resp.body.chamado).toMatchObject({
      equipamento_id: eq.id,
      local_id: localA,
      categoria_id: outraCategoria,
      origem: 'corretiva',
    });

    const detalhe = await request(app).get(`/chamados/${resp.body.chamado.id}`).set(como(solicitante));
    expect(detalhe.body.chamado.equipamento_codigo).toBe(eq.codigo);
  });

  it('equipamento de um local com outro local no chamado é recusado', async () => {
    const eq = await novoEquipamento();
    const resp = await request(app)
      .post('/chamados')
      .set(como(solicitante))
      .send({ titulo: 'Vazamento', descricao: 'Pinga água.', categoria_id: categoria, local_id: localB, equipamento_id: eq.id });
    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('EQUIPAMENTO_FORA_DO_LOCAL');
  });

  it('equipamento desativado não recebe chamado novo', async () => {
    const eq = await novoEquipamento();
    await request(app).patch(`/equipamentos/${eq.id}`).set(como(gestor)).send({ ativo: false });
    const resp = await request(app)
      .post('/chamados')
      .set(como(solicitante))
      .send({ titulo: 'Vazamento', descricao: 'Pinga água.', equipamento_id: eq.id });
    expect(resp.status).toBe(422);
  });

  it('sem equipamento, local e categoria continuam obrigatórios', async () => {
    const resp = await request(app)
      .post('/chamados')
      .set(como(solicitante))
      .send({ titulo: 'Vazamento', descricao: 'Pinga água.' });
    expect(resp.status).toBe(422);
    expect(resp.body.erro.mensagem).toMatch(/local_id/);
    expect(resp.body.erro.mensagem).toMatch(/categoria_id/);
  });

  it('mudar só o local solta o equipamento, que ficou no lugar antigo', async () => {
    const eq = await novoEquipamento();
    const criado = await request(app)
      .post('/chamados')
      .set(como(solicitante))
      .send({ titulo: 'Vazamento', descricao: 'Pinga água.', equipamento_id: eq.id });

    const editado = await request(app)
      .patch(`/chamados/${criado.body.chamado.id}`)
      .set(como(solicitante))
      .send({ local_id: localB });

    expect(editado.status).toBe(200);
    expect(editado.body.chamado.local_id).toBe(localB);
    expect(editado.body.chamado.equipamento_id).toBeNull();
  });

  it('a lista filtra por equipamento e por origem', async () => {
    const eq = await novoEquipamento();
    const outro = await novoEquipamento();
    const meu = await request(app)
      .post('/chamados')
      .set(como(solicitante))
      .send({ titulo: 'Ruído', descricao: 'Barulho estranho.', equipamento_id: eq.id });
    await request(app)
      .post('/chamados')
      .set(como(solicitante))
      .send({ titulo: 'Ruído no outro', descricao: 'Barulho estranho.', equipamento_id: outro.id });

    const doEquipamento = await request(app)
      .get('/chamados')
      .query({ equipamento_id: eq.id })
      .set(como(gestor));
    expect(doEquipamento.body.chamados.map((c) => c.id)).toEqual([meu.body.chamado.id]);

    const corretivos = await request(app)
      .get('/chamados')
      .query({ equipamento_id: eq.id, origem: 'corretiva' })
      .set(como(gestor));
    expect(corretivos.body.chamados).toHaveLength(1);

    const preventivos = await request(app)
      .get('/chamados')
      .query({ equipamento_id: eq.id, origem: 'preventiva' })
      .set(como(gestor));
    expect(preventivos.body.chamados).toHaveLength(0);
  });
});

describe('Planos preventivos: cadastro', () => {
  it('com equipamento, o plano herda local e categoria', async () => {
    const eq = await novoEquipamento({ categoria_id: outraCategoria });
    const plano = await novoPlano({ equipamento_id: eq.id, local_id: undefined, categoria_id: undefined });
    expect(plano).toMatchObject({
      local_id: localA,
      categoria_id: outraCategoria,
      equipamento_codigo: eq.codigo,
      data_inicio: '2031-03-10',
      proxima_execucao: '2031-03-10',
    });
  });

  it('sem equipamento, exige local e categoria', async () => {
    const resp = await request(app)
      .post('/planos-preventivos')
      .set(como(gestor))
      .send({
        titulo: 'Plano sem alvo',
        descricao: 'Sem dizer onde nem o quê.',
        repetir_a_cada: 1,
        unidade_repeticao: 'mes',
        proxima_execucao: '2031-01-01',
      });
    expect(resp.status).toBe(422);
  });

  it('o responsável precisa ser técnico', async () => {
    const resp = await request(app)
      .post('/planos-preventivos')
      .set(como(gestor))
      .send({
        titulo: 'Plano com responsável errado',
        descricao: 'Responsável que não é técnico.',
        local_id: localA,
        categoria_id: categoria,
        repetir_a_cada: 1,
        unidade_repeticao: 'mes',
        proxima_execucao: '2031-01-01',
        tecnico_id: solicitante.id,
      });
    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('TECNICO_INVALIDO');
  });

  it('data em formato errado é recusada', async () => {
    const resp = await request(app)
      .post('/planos-preventivos')
      .set(como(gestor))
      .send({
        titulo: 'Plano com data errada',
        descricao: 'Data no formato brasileiro.',
        local_id: localA,
        categoria_id: categoria,
        repetir_a_cada: 1,
        unidade_repeticao: 'mes',
        proxima_execucao: '10/03/2031',
      });
    expect(resp.status).toBe(422);
  });

  it('é da gestão: técnico e solicitante não veem nem criam planos', async () => {
    expect((await request(app).get('/planos-preventivos').set(como(tecnico))).status).toBe(403);
    expect((await request(app).get('/planos-preventivos').set(como(solicitante))).status).toBe(403);
  });

  it('mudar a periodicidade reancora o calendário na nova próxima data', async () => {
    const plano = await novoPlano({ proxima_execucao: '2031-02-01' });
    const resp = await request(app)
      .patch(`/planos-preventivos/${plano.id}`)
      .set(como(gestor))
      .send({ repetir_a_cada: 6, proxima_execucao: '2031-04-15' });
    expect(resp.status).toBe(200);
    expect(resp.body.plano).toMatchObject({ repetir_a_cada: 6, data_inicio: '2031-04-15', proxima_execucao: '2031-04-15' });
  });
});

describe('Planos preventivos: geração dos chamados', () => {
  it('no dia previsto, gera um chamado preventivo com prazo no fim do dia e avança o plano', async () => {
    const plano = await novoPlano({ proxima_execucao: '2031-03-10' });

    const resultado = await preventivaService.gerarVencidos({ hoje: '2031-03-10' });
    expect(resultado.gerados.map((g) => g.plano_id)).toContain(plano.id);

    const [chamado] = await chamadosDoPlano(plano.id);
    expect(chamado).toMatchObject({
      origem: 'preventiva',
      data_prevista: '2031-03-10',
      estado: 'aberto',
      solicitante_id: gestor.id,
      local_id: localA,
    });
    // Fim do dia 10/03 em Brasília = 00:00 de 11/03 em -03:00.
    expect(new Date(chamado.prazo_estimado).toISOString()).toBe('2031-03-11T03:00:00.000Z');
    expect((await planoNoBanco(plano.id)).proxima_execucao).toBe('2031-04-10');

    const historico = (
      await pool.query('SELECT * FROM historico_chamado WHERE chamado_id = $1', [chamado.id])
    ).rows;
    expect(historico[0].observacao).toMatch(/plano "Limpeza do filtro/);
  });

  it('rodar de novo no mesmo dia não duplica', async () => {
    const plano = await novoPlano({ proxima_execucao: '2031-05-20' });
    await preventivaService.gerarVencidos({ hoje: '2031-05-20' });
    await preventivaService.gerarVencidos({ hoje: '2031-05-20' });
    expect(await chamadosDoPlano(plano.id)).toHaveLength(1);
  });

  it('plano editado de volta para uma data que já tem chamado não trava: pula e segue', async () => {
    const plano = await novoPlano({ proxima_execucao: '2031-12-10' });
    await preventivaService.gerarVencidos({ hoje: '2031-12-10' });
    // A gestão "volta" a próxima data para a que já foi gerada.
    await request(app)
      .patch(`/planos-preventivos/${plano.id}`)
      .set(como(gestor))
      .send({ proxima_execucao: '2031-12-10' });

    const resultado = await preventivaService.gerarVencidos({ hoje: '2031-12-10' });

    expect(resultado.falhas).not.toContain(plano.id);
    expect(await chamadosDoPlano(plano.id)).toHaveLength(1);
    // E o plano anda, em vez de tentar a mesma data todo dia para sempre.
    expect((await planoNoBanco(plano.id)).proxima_execucao).toBe('2032-01-10');
  });

  it('duas passagens simultâneas do agendador geram um chamado só', async () => {
    const plano = await novoPlano({ proxima_execucao: '2031-06-01' });
    await Promise.all([
      preventivaService.gerarVencidos({ hoje: '2031-06-01' }),
      preventivaService.gerarVencidos({ hoje: '2031-06-01' }),
      preventivaService.gerarVencidos({ hoje: '2031-06-01' }),
    ]);
    expect(await chamadosDoPlano(plano.id)).toHaveLength(1);
  });

  it('respeita a antecedência: gera dias antes, e não antes da janela', async () => {
    const plano = await novoPlano({ proxima_execucao: '2031-07-20', antecedencia_dias: 5 });

    await preventivaService.gerarVencidos({ hoje: '2031-07-14' });
    expect(await chamadosDoPlano(plano.id)).toHaveLength(0);

    await preventivaService.gerarVencidos({ hoje: '2031-07-15' });
    const chamados = await chamadosDoPlano(plano.id);
    expect(chamados).toHaveLength(1);
    expect(chamados[0].data_prevista).toBe('2031-07-20');
  });

  it('mensal a partir de um dia 31 não escorrega para o dia 28', async () => {
    const plano = await novoPlano({ proxima_execucao: '2032-01-31' });

    await preventivaService.gerarVencidos({ hoje: '2032-01-31' });
    expect((await planoNoBanco(plano.id)).proxima_execucao).toBe('2032-02-29');

    await preventivaService.gerarVencidos({ hoje: '2032-02-29' });
    expect((await planoNoBanco(plano.id)).proxima_execucao).toBe('2032-03-31');

    expect((await chamadosDoPlano(plano.id)).map((c) => c.data_prevista)).toEqual(['2032-01-31', '2032-02-29']);
  });

  it('agendador parado: gera só a execução mais recente, e o histórico conta as puladas', async () => {
    const plano = await novoPlano({ proxima_execucao: '2033-01-03', unidade_repeticao: 'semana' });

    // Dez semanas depois, sem nenhuma passagem no meio.
    await preventivaService.gerarVencidos({ hoje: '2033-03-14' });

    const chamados = await chamadosDoPlano(plano.id);
    expect(chamados).toHaveLength(1);
    expect(chamados[0].data_prevista).toBe('2033-03-14');
    expect((await planoNoBanco(plano.id)).proxima_execucao).toBe('2033-03-21');

    const { rows } = await pool.query(
      'SELECT observacao FROM historico_chamado WHERE chamado_id = $1',
      [chamados[0].id]
    );
    expect(rows[0].observacao).toMatch(/10 execução\(ões\) anterior\(es\) venceram sem chamado/);
  });

  it('com responsável, o chamado nasce atribuído, pelos estados do fluxo, e o técnico é avisado', async () => {
    const plano = await novoPlano({ proxima_execucao: '2031-08-05', tecnico_id: tecnico.id });
    await preventivaService.gerarVencidos({ hoje: '2031-08-05' });

    const [chamado] = await chamadosDoPlano(plano.id);
    expect(chamado).toMatchObject({ estado: 'atribuido', tecnico_id: tecnico.id });

    const historico = (
      await pool.query(
        'SELECT estado_anterior, estado_novo FROM historico_chamado WHERE chamado_id = $1 ORDER BY id',
        [chamado.id]
      )
    ).rows;
    expect(historico).toEqual([
      { estado_anterior: null, estado_novo: 'aberto' },
      { estado_anterior: 'aberto', estado_novo: 'em_triagem' },
      { estado_anterior: 'em_triagem', estado_novo: 'atribuido' },
    ]);

    const avisos = (
      await pool.query("SELECT tipo FROM notificacao WHERE usuario_id = $1 AND chamado_id = $2", [tecnico.id, chamado.id])
    ).rows;
    expect(avisos).toEqual([{ tipo: 'atribuicao' }]);

    // E aparece na fila dele, que é por onde ele trabalha.
    const fila = await request(app).get('/chamados').query({ situacao: 'abertos' }).set(como(tecnico));
    expect(fila.body.chamados.map((c) => c.id)).toContain(chamado.id);
  });

  it('responsável desativado depois do cadastro: o chamado entra na triagem, sem técnico', async () => {
    const outro = await pessoa('tecnico');
    const plano = await novoPlano({ proxima_execucao: '2031-09-09', tecnico_id: outro.id });
    await pool.query('UPDATE usuario SET ativo = FALSE WHERE id = $1', [outro.id]);

    await preventivaService.gerarVencidos({ hoje: '2031-09-09' });
    const [chamado] = await chamadosDoPlano(plano.id);
    expect(chamado).toMatchObject({ estado: 'aberto', tecnico_id: null });
  });

  it('plano desativado não gera', async () => {
    const plano = await novoPlano({ proxima_execucao: '2031-10-01' });
    await request(app).patch(`/planos-preventivos/${plano.id}`).set(como(gestor)).send({ ativo: false });
    await preventivaService.gerarVencidos({ hoje: '2031-10-01' });
    expect(await chamadosDoPlano(plano.id)).toHaveLength(0);
  });

  it('"gerar agora" antecipa a próxima execução e avança o plano', async () => {
    const plano = await novoPlano({ proxima_execucao: '2034-02-15', repetir_a_cada: 3 });
    const resp = await request(app).post(`/planos-preventivos/${plano.id}/gerar`).set(como(gestor));

    expect(resp.status).toBe(201);
    expect(resp.body.gerado.dataPrevista).toBe('2034-02-15');
    expect((await planoNoBanco(plano.id)).proxima_execucao).toBe('2034-05-15');
  });

  it('repriorizar uma preventiva muda a ordem na fila, não o dia marcado', async () => {
    const plano = await novoPlano({ proxima_execucao: '2031-11-11' });
    await preventivaService.gerarVencidos({ hoje: '2031-11-11' });
    const [chamado] = await chamadosDoPlano(plano.id);

    await request(app).patch(`/chamados/${chamado.id}/estado`).set(como(gestor)).send({ estado: 'em_triagem' });
    const resp = await request(app)
      .patch(`/chamados/${chamado.id}/priorizacao`)
      .set(como(gestor))
      .send({ urgencia: 4, impacto: 4, risco: 4 });

    expect(resp.status).toBe(200);
    expect(new Date(resp.body.chamado.prazo_estimado).toISOString()).toBe(
      new Date(chamado.prazo_estimado).toISOString()
    );
  });
});

describe('POST /tarefas/gerar-preventivas', () => {
  it('sem o segredo do agendador, recusa', async () => {
    const resp = await request(app).post('/tarefas/gerar-preventivas');
    expect(resp.status).toBe(401);
  });

  it('com o segredo, roda e diz o que fez', async () => {
    const resp = await request(app)
      .post('/tarefas/gerar-preventivas')
      .set('Authorization', `Bearer ${SEGREDO}`);
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty('chamados_gerados');
    expect(resp.body).toHaveProperty('hoje');
  });
});

describe('Vercel Cron: GET /tarefas/gerar-preventivas', () => {
  // O Vercel Cron só faz GET, mandando o CRON_SECRET no Authorization.
  it('o job do vercel.json aponta para esta rota, uma vez por dia', () => {
    const { crons } = require('../vercel.json');
    expect(crons).toContainEqual({ path: '/tarefas/gerar-preventivas', schedule: expect.stringMatching(/^\d+ \d+ \* \* \*$/) });
  });

  it('sem o segredo, recusa como o POST', async () => {
    expect((await request(app).get('/tarefas/gerar-preventivas')).status).toBe(401);
  });

  it('com o segredo, roda e registra a passagem', async () => {
    const resp = await request(app).get('/tarefas/gerar-preventivas').set('Authorization', `Bearer ${SEGREDO}`);
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty('chamados_gerados');
  });
});

describe('GET /relatorios/preventiva', () => {
  it('mede o cumprimento pelo que já pode ser julgado, recortado pela data prevista', async () => {
    // Um período só desta suíte (2040), para outras preventivas no banco não
    // entrarem na conta — e os planos dos testes anteriores desligados: um
    // mensal de 2031, varrido em 2040, teria a sua execução de janeiro.
    await pool.query('UPDATE plano_preventivo SET ativo = FALSE WHERE id = ANY($1::int[])', [planosCriados]);
    const emDia = await novoPlano({ proxima_execucao: '2040-01-05', titulo: `Em dia ${marca}` });
    const atrasada = await novoPlano({ proxima_execucao: '2040-01-10', titulo: `Atrasada ${marca}` });
    const futura = await novoPlano({ proxima_execucao: '2040-01-20', titulo: `Futura ${marca}` });
    await preventivaService.gerarVencidos({ hoje: '2040-01-20' });

    const [c1] = await chamadosDoPlano(emDia.id);
    const [c2] = await chamadosDoPlano(atrasada.id);
    const [c3] = await chamadosDoPlano(futura.id);

    // Em dia: concluída antes do prazo. Vencida: prazo no passado, sem
    // conclusão. Futura: prazo ainda por vir (não julgável).
    await pool.query(
      `UPDATE chamado SET estado = 'concluido', servico_realizado = 'Filtro limpo e recolocado.',
              data_conclusao = prazo_estimado - interval '1 hour',
              epi_confirmado_em = now(), epi_confirmado_por = COALESCE(tecnico_id, solicitante_id) WHERE id = $1`,
      [c1.id]
    );
    await pool.query("UPDATE chamado SET prazo_estimado = now() - interval '1 day' WHERE id = $1", [c2.id]);
    await pool.query("UPDATE chamado SET prazo_estimado = now() + interval '10 days' WHERE id = $1", [c3.id]);

    const resp = await request(app)
      .get('/relatorios/preventiva')
      .query({ de: '2040-01-01', ate: '2040-01-31' })
      .set(como(gestor));

    expect(resp.status).toBe(200);
    expect(resp.body.totais).toMatchObject({
      previstas: 3,
      concluidas_no_prazo: 1,
      concluidas_com_atraso: 0,
      vencidas_pendentes: 1,
      no_prazo_pendentes: 1,
    });
    expect(resp.body.percentual_cumprimento).toBe(50);
    expect(resp.body.planos_com_atraso.map((p) => p.id)).toEqual([atrasada.id]);
  });

  it('período sem preventiva julgável não inventa percentual', async () => {
    const resp = await request(app)
      .get('/relatorios/preventiva')
      .query({ de: '2099-01-01', ate: '2099-01-31' })
      .set(como(gestor));
    expect(resp.body.percentual_cumprimento).toBeNull();
  });

  it('o resumo separa corretiva de preventiva', async () => {
    const resp = await request(app).get('/relatorios/resumo').set(como(gestor));
    const origens = resp.body.por_origem.map((o) => o.origem);
    expect(origens).toEqual(expect.arrayContaining(['corretiva', 'preventiva']));
  });

  it('é da gestão', async () => {
    expect((await request(app).get('/relatorios/preventiva').set(como(tecnico))).status).toBe(403);
  });
});

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');

const { ipDaSuite } = require('./apoio/ip');

// Ver tests/apoio/ip.js: cada suíte se apresenta ao login como um cliente
// distinto, para não dividir a cota por IP com as suítes que rodam em paralelo.
const IP = ipDaSuite(__filename);

let gestor;
let tecnico;
let outroTecnico;
let solicitante;
let localId;
let categoriaId;

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_exe_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Exe ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

const auth = (quem) => ({ Authorization: `Bearer ${quem.token}` });

async function abrirEAtribuir() {
  const abertura = await request(app)
    .post('/chamados')
    .set(auth(solicitante))
    .send({
      titulo: 'Chamado de execução',
      descricao: 'Descrição do problema relatado',
      categoria_id: categoriaId,
      local_id: localId,
    });
  const id = abertura.body.chamado.id;

  await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor)).send({ estado: 'em_triagem' });
  await request(app)
    .patch(`/chamados/${id}/atribuir`)
    .set(auth(gestor))
    .send({ tecnico_id: tecnico.usuario.id });
  return id;
}

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor');
  tecnico = await criarUsuarioELogar('tecnico');
  outroTecnico = await criarUsuarioELogar('tecnico');
  solicitante = await criarUsuarioELogar('solicitante');

  const categoria = await pool.query('SELECT id FROM categoria LIMIT 1');
  localId = await garantirLocal({ unidade: 'Unidade Exe' });
  categoriaId = categoria.rows[0].id;
});

afterAll(async () => {
  await pool.end();
});

describe('Início efetivo da execução', () => {
  it('é gravado ao entrar em "em andamento"', async () => {
    const id = await abrirEAtribuir();

    const antes = await pool.query('SELECT inicio_execucao FROM chamado WHERE id = $1', [id]);
    expect(antes.rows[0].inicio_execucao).toBeNull();

    await request(app).patch(`/chamados/${id}/estado`).set(auth(tecnico)).send({ estado: 'em_andamento' });

    const depois = await pool.query('SELECT inicio_execucao FROM chamado WHERE id = $1', [id]);
    expect(depois.rows[0].inicio_execucao).not.toBeNull();
  });

  it('não é reescrito ao retomar depois de aguardar material', async () => {
    const id = await abrirEAtribuir();
    await request(app).patch(`/chamados/${id}/estado`).set(auth(tecnico)).send({ estado: 'em_andamento' });

    const primeiro = await pool.query('SELECT inicio_execucao FROM chamado WHERE id = $1', [id]);

    await request(app)
      .patch(`/chamados/${id}/estado`)
      .set(auth(tecnico))
      .send({ estado: 'aguardando_material' });
    await request(app).patch(`/chamados/${id}/estado`).set(auth(tecnico)).send({ estado: 'em_andamento' });

    const segundo = await pool.query('SELECT inicio_execucao FROM chamado WHERE id = $1', [id]);

    // Retomar é continuar, não recomeçar: sobrescrever aqui encolheria o
    // "tempo até atendimento" a cada espera por insumo.
    expect(segundo.rows[0].inicio_execucao.getTime()).toBe(primeiro.rows[0].inicio_execucao.getTime());
  });
});

describe('Diagnóstico e tempo empregado', () => {
  it('técnico designado registra diagnóstico e tempo', async () => {
    const id = await abrirEAtribuir();

    const resp = await request(app)
      .patch(`/chamados/${id}/execucao`)
      .set(auth(tecnico))
      .send({ diagnostico: 'Disjuntor do quadro B com folga no barramento.', tempo_empregado_minutos: 90 });

    expect(resp.status).toBe(200);
    expect(resp.body.chamado.diagnostico).toMatch(/Disjuntor/);
    expect(resp.body.chamado.tempo_empregado_minutos).toBe(90);
  });

  it('técnico de outro chamado não registra', async () => {
    const id = await abrirEAtribuir();
    const resp = await request(app)
      .patch(`/chamados/${id}/execucao`)
      .set(auth(outroTecnico))
      .send({ diagnostico: 'Tentativa indevida de registro.' });

    expect(resp.status).toBe(403);
  });

  it('solicitante não registra execução', async () => {
    const id = await abrirEAtribuir();
    const resp = await request(app)
      .patch(`/chamados/${id}/execucao`)
      .set(auth(solicitante))
      .send({ diagnostico: 'Tentativa indevida de registro.' });

    expect(resp.status).toBe(403);
  });

  it('recusa tempo empregado zero ou negativo', async () => {
    const id = await abrirEAtribuir();
    const resp = await request(app)
      .patch(`/chamados/${id}/execucao`)
      .set(auth(tecnico))
      .send({ tempo_empregado_minutos: 0 });

    expect(resp.status).toBe(422);
  });
});

describe('RN07: conclusão exige descrição do serviço', () => {
  async function levarAteAndamento() {
    const id = await abrirEAtribuir();
    await request(app).patch(`/chamados/${id}/estado`).set(auth(tecnico)).send({ estado: 'em_andamento' });
    return id;
  }

  it('recusa concluir sem descrição', async () => {
    const id = await levarAteAndamento();
    const resp = await request(app)
      .patch(`/chamados/${id}/estado`)
      .set(auth(tecnico))
      .send({ estado: 'concluido' });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('SERVICO_OBRIGATORIO');

    const { rows } = await pool.query('SELECT estado FROM chamado WHERE id = $1', [id]);
    expect(rows[0].estado).toBe('em_andamento');
  });

  it('recusa descrição curta demais para ter conteúdo', async () => {
    const id = await levarAteAndamento();
    const resp = await request(app)
      .patch(`/chamados/${id}/estado`)
      .set(auth(tecnico))
      .send({ estado: 'concluido', servico_realizado: 'ok' });

    expect(resp.status).toBe(422);
  });

  it('conclui com descrição e a guarda no chamado', async () => {
    const id = await levarAteAndamento();
    const resp = await request(app)
      .patch(`/chamados/${id}/estado`)
      .set(auth(tecnico))
      .send({
        estado: 'concluido',
        servico_realizado: 'Substituído o disjuntor e reapertado o barramento do quadro B.',
      });

    expect(resp.status).toBe(200);
    expect(resp.body.chamado.estado).toBe('concluido');
    expect(resp.body.chamado.servico_realizado).toMatch(/disjuntor/);
    expect(resp.body.chamado.data_conclusao).not.toBeNull();
  });

  it('o banco também recusa conclusão sem descrição, por escrita direta', async () => {
    const id = await levarAteAndamento();
    await expect(
      pool.query("UPDATE chamado SET estado = 'concluido' WHERE id = $1", [id])
    ).rejects.toThrow(/chamado_conclusao_exige_servico/);
  });

  it('não registra execução em chamado já concluído', async () => {
    const id = await levarAteAndamento();
    await request(app)
      .patch(`/chamados/${id}/estado`)
      .set(auth(tecnico))
      .send({ estado: 'concluido', servico_realizado: 'Serviço concluído conforme o combinado.' });

    const resp = await request(app)
      .patch(`/chamados/${id}/execucao`)
      .set(auth(tecnico))
      .send({ diagnostico: 'Tardio demais.' });

    expect(resp.status).toBe(409);
  });
});

describe('Marcos temporais do §2.6 nos relatórios', () => {
  it('calcula tempo de triagem, até atendimento e de execução', async () => {
    const resp = await request(app).get('/relatorios/desempenho').set(auth(gestor));

    expect(resp.status).toBe(200);
    expect(resp.body.marcos.chamados_triados).toBeGreaterThanOrEqual(1);
    expect(resp.body.marcos.chamados_iniciados).toBeGreaterThanOrEqual(1);
    expect(Number(resp.body.marcos.tempo_triagem_segundos)).toBeGreaterThanOrEqual(0);
    expect(Number(resp.body.marcos.tempo_ate_atendimento_segundos)).toBeGreaterThanOrEqual(0);
    expect(Number(resp.body.marcos.tempo_execucao_segundos)).toBeGreaterThanOrEqual(0);
  });

  it('não confunde chamado sem execução com execução instantânea', async () => {
    // Um chamado que nunca entrou em andamento não pode entrar na média como
    // se tivesse levado zero: a contagem é sobre quem de fato começou.
    //
    // O chamado é recuado para um dia que só este teste usa, e o relatório é
    // pedido com esse recorte. Comparar a contagem global antes e depois
    // parecia mais direto, mas as suítes rodam em paralelo: bastava outra
    // iniciar a execução de um chamado entre as duas leituras para a asserção
    // falhar por um motivo que nada tem a ver com o que ela verifica.
    const DIA_SO_DESTE_TESTE = '2001-03-04';
    const id = await abrirEAtribuir();
    await pool.query(
      "UPDATE chamado SET data_abertura = $1::date + interval '10 hours' WHERE id = $2",
      [DIA_SO_DESTE_TESTE, id]
    );

    const resp = await request(app)
      .get(`/relatorios/desempenho?de=${DIA_SO_DESTE_TESTE}&ate=${DIA_SO_DESTE_TESTE}`)
      .set(auth(gestor));

    expect(resp.body.marcos.chamados_iniciados).toBe(0);
    // Nulo, e não zero: "ninguém começou" e "todos começaram na hora" são
    // respostas diferentes, e só uma delas é verdade aqui.
    expect(resp.body.marcos.tempo_ate_atendimento_segundos).toBeNull();
  });
});

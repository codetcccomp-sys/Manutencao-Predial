const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

const { ipDaSuite } = require('./apoio/ip');

// Ver tests/apoio/ip.js: cada suíte se apresenta ao login como um cliente
// distinto, para não dividir a cota por IP com as suítes que rodam em paralelo.
const IP = ipDaSuite(__filename);

let gestor;
let solicitante;
let outroSolicitante;
let tecnico;
let outroTecnico;
let localId;
let categoriaId;

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_com_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Com ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app)
    .post('/auth/login')
    .set('X-Real-IP', IP)
    .send({ email, senha: 'senha123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

const auth = (quem) => ({ Authorization: `Bearer ${quem.token}` });

async function abrir(titulo = 'Chamado para comentar') {
  const resp = await request(app).post('/chamados').set(auth(solicitante)).send({
    titulo,
    descricao: 'Descrição do problema relatado',
    categoria_id: categoriaId,
    local_id: localId,
  });
  return resp.body.chamado;
}

async function atribuir(chamadoId, quem = tecnico) {
  await request(app).patch(`/chamados/${chamadoId}/estado`).set(auth(gestor)).send({ estado: 'em_triagem' });
  await request(app)
    .patch(`/chamados/${chamadoId}/atribuir`)
    .set(auth(gestor))
    .send({ tecnico_id: quem.usuario.id });
}

const comentar = (chamadoId, quem, texto) =>
  request(app).post(`/chamados/${chamadoId}/comentarios`).set(auth(quem)).send({ texto });

async function avisosDe(chamadoId) {
  const { rows } = await pool.query(
    "SELECT usuario_id, mensagem FROM notificacao WHERE chamado_id = $1 AND tipo = 'comentario'",
    [chamadoId]
  );
  return rows;
}

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor');
  solicitante = await criarUsuarioELogar('solicitante');
  outroSolicitante = await criarUsuarioELogar('solicitante');
  tecnico = await criarUsuarioELogar('tecnico');
  outroTecnico = await criarUsuarioELogar('tecnico');

  const local = await pool.query("INSERT INTO local (unidade) VALUES ('Unidade Com') RETURNING id");
  const categoria = await pool.query('SELECT id FROM categoria LIMIT 1');
  localId = local.rows[0].id;
  categoriaId = categoria.rows[0].id;
});

afterAll(async () => {
  await pool.end();
});

describe('Comentários no chamado', () => {
  it('o solicitante comenta e o texto volta com autor e data', async () => {
    const chamado = await abrir();

    const resp = await comentar(chamado.id, solicitante, 'A infiltração piorou depois da chuva de ontem.');

    expect(resp.status).toBe(201);
    expect(resp.body.comentario.texto).toBe('A infiltração piorou depois da chuva de ontem.');
    expect(resp.body.comentario.usuario_nome).toBe(solicitante.usuario.nome);
    expect(resp.body.comentario.data).toBeDefined();
  });

  it('lista em ordem cronológica, com quem escreveu', async () => {
    const chamado = await abrir();
    await atribuir(chamado.id);

    await comentar(chamado.id, solicitante, 'Primeiro comentário, do solicitante.');
    await comentar(chamado.id, tecnico, 'Segundo comentário, do técnico.');

    const resp = await request(app).get(`/chamados/${chamado.id}/comentarios`).set(auth(tecnico));

    expect(resp.status).toBe(200);
    expect(resp.body.comentarios.map((c) => c.texto)).toEqual([
      'Primeiro comentário, do solicitante.',
      'Segundo comentário, do técnico.',
    ]);
    expect(resp.body.comentarios[1].usuario_perfil).toBe('tecnico');
  });

  it('recusa comentário vazio ou só com espaços', async () => {
    const chamado = await abrir();

    expect((await comentar(chamado.id, solicitante, '')).status).toBe(422);
    expect((await comentar(chamado.id, solicitante, '   ')).status).toBe(422);
  });

  it('guarda o texto sem espaços nas pontas', async () => {
    const chamado = await abrir();
    const resp = await comentar(chamado.id, solicitante, '   com espaços em volta   ');

    expect(resp.body.comentario.texto).toBe('com espaços em volta');
  });

  it('recusa texto acima do limite', async () => {
    const chamado = await abrir();
    const resp = await comentar(chamado.id, solicitante, 'a'.repeat(4001));

    expect(resp.status).toBe(422);
  });
});

describe('Quem pode comentar e ler (RN01)', () => {
  it('a gestão comenta em qualquer chamado', async () => {
    const chamado = await abrir();
    expect((await comentar(chamado.id, gestor, 'Vou verificar com a equipe hoje.')).status).toBe(201);
  });

  it('o técnico designado comenta', async () => {
    const chamado = await abrir();
    await atribuir(chamado.id);
    expect((await comentar(chamado.id, tecnico, 'Passo aí depois do almoço.')).status).toBe(201);
  });

  it('técnico de outro chamado não comenta nem lê', async () => {
    const chamado = await abrir();
    await atribuir(chamado.id);

    expect((await comentar(chamado.id, outroTecnico, 'Comentário indevido.')).status).toBe(403);

    const leitura = await request(app)
      .get(`/chamados/${chamado.id}/comentarios`)
      .set(auth(outroTecnico));
    expect(leitura.status).toBe(403);
  });

  it('solicitante não lê a conversa de chamado alheio', async () => {
    const chamado = await abrir();
    await comentar(chamado.id, solicitante, 'Detalhe que só interessa a este chamado.');

    const resp = await request(app)
      .get(`/chamados/${chamado.id}/comentarios`)
      .set(auth(outroSolicitante));

    // Mesma regra da leitura do chamado: a conversa não é uma porta lateral
    // para ver o que o perfil não alcança.
    expect(resp.status).toBe(403);
  });

  it('exige autenticação', async () => {
    const chamado = await abrir();
    expect((await request(app).get(`/chamados/${chamado.id}/comentarios`)).status).toBe(401);
  });
});

describe('RN03: o comentário é o canal depois da janela de edição', () => {
  it('o solicitante comenta mesmo sem poder mais editar', async () => {
    const chamado = await abrir();
    await atribuir(chamado.id);

    // A edição já está fechada...
    const edicao = await request(app)
      .patch(`/chamados/${chamado.id}`)
      .set(auth(solicitante))
      .send({ titulo: 'Tentativa tardia de edição' });
    expect(edicao.status).toBe(409);

    // ...mas o canal previsto pela RN03 continua aberto.
    const comentario = await comentar(
      chamado.id,
      solicitante,
      'Esqueci de dizer: o vazamento é no teto, não na parede.'
    );
    expect(comentario.status).toBe(201);
  });

  it('não comenta em chamado concluído', async () => {
    const chamado = await abrir();
    await atribuir(chamado.id);
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth(gestor)).send({ estado: 'em_andamento' });
    await request(app)
      .patch(`/chamados/${chamado.id}/estado`)
      .set(auth(gestor))
      .send({ estado: 'concluido', servico_realizado: 'Reparo executado e conferido no local.' });

    const resp = await comentar(chamado.id, solicitante, 'Continua vazando.');

    // Quem discorda do desfecho reabre, que tem janela e justificativa
    // próprias; comentar num chamado fechado criaria discussão sem dono.
    expect(resp.status).toBe(409);
    expect(resp.body.erro.codigo).toBe('CHAMADO_ENCERRADO');
  });

  it('não comenta em chamado cancelado', async () => {
    const chamado = await abrir();
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth(gestor)).send({ estado: 'cancelado' });

    expect((await comentar(chamado.id, solicitante, 'Por que cancelaram?')).status).toBe(409);
  });

  it('a conversa do chamado encerrado continua legível', async () => {
    const chamado = await abrir();
    await comentar(chamado.id, solicitante, 'Comentário feito antes do cancelamento.');
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth(gestor)).send({ estado: 'cancelado' });

    const resp = await request(app).get(`/chamados/${chamado.id}/comentarios`).set(auth(solicitante));

    // Fechar para escrita não é apagar: o registro do atendimento continua.
    expect(resp.status).toBe(200);
    expect(resp.body.comentarios).toHaveLength(1);
  });
});

describe('Aviso de comentário (RF08)', () => {
  it('avisa o técnico designado quando o solicitante comenta', async () => {
    const chamado = await abrir();
    await atribuir(chamado.id);

    await comentar(chamado.id, solicitante, 'O problema voltou hoje de manhã.');

    const destinatarios = (await avisosDe(chamado.id)).map((a) => a.usuario_id);
    expect(destinatarios).toContain(tecnico.usuario.id);
  });

  it('avisa o solicitante quando o técnico comenta', async () => {
    const chamado = await abrir();
    await atribuir(chamado.id);

    await comentar(chamado.id, tecnico, 'Preciso de acesso à sala para avaliar.');

    const destinatarios = (await avisosDe(chamado.id)).map((a) => a.usuario_id);
    expect(destinatarios).toContain(solicitante.usuario.id);
  });

  it('não avisa quem escreveu', async () => {
    const chamado = await abrir();
    await atribuir(chamado.id);

    await comentar(chamado.id, tecnico, 'Comentário do próprio técnico.');

    const destinatarios = (await avisosDe(chamado.id)).map((a) => a.usuario_id);
    expect(destinatarios).not.toContain(tecnico.usuario.id);
  });

  it('sem técnico designado, avisa a gestão, que é quem responde pelo chamado', async () => {
    const chamado = await abrir();

    await comentar(chamado.id, solicitante, 'Acrescentando uma foto do local na semana passada.');

    const destinatarios = (await avisosDe(chamado.id)).map((a) => a.usuario_id);
    expect(destinatarios).toContain(gestor.usuario.id);
  });

  it('a mensagem traz quem falou, o protocolo e uma prévia', async () => {
    const chamado = await abrir();
    await atribuir(chamado.id);
    await comentar(chamado.id, solicitante, 'Texto curto e específico.');

    const [aviso] = await avisosDe(chamado.id);
    expect(aviso.mensagem).toContain(solicitante.usuario.nome);
    expect(aviso.mensagem).toContain(chamado.protocolo);
    expect(aviso.mensagem).toContain('Texto curto e específico.');
  });

  it('corta a prévia de um comentário longo em vez de copiá-lo inteiro', async () => {
    const chamado = await abrir();
    await atribuir(chamado.id);
    const longo = 'Descrição bem detalhada do que aconteceu. '.repeat(20);

    await comentar(chamado.id, solicitante, longo);

    const [aviso] = await avisosDe(chamado.id);
    expect(aviso.mensagem.length).toBeLessThan(longo.length);
    expect(aviso.mensagem).toContain('...');
  });

  it('o aviso aparece na lista do destinatário', async () => {
    const chamado = await abrir();
    await atribuir(chamado.id);
    await comentar(chamado.id, solicitante, 'Comentário que deve virar aviso na tela.');

    const resp = await request(app).get('/notificacoes').set(auth(tecnico));
    const aviso = resp.body.notificacoes.find(
      (n) => n.tipo === 'comentario' && n.chamado_id === chamado.id
    );

    expect(aviso).toBeDefined();
    expect(aviso.lida).toBe(false);
  });
});

describe('O comentário não se confunde com o histórico', () => {
  it('comentar não cria entrada de mudança de estado', async () => {
    const chamado = await abrir();
    const antes = await pool.query(
      'SELECT count(*)::int AS total FROM historico_chamado WHERE chamado_id = $1',
      [chamado.id]
    );

    await comentar(chamado.id, solicitante, 'Comentário que não é transição de estado.');

    const depois = await pool.query(
      'SELECT count(*)::int AS total FROM historico_chamado WHERE chamado_id = $1',
      [chamado.id]
    );

    // O histórico registra transição; comentário não é transição. Misturar os
    // dois faria a auditoria de fluxo conviver com conversa.
    expect(depois.rows[0].total).toBe(antes.rows[0].total);
  });

  it('comentar não muda o estado nem o prazo do chamado', async () => {
    const chamado = await abrir();
    await comentar(chamado.id, solicitante, 'Comentário inofensivo ao fluxo.');

    const { rows } = await pool.query(
      'SELECT estado, prazo_estimado FROM chamado WHERE id = $1',
      [chamado.id]
    );
    expect(rows[0].estado).toBe('aberto');
    expect(new Date(rows[0].prazo_estimado).toISOString()).toBe(
      new Date(chamado.prazo_estimado).toISOString()
    );
  });
});

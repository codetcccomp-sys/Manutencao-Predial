const request = require('supertest');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const { conferirSegredo } = require('../src/middlewares/cron');
const { ORCAMENTO_AVISOS, MAXIMO_EMAILS } = require('../src/services/atrasos.service');

const { ipDaSuite } = require('./apoio/ip');

// Ver tests/apoio/ip.js: cada suíte se apresenta ao login como um cliente
// distinto, para não dividir a cota por IP com as suítes que rodam em paralelo.
const IP = ipDaSuite(__filename);

// O segredo precisa existir antes do app ser carregado? Não: o middleware lê
// process.env a cada requisição, de propósito, justamente para que o teste
// possa simular o ambiente sem a variável.
const SEGREDO = 'segredo-de-teste-do-agendador';
process.env.CRON_SECRET = SEGREDO;

const app = require('../src/app');

let gestor;
let solicitante;
let tecnico;
let localId;
let categoriaId;

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_atr_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Atr ${perfil}`, email, senha: 'senha123' });
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
const comoAgendador = () => ({ Authorization: `Bearer ${SEGREDO}` });

async function abrir(titulo = 'Chamado que vai atrasar') {
  const resp = await request(app).post('/chamados').set(auth(solicitante)).send({
    titulo,
    descricao: 'Descrição do problema relatado',
    categoria_id: categoriaId,
    local_id: localId,
  });
  return resp.body.chamado;
}

/**
 * Empurra o prazo para o passado, como se o relógio tivesse corrido.
 *
 * A data é remota de propósito. A varredura atende os mais vencidos primeiro
 * e leva um lote por vez, e o banco de teste acumula chamados vencidos das
 * outras suítes, que rodam em paralelo. Ancorando os chamados desta suíte em
 * 2002, eles ficam sempre à frente na fila e o teste não depende de quantos
 * vencidos alheios existem no momento.
 */
const EPOCA = '2002-01-01T00:00:00Z';
let deslocamento = 0;

async function vencer(id) {
  deslocamento += 1;
  await pool.query(
    `UPDATE chamado SET prazo_estimado = $1::timestamptz + ($2 * interval '1 second') WHERE id = $3`,
    [EPOCA, deslocamento, id]
  );
}

async function varrer() {
  return request(app).post('/tarefas/notificar-atrasos').set(comoAgendador());
}

async function avisosDe(chamadoId) {
  const { rows } = await pool.query(
    "SELECT usuario_id, mensagem FROM notificacao WHERE chamado_id = $1 AND tipo = 'atraso'",
    [chamadoId]
  );
  return rows;
}

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor');
  solicitante = await criarUsuarioELogar('solicitante');
  tecnico = await criarUsuarioELogar('tecnico');

  const categoria = await pool.query('SELECT id FROM categoria LIMIT 1');
  localId = await garantirLocal({ unidade: 'Unidade Atr' });
  categoriaId = categoria.rows[0].id;
});

afterAll(async () => {
  await pool.end();
});

describe('Autenticação do agendador', () => {
  it('recusa sem cabeçalho', async () => {
    const resp = await request(app).post('/tarefas/notificar-atrasos');
    expect(resp.status).toBe(401);
    expect(resp.body.erro.codigo).toBe('CRON_NAO_AUTORIZADO');
  });

  it('recusa segredo errado', async () => {
    const resp = await request(app)
      .post('/tarefas/notificar-atrasos')
      .set('Authorization', 'Bearer quase-o-segredo-de-teste-do-agendador');
    expect(resp.status).toBe(401);
  });

  it('recusa o segredo na query string', async () => {
    // Aceitar pela URL seria cômodo e vazaria o segredo em log de acesso,
    // histórico de proxy e Referer. Só o cabeçalho vale.
    const resp = await request(app).post(`/tarefas/notificar-atrasos?secret=${SEGREDO}`);
    expect(resp.status).toBe(401);
  });

  it('recusa token de usuário, mesmo de administrador', async () => {
    const admin = await criarUsuarioELogar('administrador');
    const resp = await request(app).post('/tarefas/notificar-atrasos').set(auth(admin));
    expect(resp.status).toBe(401);
  });

  it('sem CRON_SECRET no ambiente, a rota fica desligada em vez de aberta', async () => {
    const original = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const resp = await request(app).post('/tarefas/notificar-atrasos').set(comoAgendador());
      expect(resp.status).toBe(503);
      expect(resp.body.erro.codigo).toBe('CRON_SEM_SEGREDO');
    } finally {
      process.env.CRON_SECRET = original;
    }
  });

  it('aceita o segredo correto', async () => {
    const resp = await varrer();
    expect(resp.status).toBe(200);
  });
});

describe('Comparação do segredo (função pura)', () => {
  it('aceita igual e recusa diferente', () => {
    expect(conferirSegredo('abc', 'abc')).toBe(true);
    expect(conferirSegredo('abc', 'abd')).toBe(false);
  });

  it('não estoura com tamanhos diferentes', () => {
    // timingSafeEqual exige mesmo comprimento; comparar o digest é o que
    // evita que o tamanho do segredo vaze por uma exceção.
    expect(() => conferirSegredo('a', 'segredo bem mais longo')).not.toThrow();
    expect(conferirSegredo('a', 'segredo bem mais longo')).toBe(false);
  });

  it('recusa vazio contra vazio informado por engano', () => {
    expect(conferirSegredo('', 'segredo')).toBe(false);
  });
});

describe('Aviso de atraso (RF08)', () => {
  it('avisa o solicitante quando o prazo estoura', async () => {
    const chamado = await abrir();
    await vencer(chamado.id);

    const resp = await varrer();
    expect(resp.status).toBe(200);
    expect(resp.body.protocolos).toContain(chamado.protocolo);

    const avisos = await avisosDe(chamado.id);
    expect(avisos.map((a) => a.usuario_id)).toContain(solicitante.usuario.id);
    expect(avisos[0].mensagem).toContain(chamado.protocolo);
    expect(avisos[0].mensagem).toMatch(/passou do prazo em \d+ horas?/);
  });

  it('mostra o prazo no fuso local, não em UTC', async () => {
    const chamado = await abrir();
    // 20:00 UTC = 17:00 em Brasília. O servidor roda em UTC e esta mensagem
    // vai por e-mail como texto fixo: sem fuso explícito o prazo chegaria três
    // horas adiantado para quem lê, sem nada acusar.
    //
    // Junho de propósito: o Brasil teve horário de verão até 2019, e uma data
    // de janeiro daria UTC-2, não UTC-3 — a primeira versão deste teste
    // acusou o código por causa disso, e o errado era o teste.
    //
    // Data anterior à EPOCA da suíte para o chamado encabeçar a fila: a
    // varredura atende os mais vencidos primeiro, e o lote é pequeno.
    await pool.query(
      "UPDATE chamado SET prazo_estimado = timestamptz '2001-06-15 20:00:00Z' WHERE id = $1",
      [chamado.id]
    );
    await varrer();

    const [aviso] = await avisosDe(chamado.id);
    expect(aviso.mensagem).toContain('15/06/2001, 17:00:00');
  });

  it('não avisa duas vezes pelo mesmo prazo', async () => {
    const chamado = await abrir();
    await vencer(chamado.id);

    await varrer();
    const depoisDaPrimeira = await avisosDe(chamado.id);

    await varrer();
    await varrer();
    const depoisDeTres = await avisosDe(chamado.id);

    // O agendador roda a cada 15 minutos: sem isso, um chamado atrasado
    // geraria 96 e-mails por dia para a mesma pessoa.
    expect(depoisDeTres).toHaveLength(depoisDaPrimeira.length);
  });

  it('volta a avisar quando o prazo muda e estoura de novo', async () => {
    const chamado = await abrir();
    await vencer(chamado.id);
    await varrer();
    const primeira = await avisosDe(chamado.id);

    // Repriorizar move o prazo: o estouro seguinte é outro descumprimento,
    // não a repetição do mesmo.
    await vencer(chamado.id);
    await varrer();

    expect((await avisosDe(chamado.id)).length).toBeGreaterThan(primeira.length);
  });

  it('não avisa chamado dentro do prazo', async () => {
    const chamado = await abrir();
    await varrer();
    expect(await avisosDe(chamado.id)).toHaveLength(0);
  });

  it('não avisa chamado concluído, mesmo com prazo vencido', async () => {
    const chamado = await abrir();
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth(gestor)).send({ estado: 'em_triagem' });
    await request(app)
      .patch(`/chamados/${chamado.id}/atribuir`)
      .set(auth(gestor))
      .send({ tecnico_id: tecnico.usuario.id });
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth(gestor)).send({ estado: 'em_andamento' });
    await request(app)
      .patch(`/chamados/${chamado.id}/estado`)
      .set(auth(gestor))
      .send({ estado: 'concluido', servico_realizado: 'Serviço executado e conferido no local.' });

    await vencer(chamado.id);
    await varrer();

    // O prazo de um chamado fechado é história, não pendência.
    expect(await avisosDe(chamado.id)).toHaveLength(0);
  });

  it('não avisa chamado cancelado', async () => {
    const chamado = await abrir();
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth(gestor)).send({ estado: 'cancelado' });
    await vencer(chamado.id);
    await varrer();

    expect(await avisosDe(chamado.id)).toHaveLength(0);
  });

  it('avisa o técnico designado, além do solicitante', async () => {
    const chamado = await abrir();
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth(gestor)).send({ estado: 'em_triagem' });
    await request(app)
      .patch(`/chamados/${chamado.id}/atribuir`)
      .set(auth(gestor))
      .send({ tecnico_id: tecnico.usuario.id });

    await vencer(chamado.id);
    await varrer();

    const destinatarios = (await avisosDe(chamado.id)).map((a) => a.usuario_id);
    expect(destinatarios).toContain(solicitante.usuario.id);
    expect(destinatarios).toContain(tecnico.usuario.id);
  });

  it('sem técnico designado, avisa a gestão, que é quem pode agir', async () => {
    const chamado = await abrir();
    await vencer(chamado.id);
    await varrer();

    const destinatarios = (await avisosDe(chamado.id)).map((a) => a.usuario_id);
    expect(destinatarios).toContain(gestor.usuario.id);
  });

  it('com técnico designado, não inunda a gestão', async () => {
    const chamado = await abrir();
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth(gestor)).send({ estado: 'em_triagem' });
    await request(app)
      .patch(`/chamados/${chamado.id}/atribuir`)
      .set(auth(gestor))
      .send({ tecnico_id: tecnico.usuario.id });

    await vencer(chamado.id);
    await varrer();

    const destinatarios = (await avisosDe(chamado.id)).map((a) => a.usuario_id);
    expect(destinatarios).not.toContain(gestor.usuario.id);
    expect(destinatarios).toHaveLength(2);
  });

  it('o aviso aparece na lista do próprio usuário', async () => {
    const chamado = await abrir();
    await vencer(chamado.id);
    await varrer();

    const resp = await request(app).get('/notificacoes').set(auth(solicitante));
    const aviso = resp.body.notificacoes.find(
      (n) => n.tipo === 'atraso' && n.protocolo === chamado.protocolo
    );

    // Sem SMTP configurado, a lista interna é o único canal que sobra — e a
    // RF08 prevê exatamente os dois.
    expect(aviso).toBeDefined();
    expect(aviso.lida).toBe(false);
  });

  it('duas varreduras simultâneas não duplicam o aviso', async () => {
    const chamado = await abrir();
    await vencer(chamado.id);

    // É o cenário real do agendador externo: um disparo atrasa, o seguinte
    // entra por cima. Sem reivindicação atômica, os dois avisariam.
    await Promise.all([varrer(), varrer(), varrer()]);

    const porUsuario = {};
    for (const aviso of await avisosDe(chamado.id)) {
      porUsuario[aviso.usuario_id] = (porUsuario[aviso.usuario_id] || 0) + 1;
    }
    expect(Object.values(porUsuario).every((n) => n === 1)).toBe(true);
  });

  it('a varredura devolve o que fez, para o agendador não ficar no escuro', async () => {
    const chamado = await abrir();
    await vencer(chamado.id);

    const resp = await varrer();
    expect(resp.body.chamados_notificados).toBeGreaterThanOrEqual(1);
    expect(resp.body.avisos_gerados).toBeGreaterThanOrEqual(1);
    expect(typeof resp.body.havia_mais).toBe('boolean');
  });

  it('a segunda varredura não reprocessa o que a primeira já avisou', async () => {
    const chamado = await abrir();
    await vencer(chamado.id);

    await varrer();
    const segunda = await varrer();

    // Asserção sobre este chamado, e não sobre o total: a varredura é global
    // por natureza e as suítes rodam em paralelo, então "a segunda devolve
    // zero" falharia sempre que outra suíte vencesse um chamado no meio.
    expect(segunda.status).toBe(200);
    expect(segunda.body.protocolos).not.toContain(chamado.protocolo);
  });

  it('o diagnóstico enxerga o vencido que ainda não foi avisado', async () => {
    await varrer();
    const antes = await request(app).get('/tarefas/atrasos-pendentes').set(comoAgendador());

    const chamado = await abrir();
    await vencer(chamado.id);

    const depois = await request(app).get('/tarefas/atrasos-pendentes').set(comoAgendador());
    expect(depois.body.pendentes).toBeGreaterThan(antes.body.pendentes);
  });

  it('o lote encolhe conforme o tamanho da gestão, para o alcance não explodir', async () => {
    // O alcance é chamados × destinatários. Sem teto, uma instituição com
    // dezenas de gestores geraria milhares de avisos numa transação só,
    // dentro de uma função com limite de tempo.
    const { rows } = await pool.query(
      "SELECT count(*)::int AS total FROM usuario WHERE perfil IN ('administrador','gestor') AND ativo"
    );
    const gestores = rows[0].total;

    const chamado = await abrir();
    await vencer(chamado.id);
    const resp = await varrer();

    expect(resp.body.avisos_gerados).toBeLessThanOrEqual(ORCAMENTO_AVISOS + gestores);
    expect(resp.body.emails_tentados).toBeLessThanOrEqual(MAXIMO_EMAILS);
  });
});

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

let gestor;
let tecnico;
let solicitante;
let localId;
let categoriaId;

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_sla_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `SLA ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').send({ email, senha: 'senha123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

async function abrir(prioridade) {
  const resp = await request(app)
    .post('/chamados')
    .set('Authorization', `Bearer ${solicitante.token}`)
    .send({
      titulo: `Chamado ${prioridade}`,
      descricao: 'Descrição do chamado de SLA',
      categoria_id: categoriaId,
      local_id: localId,
      ...(prioridade ? { prioridade } : {}),
    });
  return resp.body.chamado;
}

const comoGestor = () => ({ Authorization: `Bearer ${gestor.token}` });

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor');
  tecnico = await criarUsuarioELogar('tecnico');
  solicitante = await criarUsuarioELogar('solicitante');

  const local = await pool.query("INSERT INTO local (unidade) VALUES ('Unidade SLA') RETURNING id");
  const categoria = await pool.query('SELECT id FROM categoria LIMIT 1');
  localId = local.rows[0].id;
  categoriaId = categoria.rows[0].id;
});

afterAll(async () => {
  await pool.end();
});

describe('Prazo na abertura do chamado', () => {
  it('define prazo a partir da prioridade', async () => {
    const critico = await abrir('critica');
    const baixo = await abrir('baixa');

    expect(critico.prazo_estimado).not.toBeNull();
    expect(baixo.prazo_estimado).not.toBeNull();

    const horas = (c) =>
      (new Date(c.prazo_estimado) - new Date(c.data_abertura)) / 3_600_000;

    // Os valores semeados pela migração: crítica 4h, baixa 168h.
    expect(horas(critico)).toBeCloseTo(4, 1);
    expect(horas(baixo)).toBeCloseTo(168, 1);
  });

  it('usa o prazo de "baixa" quando a prioridade é omitida', async () => {
    const semPrioridade = await abrir(null);
    expect(semPrioridade.prioridade).toBe('baixa');

    const horas =
      (new Date(semPrioridade.prazo_estimado) - new Date(semPrioridade.data_abertura)) / 3_600_000;
    expect(horas).toBeCloseTo(168, 1);
  });

  it('abre o chamado mesmo sem prazo configurado para a prioridade', async () => {
    // A parametrização faltando não pode impedir alguém de registrar um
    // problema; o chamado nasce sem prazo e fica de fora da apuração.
    await pool.query("DELETE FROM sla WHERE prioridade = 'alta'");
    try {
      const chamado = await abrir('alta');
      expect(chamado.id).toBeDefined();
      expect(chamado.prazo_estimado).toBeNull();
    } finally {
      await pool.query("INSERT INTO sla (prioridade, prazo_horas) VALUES ('alta', 24)");
    }
  });
});

describe('Atraso', () => {
  it('marca em_atraso quando o prazo passou e o chamado segue aberto', async () => {
    const chamado = await abrir('critica');
    await pool.query("UPDATE chamado SET prazo_estimado = now() - interval '1 hour' WHERE id = $1", [
      chamado.id,
    ]);

    const detalhe = await request(app)
      .get(`/chamados/${chamado.id}`)
      .set('Authorization', `Bearer ${solicitante.token}`);
    expect(detalhe.body.chamado.em_atraso).toBe(true);
  });

  it('deixa de contar como atraso quando o chamado é concluído', async () => {
    const chamado = await abrir('critica');
    await pool.query("UPDATE chamado SET prazo_estimado = now() - interval '1 hour' WHERE id = $1", [
      chamado.id,
    ]);

    const caminho = ['em_triagem', 'em_andamento', 'concluido'];
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(comoGestor()).send({ estado: caminho[0] });
    await request(app)
      .patch(`/chamados/${chamado.id}/atribuir`)
      .set(comoGestor())
      .send({ tecnico_id: tecnico.usuario.id });
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(comoGestor()).send({ estado: caminho[1] });
    await request(app)
      .patch(`/chamados/${chamado.id}/estado`)
      .set(comoGestor())
      .send({ estado: caminho[2], servico_realizado: 'Servico executado e registrado conforme o combinado.' });

    const detalhe = await request(app)
      .get(`/chamados/${chamado.id}`)
      .set('Authorization', `Bearer ${solicitante.token}`);
    expect(detalhe.body.chamado.em_atraso).toBe(false);
  });

  it('filtra a listagem por atrasados', async () => {
    const atrasado = await abrir('critica');
    await pool.query("UPDATE chamado SET prazo_estimado = now() - interval '1 hour' WHERE id = $1", [
      atrasado.id,
    ]);

    const resp = await request(app)
      .get('/chamados?atrasados=true&limite=100')
      .set('Authorization', `Bearer ${solicitante.token}`);

    const ids = resp.body.chamados.map((c) => c.id);
    expect(ids).toContain(atrasado.id);
    expect(resp.body.chamados.every((c) => c.em_atraso === true)).toBe(true);
  });
});

describe('Suspensão por falta de material', () => {
  it('empurra o prazo pelo tempo que o chamado ficou aguardando material', async () => {
    const chamado = await abrir('baixa');

    await request(app).patch(`/chamados/${chamado.id}/estado`).set(comoGestor()).send({ estado: 'em_triagem' });
    await request(app)
      .patch(`/chamados/${chamado.id}/atribuir`)
      .set(comoGestor())
      .send({ tecnico_id: tecnico.usuario.id });
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(comoGestor()).send({ estado: 'em_andamento' });
    await request(app)
      .patch(`/chamados/${chamado.id}/estado`)
      .set(comoGestor())
      .send({ estado: 'aguardando_material' });

    const antes = await pool.query('SELECT prazo_estimado FROM chamado WHERE id = $1', [chamado.id]);

    // Finge que a espera por material durou 10 horas.
    await pool.query(
      "UPDATE chamado SET aguardando_material_desde = now() - interval '10 hours' WHERE id = $1",
      [chamado.id]
    );

    await request(app).patch(`/chamados/${chamado.id}/estado`).set(comoGestor()).send({ estado: 'em_andamento' });

    const depois = await pool.query(
      'SELECT prazo_estimado, tempo_suspenso_total FROM chamado WHERE id = $1',
      [chamado.id]
    );

    const deslocamentoHoras =
      (new Date(depois.rows[0].prazo_estimado) - new Date(antes.rows[0].prazo_estimado)) / 3_600_000;

    // O prazo tem de andar exatamente o mesmo tanto que o tempo suspenso:
    // descontar a espera da métrica de atendimento e ainda assim deixar o
    // relógio do prazo correndo cobraria duas coisas incoerentes.
    expect(deslocamentoHoras).toBeCloseTo(10, 1);
    expect(depois.rows[0].tempo_suspenso_total.hours).toBe(10);
  });
});

describe('Configuração do SLA', () => {
  it('qualquer autenticado lê os prazos', async () => {
    const resp = await request(app)
      .get('/sla')
      .set('Authorization', `Bearer ${solicitante.token}`);

    expect(resp.status).toBe(200);
    expect(resp.body.sla.map((s) => s.prioridade)).toEqual(['critica', 'alta', 'media', 'baixa']);
  });

  it('gestor altera o prazo e o chamado seguinte já nasce com ele', async () => {
    const alterado = await request(app)
      .patch('/sla/media')
      .set(comoGestor())
      .send({ prazo_horas: 12 });
    expect(alterado.status).toBe(200);
    expect(alterado.body.sla.prazo_horas).toBe(12);

    const chamado = await abrir('media');
    const horas = (new Date(chamado.prazo_estimado) - new Date(chamado.data_abertura)) / 3_600_000;
    expect(horas).toBeCloseTo(12, 1);

    await request(app).patch('/sla/media').set(comoGestor()).send({ prazo_horas: 72 });
  });

  it('solicitante não altera prazo', async () => {
    const resp = await request(app)
      .patch('/sla/alta')
      .set('Authorization', `Bearer ${solicitante.token}`)
      .send({ prazo_horas: 1 });
    expect(resp.status).toBe(403);
  });

  it('recusa prazo fora da faixa', async () => {
    for (const prazo of [0, -5, 9000]) {
      const resp = await request(app).patch('/sla/alta').set(comoGestor()).send({ prazo_horas: prazo });
      expect(resp.status).toBe(422);
    }
  });
});

describe('Cumprimento de prazo nos relatórios', () => {
  it('informa percentual dos concluídos no prazo e quantos abertos estouraram', async () => {
    const resp = await request(app).get('/relatorios/desempenho').set(comoGestor());

    expect(resp.status).toBe(200);
    expect(resp.body.prazo.concluidos_com_prazo).toBeGreaterThanOrEqual(1);
    expect(resp.body.prazo.percentual_no_prazo).toBeGreaterThanOrEqual(0);
    expect(resp.body.prazo.percentual_no_prazo).toBeLessThanOrEqual(100);
    expect(resp.body.prazo.em_aberto_atrasados).toBeGreaterThanOrEqual(1);
  });

  it('devolve percentual nulo, e não zero, quando não há concluído com prazo', async () => {
    // Zero sugeriria que tudo atrasou; nulo diz que não há o que medir.
    const resp = await request(app).get('/relatorios/desempenho?de=2099-01-01').set(comoGestor());
    expect(resp.body.prazo.percentual_no_prazo).toBeNull();
  });
});

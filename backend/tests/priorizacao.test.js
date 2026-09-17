const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { calcular } = require('../src/services/priorizacao.service');

let gestor;
let solicitante;
let localId;
let categoriaId;

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_pri_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Pri ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').send({ email, senha: 'senha123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

async function abrir() {
  const resp = await request(app)
    .post('/chamados')
    .set('Authorization', `Bearer ${solicitante.token}`)
    .send({
      titulo: 'Chamado para priorizar',
      descricao: 'Descrição do problema relatado',
      categoria_id: categoriaId,
      local_id: localId,
    });
  return resp.body.chamado;
}

const comoGestor = () => ({ Authorization: `Bearer ${gestor.token}` });

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor');
  solicitante = await criarUsuarioELogar('solicitante');

  const local = await pool.query("INSERT INTO local (unidade) VALUES ('Unidade Pri') RETURNING id");
  const categoria = await pool.query('SELECT id FROM categoria LIMIT 1');
  localId = local.rows[0].id;
  categoriaId = categoria.rows[0].id;
});

afterAll(async () => {
  await pool.end();
});

// Regra v1 semeada pela migração: pesos 1/1/1, limiares 6/8/10, risco crítico 4.
const REGRA_V1 = {
  versao: 'v1',
  peso_urgencia: 1,
  peso_impacto: 1,
  peso_risco: 1,
  limiar_media: 6,
  limiar_alta: 8,
  limiar_critica: 10,
  risco_critico_minimo: 4,
};

describe('Cálculo da prioridade (função pura)', () => {
  it.each([
    [{ urgencia: 1, impacto: 1, risco: 1 }, 'baixa', 3],
    [{ urgencia: 2, impacto: 2, risco: 1 }, 'baixa', 5],
    [{ urgencia: 2, impacto: 2, risco: 2 }, 'media', 6],
    [{ urgencia: 3, impacto: 3, risco: 2 }, 'alta', 8],
    [{ urgencia: 4, impacto: 3, risco: 3 }, 'critica', 10],
  ])('%o resulta em %s com pontuação %i', (fatores, esperado, pontuacao) => {
    const r = calcular(fatores, REGRA_V1);
    expect(r.pontuacao).toBe(pontuacao);
    expect(r.prioridade).toBe(esperado);
  });

  it('RN04: risco grave impõe crítica mesmo com pontuação baixa', () => {
    // 1+1+4 = 6, que sozinho daria "media". A regra de exceção prevalece.
    const r = calcular({ urgencia: 1, impacto: 1, risco: 4 }, REGRA_V1);
    expect(r.pontuacao).toBe(6);
    expect(r.prioridade).toBe('critica');
    expect(r.motivo).toMatch(/RN04/);
  });

  it('respeita pesos diferentes', () => {
    const comPesoNoRisco = { ...REGRA_V1, peso_risco: 3, risco_critico_minimo: 4 };
    // 1 + 1 + 3*3 = 11 -> critica pelo limiar, sem acionar a RN04.
    const r = calcular({ urgencia: 1, impacto: 1, risco: 3 }, comPesoNoRisco);
    expect(r.pontuacao).toBe(11);
    expect(r.prioridade).toBe('critica');
    expect(r.motivo).not.toMatch(/RN04/);
  });
});

describe('PATCH /chamados/:id/priorizacao', () => {
  it('registra os fatores e aplica a prioridade sugerida', async () => {
    const chamado = await abrir();

    const resp = await request(app)
      .patch(`/chamados/${chamado.id}/priorizacao`)
      .set(comoGestor())
      .send({ urgencia: 3, impacto: 3, risco: 2 });

    expect(resp.status).toBe(200);
    expect(resp.body.sugestao.prioridade).toBe('alta');
    expect(resp.body.chamado.prioridade).toBe('alta');
    expect(resp.body.chamado.prioridade_sugerida).toBe('alta');
    expect(resp.body.chamado.urgencia).toBe(3);
    expect(resp.body.chamado.prioridade_justificativa).toBeNull();
    expect(resp.body.chamado.regra_priorizacao_id).toBeDefined();
  });

  it('recalcula o prazo conforme a nova prioridade', async () => {
    const chamado = await abrir();
    // Nasce "baixa": 168h.
    const horasIniciais =
      (new Date(chamado.prazo_estimado) - new Date(chamado.data_abertura)) / 3_600_000;
    expect(horasIniciais).toBeCloseTo(168, 1);

    const resp = await request(app)
      .patch(`/chamados/${chamado.id}/priorizacao`)
      .set(comoGestor())
      .send({ urgencia: 4, impacto: 4, risco: 3 });

    expect(resp.body.chamado.prioridade).toBe('critica');
    const horasDepois =
      (new Date(resp.body.chamado.prazo_estimado) - new Date(resp.body.chamado.data_abertura)) /
      3_600_000;
    // Crítica: 4h. Um chamado crítico com o relógio de um "baixa" seria
    // classificação sem consequência.
    expect(horasDepois).toBeCloseTo(4, 1);
  });

  it('exige justificativa quando o gestor diverge da sugestão', async () => {
    const chamado = await abrir();

    const semJustificativa = await request(app)
      .patch(`/chamados/${chamado.id}/priorizacao`)
      .set(comoGestor())
      .send({ urgencia: 1, impacto: 1, risco: 1, prioridade: 'critica' });

    expect(semJustificativa.status).toBe(422);
    expect(semJustificativa.body.erro.codigo).toBe('JUSTIFICATIVA_OBRIGATORIA');

    const curta = await request(app)
      .patch(`/chamados/${chamado.id}/priorizacao`)
      .set(comoGestor())
      .send({ urgencia: 1, impacto: 1, risco: 1, prioridade: 'critica', justificativa: 'porque' });
    expect(curta.status).toBe(422);

    const comJustificativa = await request(app)
      .patch(`/chamados/${chamado.id}/priorizacao`)
      .set(comoGestor())
      .send({
        urgencia: 1,
        impacto: 1,
        risco: 1,
        prioridade: 'critica',
        justificativa: 'Reitor em visita ao bloco amanhã; direção pediu tratamento imediato.',
      });

    expect(comJustificativa.status).toBe(200);
    expect(comJustificativa.body.chamado.prioridade).toBe('critica');
    expect(comJustificativa.body.chamado.prioridade_sugerida).toBe('baixa');
    expect(comJustificativa.body.chamado.prioridade_justificativa).toMatch(/Reitor/);
  });

  it('grava a decisão no histórico do chamado', async () => {
    const chamado = await abrir();
    await request(app)
      .patch(`/chamados/${chamado.id}/priorizacao`)
      .set(comoGestor())
      .send({ urgencia: 1, impacto: 1, risco: 4 });

    const detalhe = await request(app)
      .get(`/chamados/${chamado.id}`)
      .set('Authorization', `Bearer ${solicitante.token}`);

    const entrada = detalhe.body.chamado.historico.find((h) => /Priorização/.test(h.observacao || ''));
    expect(entrada).toBeDefined();
    expect(entrada.observacao).toMatch(/RN04/);
  });

  it('solicitante não prioriza', async () => {
    const chamado = await abrir();
    const resp = await request(app)
      .patch(`/chamados/${chamado.id}/priorizacao`)
      .set('Authorization', `Bearer ${solicitante.token}`)
      .send({ urgencia: 1, impacto: 1, risco: 1 });

    expect(resp.status).toBe(403);
  });

  it('recusa fator fora da escala de 1 a 4', async () => {
    const chamado = await abrir();
    for (const fatores of [
      { urgencia: 0, impacto: 1, risco: 1 },
      { urgencia: 1, impacto: 5, risco: 1 },
    ]) {
      const resp = await request(app)
        .patch(`/chamados/${chamado.id}/priorizacao`)
        .set(comoGestor())
        .send(fatores);
      expect(resp.status).toBe(422);
    }
  });

  it('não repriortiza chamado concluído', async () => {
    const chamado = await abrir();
    const auth = comoGestor();
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth).send({ estado: 'em_triagem' });
    await request(app)
      .patch(`/chamados/${chamado.id}/atribuir`)
      .set(auth)
      .send({ tecnico_id: gestor.usuario.id });
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth).send({ estado: 'em_andamento' });
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth).send({ estado: 'concluido' });

    const resp = await request(app)
      .patch(`/chamados/${chamado.id}/priorizacao`)
      .set(auth)
      .send({ urgencia: 4, impacto: 4, risco: 4 });

    expect(resp.status).toBe(409);
  });
});

describe('Simulação', () => {
  it('devolve a sugestão sem gravar nada', async () => {
    const resp = await request(app)
      .post('/regras-priorizacao/simular')
      .set(comoGestor())
      .send({ urgencia: 4, impacto: 4, risco: 3 });

    expect(resp.status).toBe(200);
    expect(resp.body.prioridade).toBe('critica');
    expect(resp.body.pontuacao).toBe(11);
    expect(resp.body.regra.versao).toBe('v1');
  });
});

describe('Versionamento da regra (RN12)', () => {
  it('publicar nova versão encerra a vigência da anterior', async () => {
    const admin = await criarUsuarioELogar('administrador');

    const nova = await request(app)
      .post('/regras-priorizacao')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        versao: `v${Date.now()}`,
        peso_urgencia: 2,
        peso_impacto: 1,
        peso_risco: 3,
        limiar_media: 10,
        limiar_alta: 14,
        limiar_critica: 18,
        risco_critico_minimo: 4,
        observacao: 'Calibração após validação com a equipe de manutenção.',
      });

    expect(nova.status).toBe(201);
    expect(nova.body.regra.vigencia_fim).toBeNull();

    const { rows } = await pool.query(
      'SELECT count(*)::int AS vigentes FROM regra_priorizacao WHERE vigencia_fim IS NULL'
    );
    // O índice único garante que só uma regra fica sem data de encerramento.
    expect(rows[0].vigentes).toBe(1);

    const anteriores = await pool.query(
      "SELECT vigencia_fim FROM regra_priorizacao WHERE versao = 'v1'"
    );
    expect(anteriores.rows[0].vigencia_fim).not.toBeNull();
  });

  it('chamado priorizado antes guarda a versão que o classificou', async () => {
    const { rows } = await pool.query(
      `SELECT c.regra_priorizacao_id, r.versao
         FROM chamado c JOIN regra_priorizacao r ON r.id = c.regra_priorizacao_id
        WHERE c.regra_priorizacao_id IS NOT NULL
        ORDER BY c.id LIMIT 1`
    );
    // A versão antiga continua existindo para explicar a decisão tomada sob
    // uma calibração que já não vale.
    expect(rows[0].versao).toBe('v1');
  });

  it('recusa limiares fora de ordem', async () => {
    const admin = await criarUsuarioELogar('administrador');
    const resp = await request(app)
      .post('/regras-priorizacao')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        versao: `ruim${Date.now()}`,
        peso_urgencia: 1,
        peso_impacto: 1,
        peso_risco: 1,
        limiar_media: 10,
        limiar_alta: 8,
        limiar_critica: 6,
        risco_critico_minimo: 4,
      });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('LIMIARES_INVALIDOS');
  });

  it('gestor não publica versão nova; administrador sim', async () => {
    const resp = await request(app)
      .post('/regras-priorizacao')
      .set(comoGestor())
      .send({
        versao: `v${Date.now()}x`,
        peso_urgencia: 1,
        peso_impacto: 1,
        peso_risco: 1,
        limiar_media: 6,
        limiar_alta: 8,
        limiar_critica: 10,
        risco_critico_minimo: 4,
      });

    expect(resp.status).toBe(403);
  });
});

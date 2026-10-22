const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const { apagarChamados } = require('./apoio/limpeza');
const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);

/**
 * A prioridade com que o chamado nasce (RF04).
 *
 * O formulário mandava a prioridade e ela valia, com "baixa" já marcada: quem não mexia
 * no campo (um elevador parado, aberto às pressas) esperava o prazo da "baixa" sem disparar o
 * alerta de 15 minutos, e quem marcava "crítica" para tudo saturava esse mesmo alerta.
 * Agora o solicitante responde sobre a situação (urgência, impacto e risco) e o servidor
 * calcula com a regra vigente, como a gestão faz na triagem.
 *
 * Os valores abaixo supõem a regra v1: pesos 1, 1, 1; média a partir de 6, alta de 8,
 * crítica de 10; e risco 4 impõe crítica (RN04).
 */

const MARCA = `prio${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

let gestor;
let admin;
let solicitante;
let localId;
let categoriaId;
const criados = { chamados: [], equipes: [], categorias: [], regras: [] };

async function conta(perfil) {
  const email = `${MARCA}_${perfil}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Prio ${perfil}`, email, senha: 'senha-teste-123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app)
    .post('/auth/login')
    .set('X-Real-IP', `${IP}-${Math.random()}`)
    .send({ email, senha: 'senha-teste-123' });
  return { ...login.body.usuario, token: login.body.token };
}

const como = (quem) => ({ Authorization: `Bearer ${quem.token}` });

async function abrir(extra = {}, quem = solicitante, categoria = categoriaId) {
  const resp = await request(app)
    .post('/chamados')
    .set(como(quem))
    .send({ titulo: `${MARCA} chamado`, descricao: 'Elevador parado no térreo.', categoria_id: categoria, local_id: localId, ...extra });
  if (resp.body.chamado) criados.chamados.push(resp.body.chamado.id);
  return resp;
}

/** Garante a v1 como a regra vigente, como faz a suíte de priorização. */
async function restaurarV1() {
  await pool.query("UPDATE regra_priorizacao SET vigencia_fim = now() WHERE versao <> 'v1' AND vigencia_fim IS NULL");
  await pool.query("UPDATE regra_priorizacao SET vigencia_fim = NULL WHERE versao = 'v1'");
}

beforeAll(async () => {
  await restaurarV1();
  gestor = await conta('gestor');
  admin = await conta('administrador');
  solicitante = await conta('solicitante');
  localId = await garantirLocal({ unidade: `Unidade ${MARCA}` });
  categoriaId = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
});

afterAll(async () => {
  await restaurarV1();
  const client = await pool.connect();
  try {
    await apagarChamados(client, criados.chamados);
    await client.query('DELETE FROM regra_distribuicao WHERE id = ANY($1::int[])', [criados.regras]);
    await client.query('DELETE FROM equipe_tecnico WHERE equipe_id = ANY($1::int[])', [criados.equipes]);
    await client.query('DELETE FROM equipe WHERE id = ANY($1::int[])', [criados.equipes]);
    await client.query('DELETE FROM categoria WHERE id = ANY($1::int[])', [criados.categorias]);
  } finally {
    client.release();
  }
  await pool.end();
});

describe('O servidor calcula pela situação', () => {
  it('urgência, impacto e risco altos nascem críticos, com o prazo da crítica e a conta guardada', async () => {
    const resp = await abrir({ urgencia: 4, impacto: 4, risco: 2 });

    expect(resp.status).toBe(201);
    const c = resp.body.chamado;
    expect(c).toMatchObject({ prioridade: 'critica', urgencia: 4, impacto: 4, risco: 2, prioridade_sugerida: 'critica' });
    expect(c.regra_priorizacao_id).not.toBeNull();
    // Priorizado pelo sistema, não pela gestão: a tela não mostra "última priorização".
    expect(c.priorizado_em).toBeNull();
    expect(c.priorizado_por).toBeNull();

    const { rows } = await pool.query(
      `SELECT prazo_estimado = prazo_sla('critica', data_abertura, interval '0', interval '0', 'America/Sao_Paulo') AS confere
         FROM chamado WHERE id = $1`,
      [c.id]
    );
    expect(rows[0].confere).toBe(true);
  });

  it('risco máximo impõe crítica mesmo com o resto baixo (RN04)', async () => {
    const resp = await abrir({ urgencia: 1, impacto: 1, risco: 4 });
    expect(resp.body.chamado.prioridade).toBe('critica');
  });

  it('as faixas da regra: baixa, média e alta', async () => {
    expect((await abrir({ urgencia: 1, impacto: 1, risco: 1 })).body.chamado.prioridade).toBe('baixa');
    expect((await abrir({ urgencia: 2, impacto: 2, risco: 1 })).body.chamado.prioridade).toBe('baixa');
    expect((await abrir({ urgencia: 2, impacto: 2, risco: 2 })).body.chamado.prioridade).toBe('media');
    expect((await abrir({ urgencia: 3, impacto: 3, risco: 2 })).body.chamado.prioridade).toBe('alta');
  });

  it('o histórico diz por que a prioridade nasceu assim', async () => {
    const resp = await abrir({ urgencia: 3, impacto: 3, risco: 2 });

    const { rows } = await pool.query(
      `SELECT observacao FROM historico_chamado WHERE chamado_id = $1 ORDER BY id LIMIT 1`,
      [resp.body.chamado.id]
    );
    expect(rows[0].observacao).toMatch(/Prioridade pela situação informada: Pontuação 8 atinge o limiar 8 da prioridade alta/);
  });

  it('a gestão ainda corrige na triagem, com os fatores do solicitante já preenchidos', async () => {
    const aberto = await abrir({ urgencia: 2, impacto: 2, risco: 2 });
    const id = aberto.body.chamado.id;

    const resp = await request(app)
      .patch(`/chamados/${id}/priorizacao`)
      .set(como(gestor))
      .send({ urgencia: 3, impacto: 4, risco: 3 });

    expect(resp.status).toBe(200);
    expect(resp.body.chamado.prioridade).toBe('critica');
    expect(resp.body.chamado.priorizado_por).toBe(gestor.id);
  });
});

describe('O solicitante não escolhe a prioridade', () => {
  it('"crítica" enviada pelo solicitante é ignorada: sem situação informada, nasce média', async () => {
    const resp = await abrir({ prioridade: 'critica' });

    expect(resp.status).toBe(201);
    expect(resp.body.chamado.prioridade).toBe('media');
    expect(resp.body.chamado.prioridade_sugerida).toBeNull();
  });

  it('a "baixa" que uma versão antiga do aplicativo manda não rebaixa nem recusa o chamado', async () => {
    const resp = await abrir({ prioridade: 'baixa' });

    expect(resp.status).toBe(201);
    expect(resp.body.chamado.prioridade).toBe('media');
  });

  it('com a situação informada, a prioridade enviada junto não vale', async () => {
    const resp = await abrir({ prioridade: 'critica', urgencia: 1, impacto: 1, risco: 1 });

    expect(resp.body.chamado.prioridade).toBe('baixa');
  });

  it('a gestão define a prioridade direto, e o administrador também', async () => {
    expect((await abrir({ prioridade: 'critica' }, gestor)).body.chamado.prioridade).toBe('critica');
    expect((await abrir({ prioridade: 'alta' }, admin)).body.chamado.prioridade).toBe('alta');
  });

  it('a gestão que informa só a situação também tem o cálculo', async () => {
    const resp = await abrir({ urgencia: 4, impacto: 4, risco: 4 }, gestor);

    expect(resp.body.chamado.prioridade).toBe('critica');
    expect(resp.body.chamado.urgencia).toBe(4);
  });
});

describe('Situação informada inválida', () => {
  it('só uma parte dos fatores é recusada: dois calculariam o que ninguém decidiu', async () => {
    const resp = await abrir({ urgencia: 3, impacto: 3 });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.mensagem).toMatch(/risco/);
  });

  it('fator fora de 1 a 4 ou fracionário é recusado', async () => {
    expect((await abrir({ urgencia: 5, impacto: 1, risco: 1 })).status).toBe(422);
    expect((await abrir({ urgencia: 0, impacto: 1, risco: 1 })).status).toBe(422);
    expect((await abrir({ urgencia: 2.5, impacto: 1, risco: 1 })).status).toBe(422);
  });
});

describe('A regra de distribuição é o mínimo da rotina', () => {
  let categoriaDaRegra;

  beforeAll(async () => {
    const { rows } = await pool.query('INSERT INTO categoria (nome) VALUES ($1) RETURNING id', [MARCA.slice(0, 50)]);
    categoriaDaRegra = rows[0].id;
    criados.categorias.push(categoriaDaRegra);

    const equipe = await pool.query('INSERT INTO equipe (nome) VALUES ($1) RETURNING id', [`${MARCA} equipe`]);
    criados.equipes.push(equipe.rows[0].id);
    const tecnico = await conta('tecnico');
    await pool.query('INSERT INTO equipe_tecnico (equipe_id, usuario_id) VALUES ($1, $2)', [equipe.rows[0].id, tecnico.id]);

    const regra = await request(app)
      .post('/regras-distribuicao')
      .set(como(admin))
      .send({ categoria_id: categoriaDaRegra, equipe_id: equipe.rows[0].id, prioridade: 'alta' });
    criados.regras.push(regra.body.regra.id);
  });

  it('as respostas podem subir a prioridade acima do mínimo', async () => {
    const resp = await abrir({ urgencia: 4, impacto: 4, risco: 2 }, solicitante, categoriaDaRegra);

    expect(resp.body.chamado.prioridade).toBe('critica');
  });

  it('as respostas não descem abaixo do mínimo, e o histórico diz que foi o mínimo', async () => {
    const resp = await abrir({ urgencia: 1, impacto: 1, risco: 1 }, solicitante, categoriaDaRegra);

    expect(resp.body.chamado.prioridade).toBe('alta');
    const { rows } = await pool.query(
      `SELECT observacao FROM historico_chamado WHERE chamado_id = $1 ORDER BY id LIMIT 1`,
      [resp.body.chamado.id]
    );
    expect(rows[0].observacao).toMatch(/A regra de distribuição define o mínimo de "alta"/);
  });

  it('sem resposta nenhuma, vale a prioridade da regra (como antes)', async () => {
    const resp = await abrir({}, solicitante, categoriaDaRegra);

    expect(resp.body.chamado.prioridade).toBe('alta');
  });
});

describe('Sem regra de priorização vigente', () => {
  it('o chamado abre mesmo assim, como média, em vez de falhar', async () => {
    await pool.query('UPDATE regra_priorizacao SET vigencia_fim = now() WHERE vigencia_fim IS NULL');
    try {
      const resp = await abrir({ urgencia: 4, impacto: 4, risco: 4 });

      expect(resp.status).toBe(201);
      expect(resp.body.chamado.prioridade).toBe('media');
      expect(resp.body.chamado.urgencia).toBeNull();
    } finally {
      await restaurarV1();
    }
  });
});

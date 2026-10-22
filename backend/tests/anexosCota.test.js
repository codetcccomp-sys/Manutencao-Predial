const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const { LIMITE_POR_CHAMADO } = require('../src/config/anexos');
const armazenamentoUso = require('../src/services/armazenamentoUso.service');
const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);

/**
 * Cota de anexos.
 *
 * Os anexos moram em `bytea` no banco, e o plano gratuito tem 500 MB para o sistema todo.
 * Sem limite, um chamado com dezenas de fotos (ou uma conta anexando em laço) enchia o banco e
 * derrubava até os chamados críticos. Dois freios: LIMITE_POR_CHAMADO por chamado, e a gestão
 * avisada ao passar de 70% do banco.
 */

const PNG_VALIDO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const MARCA = `cota${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
let solicitante;
let gestor;
let localId;
let categoriaId;
const chamados = [];

async function conta(perfil) {
  const email = `${MARCA}_${perfil}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Cota ${perfil}`, email, senha: 'senha-teste-123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').set('X-Real-IP', `${IP}-${Math.random()}`).send({ email, senha: 'senha-teste-123' });
  return { token: login.body.token };
}

const como = (quem) => ({ Authorization: `Bearer ${quem.token}` });

async function novoChamado() {
  const resp = await request(app)
    .post('/chamados')
    .set(como(solicitante))
    .send({ titulo: `${MARCA} chamado`, descricao: 'Chamado para testar a cota.', categoria_id: categoriaId, local_id: localId });
  chamados.push(resp.body.chamado.id);
  return resp.body.chamado.id;
}

const anexar = (chamadoId) =>
  request(app)
    .post(`/chamados/${chamadoId}/anexos`)
    .set(como(solicitante))
    .attach('arquivo', PNG_VALIDO, { filename: 'foto.png', contentType: 'image/png' });

/** Enche o chamado direto no banco, para o teste não subir dez arquivos pela API. */
async function encher(chamadoId, quantidade) {
  const usuario = (await pool.query('SELECT solicitante_id FROM chamado WHERE id = $1', [chamadoId])).rows[0].solicitante_id;
  await pool.query(
    `INSERT INTO anexo (chamado_id, usuario_id, tipo, nome_arquivo, mime_type, tamanho_bytes, conteudo)
     SELECT $1, $2, 'foto', 'foto.png', 'image/png', $4, $3 FROM generate_series(1, $5)`,
    [chamadoId, usuario, PNG_VALIDO, PNG_VALIDO.length, quantidade]
  );
}

const quantos = async (chamadoId) =>
  (await pool.query('SELECT COUNT(*)::int AS n FROM anexo WHERE chamado_id = $1', [chamadoId])).rows[0].n;

beforeAll(async () => {
  solicitante = await conta('solicitante');
  gestor = await conta('gestor');
  localId = await garantirLocal({ unidade: `Unidade ${MARCA}` });
  categoriaId = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM anexo WHERE chamado_id = ANY($1::int[])', [chamados]);
  await pool.query('DELETE FROM historico_chamado WHERE chamado_id = ANY($1::int[])', [chamados]);
  await pool.query('DELETE FROM notificacao WHERE chamado_id = ANY($1::int[])', [chamados]);
  await pool.query('DELETE FROM chamado WHERE id = ANY($1::int[])', [chamados]);
  await pool.end();
});

describe('Limite de anexos por chamado', () => {
  it('o último anexo dentro do limite entra, e o seguinte é recusado com o motivo', async () => {
    const id = await novoChamado();
    await encher(id, LIMITE_POR_CHAMADO - 1);

    const ultimo = await anexar(id);
    expect(ultimo.status).toBe(201);

    const alem = await anexar(id);
    expect(alem.status).toBe(422);
    expect(alem.body.erro.codigo).toBe('LIMITE_DE_ANEXOS');
    expect(alem.body.erro.mensagem).toMatch(new RegExp(`${LIMITE_POR_CHAMADO} anexos`));
    expect(await quantos(id)).toBe(LIMITE_POR_CHAMADO);
  });

  it('remover um anexo libera uma vaga', async () => {
    const id = await novoChamado();
    await encher(id, LIMITE_POR_CHAMADO);
    expect((await anexar(id)).status).toBe(422);

    const lista = await request(app).get(`/chamados/${id}/anexos`).set(como(solicitante));
    const remocao = await request(app).delete(`/chamados/${id}/anexos/${lista.body.anexos[0].id}`).set(como(solicitante));
    expect(remocao.status).toBe(204);

    expect((await anexar(id)).status).toBe(201);
  });

  it('o limite é de cada chamado: um cheio não trava os outros', async () => {
    const cheio = await novoChamado();
    await encher(cheio, LIMITE_POR_CHAMADO);
    const outro = await novoChamado();

    expect((await anexar(cheio)).status).toBe(422);
    expect((await anexar(outro)).status).toBe(201);
  });

  it('envio simultâneo no último lugar espera o cadeado do chamado e confere de novo', async () => {
    // Determinístico, sem depender de sorte no cruzamento de requisições: o teste segura o
    // cadeado do chamado, dispara o envio (cuja primeira conferência vê 9 anexos e passa),
    // ocupa a última vaga por fora e só então solta. O envio tem de ter ficado esperando, e
    // tem de recontar ao acordar: sem o cadeado ele terminaria na hora; sem a recontagem,
    // entraria o 11º.
    const id = await novoChamado();
    await encher(id, LIMITE_POR_CHAMADO - 1);

    const segurando = await pool.connect();
    let resposta;
    try {
      await segurando.query('BEGIN');
      await segurando.query("SELECT pg_advisory_xact_lock(hashtext('anexo_chamado'), $1::int)", [id]);

      let terminou = false;
      resposta = anexar(id).then((r) => {
        terminou = true;
        return r;
      });
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(terminou).toBe(false);

      await encher(id, 1);
      await segurando.query('COMMIT');
    } finally {
      segurando.release();
    }

    const final = await resposta;
    expect(final.status).toBe(422);
    expect(final.body.erro.codigo).toBe('LIMITE_DE_ANEXOS');
    expect(await quantos(id)).toBe(LIMITE_POR_CHAMADO);
  });

  it('a listagem informa o limite, para a tela não ter o número copiado', async () => {
    const id = await novoChamado();

    const resp = await request(app).get(`/chamados/${id}/anexos`).set(como(solicitante));

    expect(resp.body.limite).toBe(LIMITE_POR_CHAMADO);
  });
});

describe('Uso do banco', () => {
  it('avisa a partir de 70% do limite, e não antes', () => {
    expect(armazenamentoUso.avaliar(699, 1000)).toEqual({ percentual: 69.9, alerta: false });
    expect(armazenamentoUso.avaliar(700, 1000)).toEqual({ percentual: 70, alerta: true });
    expect(armazenamentoUso.avaliar(1000, 1000)).toEqual({ percentual: 100, alerta: true });
  });

  it('o limite padrão é o do plano gratuito, e BANCO_LIMITE_MB o troca', () => {
    const original = process.env.BANCO_LIMITE_MB;
    try {
      delete process.env.BANCO_LIMITE_MB;
      expect(armazenamentoUso.limiteDoBanco()).toBe(500 * 1024 * 1024);
      process.env.BANCO_LIMITE_MB = '8192';
      expect(armazenamentoUso.limiteDoBanco()).toBe(8192 * 1024 * 1024);
      process.env.BANCO_LIMITE_MB = 'abc';
      expect(armazenamentoUso.limiteDoBanco()).toBe(500 * 1024 * 1024);
    } finally {
      if (original === undefined) delete process.env.BANCO_LIMITE_MB;
      else process.env.BANCO_LIMITE_MB = original;
    }
  });

  it('a gestão lê o tamanho do banco e quanto dele é anexo', async () => {
    const id = await novoChamado();
    await encher(id, 2);

    const resp = await request(app).get('/operacao/armazenamento').set(como(gestor));

    expect(resp.status).toBe(200);
    expect(resp.body.banco_bytes).toBeGreaterThan(0);
    expect(resp.body.limite_bytes).toBeGreaterThan(0);
    expect(resp.body.anexos_no_banco).toBeGreaterThanOrEqual(2);
    expect(resp.body.anexos_no_banco_bytes).toBeGreaterThanOrEqual(2 * PNG_VALIDO.length);
    expect(resp.body.modo).toBe('banco');
    expect(typeof resp.body.alerta).toBe('boolean');
  });

  it('com um limite minúsculo o aviso dispara de verdade, pela rota', async () => {
    const original = process.env.BANCO_LIMITE_MB;
    process.env.BANCO_LIMITE_MB = '1';
    try {
      const resp = await request(app).get('/operacao/armazenamento').set(como(gestor));
      expect(resp.body.alerta).toBe(true);
      expect(resp.body.percentual).toBeGreaterThan(100);
    } finally {
      if (original === undefined) delete process.env.BANCO_LIMITE_MB;
      else process.env.BANCO_LIMITE_MB = original;
    }
  });

  it('o solicitante não lê', async () => {
    expect((await request(app).get('/operacao/armazenamento').set(como(solicitante))).status).toBe(403);
    expect((await request(app).get('/operacao/armazenamento')).status).toBe(401);
  });
});

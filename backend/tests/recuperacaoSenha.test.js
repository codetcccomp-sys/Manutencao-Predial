const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const recuperacao = require('../src/services/recuperacao.service');

const email = `recupera_${Date.now()}@exemplo.com`;
let usuarioId;

async function tokenMaisRecente() {
  // O banco só guarda o hash, então o teste gera o token via serviço, que é
  // o mesmo caminho do endpoint.
  const pedido = await recuperacao.solicitar(email, '127.0.0.1');
  return pedido.token;
}

beforeAll(async () => {
  await request(app).post('/auth/registrar').send({ nome: 'Recupera', email, senha: 'senha123' });
  const { rows } = await pool.query('SELECT id FROM usuario WHERE email = $1', [email]);
  usuarioId = rows[0].id;
});

afterEach(async () => {
  await pool.query('DELETE FROM recuperacao_senha WHERE usuario_id = $1', [usuarioId]);
});

afterAll(async () => {
  await pool.end();
});

describe('POST /auth/recuperar-senha', () => {
  it('responde igual para e-mail existente e inexistente', async () => {
    const existente = await request(app).post('/auth/recuperar-senha').send({ email });
    const inexistente = await request(app)
      .post('/auth/recuperar-senha')
      .send({ email: `nao_existe_${Date.now()}@exemplo.com` });

    expect(existente.status).toBe(inexistente.status);
    expect(existente.body).toEqual(inexistente.body);
  });

  it('cria o pedido guardando apenas o hash do token', async () => {
    await request(app).post('/auth/recuperar-senha').send({ email });

    const { rows } = await pool.query(
      'SELECT token_hash, expira_em, usado_em FROM recuperacao_senha WHERE usuario_id = $1',
      [usuarioId]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].usado_em).toBeNull();
    // 64 caracteres hexadecimais é a cara de um SHA-256; um token em claro
    // teria outro formato e, sobretudo, não deveria estar aqui.
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(rows[0].expira_em).getTime()).toBeGreaterThan(Date.now());
  });

  it('não gera token para conta inativa', async () => {
    await pool.query('UPDATE usuario SET ativo = FALSE WHERE id = $1', [usuarioId]);
    try {
      const resp = await request(app).post('/auth/recuperar-senha').send({ email });
      expect(resp.status).toBe(200);

      const { rows } = await pool.query(
        'SELECT count(*)::int AS total FROM recuperacao_senha WHERE usuario_id = $1',
        [usuarioId]
      );
      // Reativar conta é decisão de administrador, não consequência de um
      // clique em "esqueci minha senha".
      expect(rows[0].total).toBe(0);
    } finally {
      await pool.query('UPDATE usuario SET ativo = TRUE WHERE id = $1', [usuarioId]);
    }
  });

  it('limita pedidos pendentes simultâneos', async () => {
    for (let i = 0; i < recuperacao.MAX_PENDENTES + 2; i += 1) {
      await request(app).post('/auth/recuperar-senha').send({ email });
    }

    const { rows } = await pool.query(
      'SELECT count(*)::int AS total FROM recuperacao_senha WHERE usuario_id = $1',
      [usuarioId]
    );
    expect(rows[0].total).toBe(recuperacao.MAX_PENDENTES);
  });
});

describe('POST /auth/redefinir-senha', () => {
  it('troca a senha e permite entrar com a nova', async () => {
    const token = await tokenMaisRecente();

    const resp = await request(app)
      .post('/auth/redefinir-senha')
      .send({ token, senha: 'novaSenha456' });
    expect(resp.status).toBe(200);

    const comNova = await request(app).post('/auth/login').send({ email, senha: 'novaSenha456' });
    expect(comNova.status).toBe(200);

    const comAntiga = await request(app).post('/auth/login').send({ email, senha: 'senha123' });
    expect(comAntiga.status).toBe(401);

    // Devolve ao estado inicial para os demais testes.
    const outro = await tokenMaisRecente();
    await request(app).post('/auth/redefinir-senha').send({ token: outro, senha: 'senha123' });
  });

  it('recusa o mesmo token duas vezes', async () => {
    const token = await tokenMaisRecente();
    await request(app).post('/auth/redefinir-senha').send({ token, senha: 'senha123' });

    const segunda = await request(app)
      .post('/auth/redefinir-senha')
      .send({ token, senha: 'outraSenha789' });

    expect(segunda.status).toBe(400);
    expect(segunda.body.erro.codigo).toBe('TOKEN_INVALIDO');
  });

  it('recusa token expirado', async () => {
    const token = await tokenMaisRecente();
    // A criação recua junto: o CHECK da tabela impede um token que expira
    // antes de existir, e envelhecer só o vencimento criaria esse absurdo.
    await pool.query(
      `UPDATE recuperacao_senha
          SET criado_em = now() - interval '2 hours',
              expira_em = now() - interval '1 minute'
        WHERE usuario_id = $1`,
      [usuarioId]
    );

    const resp = await request(app).post('/auth/redefinir-senha').send({ token, senha: 'senha123' });
    expect(resp.status).toBe(400);
  });

  it('recusa token inexistente com a mesma mensagem de um expirado', async () => {
    const inventado = crypto.randomBytes(32).toString('hex');
    const resp = await request(app)
      .post('/auth/redefinir-senha')
      .send({ token: inventado, senha: 'senha123' });

    expect(resp.status).toBe(400);
    expect(resp.body.erro.codigo).toBe('TOKEN_INVALIDO');
  });

  it('invalida os demais pedidos pendentes ao redefinir', async () => {
    const primeiro = await tokenMaisRecente();
    const segundo = await tokenMaisRecente();

    await request(app).post('/auth/redefinir-senha').send({ token: segundo, senha: 'senha123' });

    // Um link antigo pode estar numa caixa de e-mail que não é mais a da
    // pessoa; ele não pode continuar valendo depois da troca.
    const comAntigo = await request(app)
      .post('/auth/redefinir-senha')
      .send({ token: primeiro, senha: 'tentativa999' });
    expect(comAntigo.status).toBe(400);
  });

  it('libera o bloqueio por tentativas de login', async () => {
    // Erra a senha até bloquear.
    for (let i = 0; i < 6; i += 1) {
      await request(app).post('/auth/login').send({ email, senha: 'errada' });
    }
    const bloqueado = await request(app).post('/auth/login').send({ email, senha: 'senha123' });
    expect(bloqueado.status).toBe(429);

    const token = await tokenMaisRecente();
    await request(app).post('/auth/redefinir-senha').send({ token, senha: 'senha123' });

    // Quem acabou de provar ser dono da conta não deve seguir barrado por
    // erros anteriores.
    const depois = await request(app).post('/auth/login').send({ email, senha: 'senha123' });
    expect(depois.status).toBe(200);
  });

  it('recusa senha curta demais', async () => {
    const token = await tokenMaisRecente();
    const resp = await request(app).post('/auth/redefinir-senha').send({ token, senha: '123' });
    expect(resp.status).toBe(422);
  });
});

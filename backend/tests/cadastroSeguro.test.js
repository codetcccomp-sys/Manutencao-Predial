const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const recuperacao = require('../src/services/recuperacao.service');
const { validarSenhaNova } = require('../src/utils/senha');
const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);

/**
 * O cadastro público (RF01).
 *
 * /auth/registrar era a única rota pública de escrita sem limite; respondia 409 a quem
 * perguntasse se um e-mail tinha conta; e aceitava senha de 6 caracteres. Agora: teto por
 * IP e por dia, a mesma resposta para e-mail novo e repetido, e senha nova de 10 caracteres
 * ou mais fora de uma lista das comuns.
 */

const MARCA = `cadseg${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const SENHA = 'uma-senha-que-presta';
let admin;
const ips = [];

const ipNovo = () => {
  const ip = `${IP}-${MARCA}-${ips.length}`;
  ips.push(ip);
  return ip;
};
const emailNovo = () => `${MARCA}_${Math.random().toString(36).slice(2)}@exemplo.com`;

const registrar = (corpo, ip = ipNovo()) =>
  request(app).post('/auth/registrar').set('X-Real-IP', ip).send({ nome: 'Pessoa Teste', senha: SENHA, ...corpo });

async function entrar(email, senha) {
  return request(app).post('/auth/login').set('X-Real-IP', ipNovo()).send({ email, senha });
}

beforeAll(async () => {
  const email = emailNovo();
  await registrar({ email });
  await pool.query("UPDATE usuario SET perfil = 'administrador', ativo = TRUE, cadastro_pendente_desde = NULL WHERE email = $1", [email]);
  const login = await entrar(email, SENHA);
  admin = { token: login.body.token };
});

afterAll(async () => {
  await pool.query('DELETE FROM tentativa_cadastro WHERE ip = ANY($1::text[])', [ips]);
  await pool.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('A resposta não diz se o e-mail já tinha conta', () => {
  it('e-mail novo e repetido voltam o mesmo status e o mesmo corpo, sem conta nem token', async () => {
    const email = emailNovo();

    const novo = await registrar({ email });
    const repetido = await registrar({ email });

    expect(novo.status).toBe(202);
    expect(repetido.status).toBe(novo.status);
    expect(repetido.body).toEqual(novo.body);
    expect(novo.body).toEqual({ recebido: true, aguardando_aprovacao: expect.any(Boolean) });
    expect(JSON.stringify(novo.body)).not.toContain(email);
  });

  it('o pedido repetido não troca a senha nem cria outra conta', async () => {
    const email = emailNovo();
    await registrar({ email });

    const outra = await registrar({ email, senha: 'outra-senha-bem-grande' });

    expect(outra.status).toBe(202);
    const { rows } = await pool.query('SELECT 1 FROM usuario WHERE email = $1', [email]);
    expect(rows).toHaveLength(1);
    await pool.query('UPDATE usuario SET ativo = TRUE, cadastro_pendente_desde = NULL WHERE email = $1', [email]);
    expect((await entrar(email, SENHA)).status).toBe(200);
    expect((await entrar(email, 'outra-senha-bem-grande')).status).toBe(401);
  });

  it('o pedido repetido faz o mesmo trabalho do novo: o tempo não conta o que o corpo esconde', async () => {
    const email = emailNovo();
    const hash = jest.spyOn(bcrypt, 'hash');

    await registrar({ email });
    const noNovo = hash.mock.calls.length;
    await registrar({ email });

    expect(noNovo).toBe(1);
    expect(hash.mock.calls.length - noNovo).toBe(1);
  });

  it('a administração, que está autenticada, continua recebendo o 409', async () => {
    const email = emailNovo();
    await registrar({ email });

    const resp = await request(app)
      .post('/usuarios')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ nome: 'Duplicada', email, senha: SENHA, perfil: 'solicitante' });

    expect(resp.status).toBe(409);
    expect(resp.body.erro.codigo).toBe('EMAIL_EM_USO');
  });
});

describe('Teto de cadastros', () => {
  const guardado = {};
  beforeEach(() => {
    guardado.ip = process.env.CADASTRO_MAX_POR_IP;
    guardado.dia = process.env.CADASTRO_MAX_POR_DIA;
  });
  afterEach(() => {
    process.env.CADASTRO_MAX_POR_IP = guardado.ip;
    process.env.CADASTRO_MAX_POR_DIA = guardado.dia;
  });

  it('passado o teto por IP volta 429, e outro IP não é afetado', async () => {
    process.env.CADASTRO_MAX_POR_IP = '3';
    const ip = ipNovo();

    for (let i = 0; i < 3; i += 1) expect((await registrar({ email: emailNovo() }, ip)).status).toBe(202);
    const barrado = await registrar({ email: emailNovo() }, ip);

    expect(barrado.status).toBe(429);
    expect(barrado.body.erro.codigo).toBe('MUITOS_CADASTROS');
    expect((await registrar({ email: emailNovo() }, ipNovo())).status).toBe(202);
  });

  it('o teto conta o pedido de e-mail repetido também: o 429 não revela quem tem conta', async () => {
    process.env.CADASTRO_MAX_POR_IP = '2';
    const ip = ipNovo();
    const email = emailNovo();

    await registrar({ email }, ip);
    await registrar({ email }, ip);

    expect((await registrar({ email: emailNovo() }, ip)).status).toBe(429);
  });

  it('o teto do dia vale para todos os IPs somados', async () => {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM tentativa_cadastro WHERE criado_em > now() - interval '24 hours'");
    process.env.CADASTRO_MAX_POR_DIA = String(rows[0].n + 2);

    expect((await registrar({ email: emailNovo() })).status).toBe(202);
    expect((await registrar({ email: emailNovo() })).status).toBe(202);
    const barrado = await registrar({ email: emailNovo() });

    expect(barrado.status).toBe(429);
    expect(barrado.body.erro.codigo).toBe('MUITOS_CADASTROS');
  });

  it('corpo malformado é recusado sem gastar uma vaga do teto', async () => {
    process.env.CADASTRO_MAX_POR_IP = '1';
    const ip = ipNovo();

    expect((await registrar({ email: 'isto-nao-e-email' }, ip)).status).toBe(422);
    expect((await registrar({ email: emailNovo() }, ip)).status).toBe(202);
  });

  it('com o contador fora do ar o cadastro segue: infraestrutura não vira indisponibilidade', async () => {
    const original = pool.query.bind(pool);
    jest.spyOn(pool, 'query').mockImplementation((sql, ...resto) =>
      typeof sql === 'string' && sql.includes('tentativa_cadastro') ? Promise.reject(new Error('sem tabela')) : original(sql, ...resto)
    );
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect((await registrar({ email: emailNovo() })).status).toBe(202);
  });
});

describe('Senha nova', () => {
  it('9 caracteres é recusado; 10 passa', async () => {
    expect((await registrar({ email: emailNovo(), senha: 'nove-nove' })).status).toBe(422);
    expect((await registrar({ email: emailNovo(), senha: 'dez-dez-10' })).status).toBe(202);
    expect(() => validarSenhaNova('123456789')).toThrow(/ao menos 10/);
  });

  it('senha comum é recusada com o motivo, mesmo com 10 caracteres', async () => {
    for (const senha of ['senha12345', 'qwertyuiop', 'password123', 'brasil2026']) {
      const resp = await registrar({ email: emailNovo(), senha });
      expect(resp.status).toBe(422);
      expect(resp.body.erro.codigo).toBe('SENHA_FRACA');
    }
  });

  it('um caractere repetido e sequência de dígitos são recusados', () => {
    for (const senha of ['aaaaaaaaaa', '0000000000', '2345678901', '9876543210', '4567890123']) {
      expect(() => validarSenhaNova(senha)).toThrow(/muito comum/);
    }
  });

  it('o próprio e-mail, ou a parte antes do @, não serve de senha', () => {
    expect(() => validarSenhaNova('maria.silva1@exemplo.com', { email: 'maria.silva1@exemplo.com' })).toThrow(/muito comum/);
    expect(() => validarSenhaNova('maria.silva1', { email: 'maria.silva1@exemplo.com' })).toThrow(/muito comum/);
  });

  it('sem regra de composição: frase em minúsculas e sem símbolo passa', () => {
    expect(() => validarSenhaNova('gato cachorro passaro')).not.toThrow();
  });

  it('a senha criada pela administração segue a mesma regra', async () => {
    const resp = await request(app)
      .post('/usuarios')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ nome: 'Fraca Senha', email: emailNovo(), senha: 'senha12345', perfil: 'solicitante' });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('SENHA_FRACA');
  });

  it('a redefinição de senha recusa a fraca antes de procurar o token', async () => {
    await expect(recuperacao.redefinir('x'.repeat(40), 'senha12345')).rejects.toMatchObject({ code: 'SENHA_FRACA' });
  });

  it('quem já tem senha curta continua entrando: a regra é da senha nova', async () => {
    const email = emailNovo();
    await pool.query(
      "INSERT INTO usuario (nome, email, senha_hash, perfil, ativo) VALUES ('Senha Antiga', $1, $2, 'solicitante', TRUE)",
      [email, await bcrypt.hash('abc123', 10)]
    );

    expect((await entrar(email, 'abc123')).status).toBe(200);
  });
});

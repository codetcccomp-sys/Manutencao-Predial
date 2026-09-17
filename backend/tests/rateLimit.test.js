const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { LIMITES } = require('../src/middlewares/rateLimit');

const { ipDaSuite } = require('./apoio/ip');

// Ver tests/apoio/ip.js: cada suíte se apresenta ao login como um cliente
// distinto, para não dividir a cota por IP com as suítes que rodam em paralelo.
const IP = ipDaSuite(__filename);

const email = `ratelimit_${Date.now()}@exemplo.com`;

beforeAll(async () => {
  await request(app).post('/auth/registrar').send({ nome: 'Rate Limit', email, senha: 'senha123' });
});

// Os testes desta suíte compartilham o mesmo IP, então sem zerar as tentativas
// o limite de um teste vazaria para o seguinte e a ordem de execução passaria a
// importar. O recorte por IP é essencial: apagar a tabela inteira derrubaria o
// contador das suítes que rodam em paralelo no meio das asserções delas.
beforeEach(async () => {
  await pool.query('DELETE FROM tentativa_login WHERE ip = $1', [IP]);
});

afterAll(async () => {
  await pool.query('DELETE FROM tentativa_login WHERE ip = $1', [IP]);
  await pool.end();
});

async function tentarSenhaErrada(alvo = email) {
  return request(app).post('/auth/login').set('X-Real-IP', IP).send({ email: alvo, senha: 'senha_errada' });
}

describe('Rate limiting do login', () => {
  it('bloqueia com 429 após o limite de falhas do e-mail e informa Retry-After', async () => {
    for (let i = 0; i < LIMITES.MAX_FALHAS_POR_EMAIL; i += 1) {
      const resposta = await tentarSenhaErrada();
      expect(resposta.status).toBe(401);
    }

    const bloqueada = await tentarSenhaErrada();
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.body.erro.codigo).toBe('MUITAS_TENTATIVAS');

    const retryAfter = Number(bloqueada.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(LIMITES.JANELA_MINUTOS * 60);
  });

  it('não deixa a senha correta passar enquanto o e-mail está bloqueado', async () => {
    for (let i = 0; i < LIMITES.MAX_FALHAS_POR_EMAIL; i += 1) {
      await tentarSenhaErrada();
    }

    const resposta = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha123' });
    expect(resposta.status).toBe(429);
  });

  it('zera o contador do e-mail depois de um login bem-sucedido', async () => {
    for (let i = 0; i < LIMITES.MAX_FALHAS_POR_EMAIL - 1; i += 1) {
      await tentarSenhaErrada();
    }

    const sucesso = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha123' });
    expect(sucesso.status).toBe(200);

    const { rows } = await pool.query(
      'SELECT count(*)::int AS falhas FROM tentativa_login WHERE email = $1 AND NOT sucesso',
      [email]
    );
    expect(rows[0].falhas).toBe(0);

    // E o usuário volta a ter a janela inteira disponível.
    const depois = await tentarSenhaErrada();
    expect(depois.status).toBe(401);
  });

  it('limita por e-mail sem atingir quem tenta outro e-mail do mesmo IP', async () => {
    for (let i = 0; i < LIMITES.MAX_FALHAS_POR_EMAIL; i += 1) {
      await tentarSenhaErrada();
    }
    expect((await tentarSenhaErrada()).status).toBe(429);

    const outro = await tentarSenhaErrada(`outro_${Date.now()}@exemplo.com`);
    expect(outro.status).toBe(401);
  });

  it('limita por IP quando o ataque espalha as tentativas por vários e-mails', async () => {
    let ultima;
    // Cada e-mail é usado menos vezes que o limite individual, então quem
    // barra aqui só pode ser a contagem por IP.
    const porEmail = LIMITES.MAX_FALHAS_POR_EMAIL - 1;
    const emailsNecessarios = Math.ceil((LIMITES.MAX_FALHAS_POR_IP + 1) / porEmail);

    const execucao = Date.now();
    for (let e = 0; e < emailsNecessarios; e += 1) {
      for (let i = 0; i < porEmail; i += 1) {
        ultima = await tentarSenhaErrada(`espalhado_${execucao}_${e}@exemplo.com`);
      }
    }

    expect(ultima.status).toBe(429);

    // As tentativas barradas nem chegam a ser registradas: o limite para o
    // pedido antes do bcrypt, então a contagem para exatamente no teto.
    const { rows } = await pool.query(
      'SELECT count(*)::int AS falhas FROM tentativa_login WHERE NOT sucesso AND ip = $1',
      [IP]
    );
    expect(rows[0].falhas).toBe(LIMITES.MAX_FALHAS_POR_IP);
  });
});

describe('Enumeração de usuários', () => {
  it('responde o mesmo corpo para e-mail inexistente e para senha errada', async () => {
    const inexistente = await request(app)
      .post('/auth/login').set('X-Real-IP', IP)
      .send({ email: `nao_existe_${Date.now()}@exemplo.com`, senha: 'senha123' });
    const senhaErrada = await tentarSenhaErrada();

    expect(inexistente.status).toBe(senhaErrada.status);
    expect(inexistente.body).toEqual(senhaErrada.body);
  });
});

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const google = require('../src/services/google.service');
const configuracaoService = require('../src/services/configuracao.service');
const { codigoNoPasso, passoDe } = require('../src/utils/totp');
const { ipDaSuite } = require('./apoio/ip');

/**
 * Entrar com Google.
 *
 * Sem rede: o teste faz o papel do Google. Gera um par de chaves RSA, publica
 * a pública no lugar das do Google (trocando a busca) e assina credenciais com
 * a privada, do jeito que o botão do Google entregaria à tela.
 */

const IP = ipDaSuite(__filename);
const CLIENTE = 'cliente-do-teste.apps.googleusercontent.com';
const MARCA = `goog${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
let n = 0;

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = `kid-${MARCA}`;
const intruso = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function credencial(campos = {}, { chave = privateKey, kid = KID, ...opcoes } = {}) {
  return jwt.sign(
    {
      iss: 'https://accounts.google.com',
      aud: CLIENTE,
      email_verified: true,
      name: 'Pessoa do Google',
      ...campos,
    },
    chave,
    { algorithm: 'RS256', keyid: kid, expiresIn: '1h', ...opcoes }
  );
}

const gmailNovo = () => `${MARCA}.${n++}@gmail.com`;
const entrarGoogle = (cred) => request(app).post('/auth/google').send({ credencial: cred });

let aprovacao;
beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = CLIENTE;
  delete process.env.GOOGLE_DOMINIO;
  google.esquecerChaves();
  jest.spyOn(google, 'buscarChaves').mockResolvedValue({
    chaves: { [KID]: { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' } },
    validadeMs: 3_600_000,
  });
  // Como na suíte da aprovação: a exigência vale só para este processo.
  aprovacao = jest.spyOn(configuracaoService, 'cadastroExigeAprovacao').mockResolvedValue(false);
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  delete process.env.GOOGLE_CLIENT_ID;
  await pool.end();
});

describe('Configuração', () => {
  it('a tela recebe o ID do cliente, que é público; sem ele, o botão não aparece', async () => {
    expect((await request(app).get('/auth/google')).body).toEqual({ client_id: CLIENTE });
    delete process.env.GOOGLE_CLIENT_ID;
    expect((await request(app).get('/auth/google')).body).toEqual({ client_id: null });
    const desligado = await entrarGoogle(credencial({ email: gmailNovo() }));
    expect(desligado.status).toBe(404);
    expect(desligado.body.erro.codigo).toBe('GOOGLE_DESLIGADO');
  });
});

describe('Conta nova', () => {
  it('nasce solicitante e entra, com a sessão em cookie', async () => {
    const email = gmailNovo();
    const resp = await entrarGoogle(credencial({ email, name: '  Maria   do Google ' }));
    expect(resp.status).toBe(200);
    expect(resp.body.usuario).toMatchObject({ email, perfil: 'solicitante', nome: 'Maria do Google' });
    expect((resp.headers['set-cookie'] || []).some((c) => c.startsWith('conserva_sessao='))).toBe(true);
  });

  it('com a aprovação ligada, espera a gestão (e entrar de novo não cria outra conta)', async () => {
    aprovacao.mockResolvedValue(true);
    const email = gmailNovo();
    const primeira = await entrarGoogle(credencial({ email }));
    expect(primeira.status).toBe(202);
    expect(primeira.body).toEqual({ aguardando_aprovacao: true });
    expect(primeira.headers['set-cookie']).toBeUndefined();

    expect((await entrarGoogle(credencial({ email }))).status).toBe(202);
    const { rows } = await pool.query('SELECT count(*)::int AS n, bool_and(NOT ativo) AS inativas FROM usuario WHERE email = $1', [email]);
    expect(rows[0]).toEqual({ n: 1, inativas: true });
  });

  it('dois cliques ao mesmo tempo criam uma conta só, e os dois entram', async () => {
    const email = gmailNovo();
    const respostas = await Promise.all([1, 2, 3].map(() => entrarGoogle(credencial({ email }))));
    expect(respostas.map((r) => r.status)).toEqual([200, 200, 200]);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM usuario WHERE email = $1', [email]);
    expect(rows[0].n).toBe(1);
  });

  it('a conta criada pelo Google não tem senha padrão, e cada uma tem a sua', async () => {
    const emails = [gmailNovo(), gmailNovo()];
    for (const email of emails) await entrarGoogle(credencial({ email }));
    const { rows } = await pool.query('SELECT senha_hash FROM usuario WHERE email = ANY($1)', [emails]);
    expect(rows).toHaveLength(2);
    expect(rows[0].senha_hash).not.toBe(rows[1].senha_hash);
    for (const senha of ['senha123', 'google', emails[0]]) {
      const login = await request(app)
        .post('/auth/login')
        .set('X-Real-IP', `${IP}-${Math.random()}`)
        .send({ email: emails[0], senha });
      expect([senha, login.status]).toEqual([senha, 401]);
    }
  });
});

describe('Conta que já existe', () => {
  async function contaComSenha(perfil = 'gestor') {
    const email = gmailNovo();
    await request(app).post('/auth/registrar').send({ nome: 'Já Cadastrada', email, senha: 'senha123' });
    await pool.query('UPDATE usuario SET perfil = $1, ativo = TRUE, cadastro_pendente_desde = NULL WHERE email = $2', [perfil, email]);
    return email;
  }

  it('entra na conta do mesmo e-mail, com o perfil dela, ignorando a caixa do e-mail', async () => {
    const email = await contaComSenha('gestor');
    const resp = await entrarGoogle(credencial({ email: email.toUpperCase() }));
    expect(resp.status).toBe(200);
    expect(resp.body.usuario).toMatchObject({ email, perfil: 'gestor', nome: 'Já Cadastrada' });
  });

  it('com duas etapas ligadas, o Google não dispensa o código', async () => {
    const email = await contaComSenha('gestor');
    const token = (
      await request(app).post('/auth/login').set('X-Real-IP', `${IP}-${Math.random()}`).send({ email, senha: 'senha123' })
    ).body.token;
    const como = { Authorization: `Bearer ${token}` };
    const { segredo } = (await request(app).post('/auth/2fa/iniciar').set(como)).body;
    await request(app).post('/auth/2fa/ativar').set(como).send({ senha: 'senha123', codigo: codigoNoPasso(segredo, passoDe(Date.now())) });

    const resp = await entrarGoogle(credencial({ email }));
    expect(resp.status).toBe(200);
    expect(resp.body.requer_2fa).toBe(true);
    // No Google o e-mail não foi digitado: sem isto, o passo do código não
    // diria de qual conta se trata.
    expect(resp.body.email).toBe(email);
    expect(resp.body.token).toBeUndefined();
    expect(resp.headers['set-cookie']).toBeUndefined();

    const segunda = await request(app)
      .post('/auth/login/2fa')
      .set('X-Real-IP', `${IP}-${Math.random()}`)
      .send({ desafio: resp.body.desafio, codigo: codigoNoPasso(segredo, passoDe(Date.now()) + 1) });
    expect(segunda.status).toBe(200);
  });

  it('conta desativada não entra', async () => {
    const email = await contaComSenha('tecnico');
    await pool.query('UPDATE usuario SET ativo = FALSE WHERE email = $1', [email]);
    const resp = await entrarGoogle(credencial({ email }));
    expect(resp.status).toBe(403);
    expect(resp.body.erro.codigo).toBe('CONTA_DESATIVADA');
  });
});

describe('Credencial recusada', () => {
  const casos = [
    ['assinada por outra chave', () => credencial({ email: gmailNovo() }, { chave: intruso.privateKey })],
    ['emitida para outro sistema', () => credencial({ email: gmailNovo(), aud: 'outro.apps.googleusercontent.com' })],
    ['de outro emissor', () => credencial({ email: gmailNovo(), iss: 'https://falso.example.com' })],
    ['vencida', () => credencial({ email: gmailNovo() }, { expiresIn: -10 })],
    ['com chave que o Google não publica', () => credencial({ email: gmailNovo() }, { kid: 'kid-inventado' })],
    ['sem assinatura (alg none)', () => jwt.sign({ email: gmailNovo(), aud: CLIENTE, iss: 'accounts.google.com', email_verified: true }, null, { algorithm: 'none' })],
    ['que nem é JWT', () => 'nao-e-uma-credencial'],
  ];
  it.each(casos)('%s', async (_, montar) => {
    const resp = await entrarGoogle(montar());
    expect(resp.status).toBe(401);
    expect(resp.body.erro.codigo).toBe('CREDENCIAL_GOOGLE_INVALIDA');
  });

  it('e-mail que o Google não garante (conta Google com e-mail de outro provedor) não entra', async () => {
    const email = `${MARCA}.${n++}@exemplo.com`;
    for (const campos of [{ email }, { email: gmailNovo(), email_verified: false }]) {
      const resp = await entrarGoogle(credencial(campos));
      expect(resp.status).toBe(401);
      expect(resp.body.erro.codigo).toBe('GOOGLE_EMAIL_NAO_CONFIRMADO');
    }
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM usuario WHERE email = $1', [email]);
    expect(rows[0].n).toBe(0);
  });

  it('com o domínio da instituição definido, só contas dela entram', async () => {
    process.env.GOOGLE_DOMINIO = 'escola.edu.br';
    const fora = await entrarGoogle(credencial({ email: gmailNovo() }));
    expect(fora.status).toBe(403);
    expect(fora.body.erro.codigo).toBe('GOOGLE_DOMINIO_NAO_PERMITIDO');

    const dentro = await entrarGoogle(credencial({ email: `${MARCA}.${n++}@escola.edu.br`, hd: 'escola.edu.br' }));
    expect(dentro.status).toBe(200);
  });

  it('uma chave inventada por requisição não vira uma busca no Google por requisição', async () => {
    for (let i = 0; i < 5; i++) {
      await entrarGoogle(credencial({ email: gmailNovo() }, { kid: `inventada-${i}` }));
    }
    expect(google.buscarChaves).toHaveBeenCalledTimes(1);
  });

  it('Google fora do ar é falha do servidor, não credencial inválida', async () => {
    google.buscarChaves.mockRejectedValue(new Error('rede'));
    const espiao = jest.spyOn(console, 'error').mockImplementation(() => {});
    const resp = await entrarGoogle(credencial({ email: gmailNovo() }));
    expect(resp.status).toBe(503);
    expect(resp.body.erro.codigo).toBe('GOOGLE_INDISPONIVEL');
    espiao.mockRestore();
  });
});

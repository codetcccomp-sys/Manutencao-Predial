const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const pool = require('../src/config/db');
const recuperacao = require('../src/services/recuperacao.service');
const { codigoNoPasso, passoDe } = require('../src/utils/totp');
const { ipDaSuite } = require('./apoio/ip');

/**
 * Sessão em cookie HttpOnly, revogação e verificação em duas etapas.
 */

const IP = ipDaSuite(__filename);
const SENHA = 'senha123';

async function conta(perfil = 'solicitante') {
  const email = `${perfil}_2fa_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Duas etapas ${perfil}`, email, senha: SENHA });
  if (perfil !== 'solicitante') await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  return email;
}

const entrar = (email, ip = IP) =>
  request(app).post('/auth/login').set('X-Real-IP', ip).send({ email, senha: SENHA });

const cookieDa = (resp) => (resp.headers['set-cookie'] || []).find((c) => c.startsWith('conserva_sessao='));
const valorDo = (cookie) => cookie.split(';')[0];
const como = (token) => ({ Authorization: `Bearer ${token}` });

// O código que o aplicativo mostraria agora, ou num passo vizinho.
const codigoAgora = (segredo, deslocamento = 0) => codigoNoPasso(segredo, passoDe(Date.now()) + deslocamento);

afterAll(async () => {
  await pool.end();
});

describe('Sessão em cookie', () => {
  it('o login grava um cookie HttpOnly, SameSite=Strict, sem Secure em http', async () => {
    const resp = await entrar(await conta());
    expect(resp.status).toBe(200);
    const cookie = cookieDa(resp);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/);
  });

  it('atrás do proxy em https, o cookie sai com Secure', async () => {
    const email = await conta();
    const resp = await request(app)
      .post('/auth/login')
      .set('X-Real-IP', IP)
      .set('X-Forwarded-Proto', 'https')
      .send({ email, senha: SENHA });
    expect(cookieDa(resp)).toMatch(/Secure/);
  });

  it('só com o cookie, a leitura funciona; a escrita exige o cabeçalho da tela', async () => {
    const cookie = valorDo(cookieDa(await entrar(await conta())));

    expect((await request(app).get('/usuarios/me').set('Cookie', cookie)).status).toBe(200);

    const semCabecalho = await request(app).post('/auth/sair-de-todos').set('Cookie', cookie);
    expect(semCabecalho.status).toBe(403);
    expect(semCabecalho.body.erro.codigo).toBe('CSRF');

    const comCabecalho = await request(app).post('/auth/sair-de-todos').set('Cookie', cookie).set('X-Conserva', '1');
    expect(comCabecalho.status).toBe(204);
  });

  it('com o Bearer (clientes de API, testes), a escrita não precisa do cabeçalho', async () => {
    const { token } = (await entrar(await conta())).body;
    expect((await request(app).post('/auth/sair-de-todos').set(como(token))).status).toBe(204);
  });

  it('sair apaga o cookie', async () => {
    const resp = await request(app).post('/auth/sair');
    expect(resp.status).toBe(204);
    expect(cookieDa(resp)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('token emitido antes da versão de sessão (sem "sv") continua valendo: publicar não desloga ninguém', async () => {
    const email = await conta();
    const { rows } = await pool.query('SELECT id FROM usuario WHERE email = $1', [email]);
    const antigo = jwt.sign({ id: rows[0].id, perfil: 'solicitante' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    expect((await request(app).get('/usuarios/me').set(como(antigo))).status).toBe(200);
  });
});

describe('Revogação', () => {
  it('"sair de todos" derruba as outras sessões na hora', async () => {
    const email = await conta();
    const a = (await entrar(email)).body.token;
    const b = (await entrar(email)).body.token;

    await request(app).post('/auth/sair-de-todos').set(como(a));

    expect((await request(app).get('/usuarios/me').set(como(a))).status).toBe(401);
    expect((await request(app).get('/usuarios/me').set(como(b))).status).toBe(401);
    // E entrar de novo funciona normalmente.
    const c = (await entrar(email)).body.token;
    expect((await request(app).get('/usuarios/me').set(como(c))).status).toBe(200);
  });

  it('redefinir a senha derruba a sessão que estava aberta', async () => {
    const email = await conta();
    const antes = (await entrar(email)).body.token;

    const pedido = await recuperacao.solicitar(email, '127.0.0.1');
    await recuperacao.redefinir(pedido.token, 'senha-nova-123');

    const resp = await request(app).get('/usuarios/me').set(como(antes));
    expect(resp.status).toBe(401);
    expect(resp.body.erro.codigo).toBe('SESSAO_ENCERRADA');
  });
});

async function ligar2fa(token) {
  const { segredo, endereco } = (await request(app).post('/auth/2fa/iniciar').set(como(token))).body;
  const ativado = await request(app)
    .post('/auth/2fa/ativar')
    .set(como(token))
    .send({ senha: SENHA, codigo: codigoAgora(segredo) });
  return { segredo, endereco, ativado };
}

describe('Verificação em duas etapas', () => {
  it('ligar exige provar o código; devolve 8 códigos de recuperação e derruba as outras sessões', async () => {
    const email = await conta('gestor');
    const token = (await entrar(email)).body.token;
    const outra = (await entrar(email)).body.token;

    const { segredo, endereco } = (await request(app).post('/auth/2fa/iniciar').set(como(token))).body;
    expect(endereco).toMatch(/^otpauth:\/\/totp\/Conserva%20Predial%3A/);

    const errado = await request(app).post('/auth/2fa/ativar').set(como(token)).send({ senha: SENHA, codigo: '000000' });
    expect(errado.status).toBe(422);

    const certo = await request(app)
      .post('/auth/2fa/ativar')
      .set(como(token))
      .send({ senha: SENHA, codigo: codigoAgora(segredo) });
    expect(certo.status).toBe(200);
    expect(certo.body.codigos_recuperacao).toHaveLength(8);
    expect(certo.body.codigos_recuperacao[0]).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);

    // A sessão de quem ligou é reemitida; a outra cai.
    expect((await request(app).get('/usuarios/me').set(como(certo.body.token))).status).toBe(200);
    expect((await request(app).get('/usuarios/me').set(como(outra))).status).toBe(401);

    const situacao = await request(app).get('/auth/2fa').set(como(certo.body.token));
    expect(situacao.body).toMatchObject({ ativo: true, codigos_restantes: 8 });
  });

  it('ligar exige a senha: só a sessão aberta não cadastra outro aplicativo', async () => {
    const email = await conta('gestor');
    const token = (await entrar(email)).body.token;
    const { segredo } = (await request(app).post('/auth/2fa/iniciar').set(como(token))).body;

    const semSenha = await request(app)
      .post('/auth/2fa/ativar')
      .set(como(token))
      .send({ senha: 'chute', codigo: codigoAgora(segredo) });
    expect(semSenha.status).toBe(422);
    expect(semSenha.body.erro.codigo).toBe('SENHA_INCORRETA');
    expect((await request(app).get('/auth/2fa').set(como(token))).body.ativo).toBe(false);
  });

  it('pelo cookie, a sessão reemitida volta só no cookie, nunca no corpo', async () => {
    const email = await conta('gestor');
    const cookie = valorDo(cookieDa(await entrar(email)));
    const navegador = { Cookie: cookie, 'X-Conserva': '1' };
    const { segredo } = (await request(app).post('/auth/2fa/iniciar').set(navegador)).body;

    const ativado = await request(app)
      .post('/auth/2fa/ativar')
      .set(navegador)
      .send({ senha: SENHA, codigo: codigoAgora(segredo) });
    expect(ativado.status).toBe(200);
    expect(ativado.body.codigos_recuperacao).toHaveLength(8);
    expect(ativado.body.token).toBeUndefined();

    // O cookie novo é a sessão que vale; o antigo caiu junto com as outras.
    const novo = valorDo(cookieDa(ativado));
    expect((await request(app).get('/usuarios/me').set('Cookie', novo)).status).toBe(200);
    expect((await request(app).get('/usuarios/me').set('Cookie', cookie)).status).toBe(401);

    const desligado = await request(app)
      .post('/auth/2fa/desativar')
      .set({ Cookie: novo, 'X-Conserva': '1' })
      .send({ senha: SENHA, codigo: codigoAgora(segredo, 1) });
    expect(desligado.status).toBe(200);
    expect(desligado.body.token).toBeUndefined();
  });

  it('chutar o código na própria conta conta no limite do login', async () => {
    const email = await conta('gestor');
    const { ativado } = await ligar2fa((await entrar(email)).body.token);
    const token = ativado.body.token;
    const ip = `${IP}-conta`;
    const chutar = () =>
      request(app).post('/auth/2fa/codigos').set(como(token)).set('X-Real-IP', ip).send({ codigo: '000000' });

    for (let i = 0; i < 5; i++) expect((await chutar()).status).toBe(422);
    expect((await chutar()).status).toBe(429);
    // E a conta fica protegida também na porta da frente.
    expect((await entrar(email, ip)).status).toBe(429);
  });

  it('com 2FA, a senha certa devolve só um desafio — sem cookie e sem token', async () => {
    const email = await conta('gestor');
    const { segredo } = await ligar2fa((await entrar(email)).body.token);

    const resp = await entrar(email);
    expect(resp.status).toBe(200);
    expect(resp.body).toEqual({ requer_2fa: true, desafio: expect.any(String) });
    expect(cookieDa(resp)).toBeUndefined();

    // O desafio não é sessão.
    expect((await request(app).get('/usuarios/me').set(como(resp.body.desafio))).status).toBe(401);

    const final = await request(app)
      .post('/auth/login/2fa')
      .set('X-Real-IP', IP)
      .send({ desafio: resp.body.desafio, codigo: codigoAgora(segredo, 1) });
    expect(final.status).toBe(200);
    expect(cookieDa(final)).toMatch(/HttpOnly/);
    expect((await request(app).get('/usuarios/me').set(como(final.body.token))).status).toBe(200);
  });

  it('o mesmo código não entra duas vezes (nem dentro dos 30 segundos)', async () => {
    const email = await conta('gestor');
    const { segredo } = await ligar2fa((await entrar(email)).body.token);
    const codigo = codigoAgora(segredo, 1);

    const primeira = await request(app)
      .post('/auth/login/2fa')
      .set('X-Real-IP', IP)
      .send({ desafio: (await entrar(email)).body.desafio, codigo });
    expect(primeira.status).toBe(200);

    const repetida = await request(app)
      .post('/auth/login/2fa')
      .set('X-Real-IP', IP)
      .send({ desafio: (await entrar(email)).body.desafio, codigo });
    expect(repetida.status).toBe(401);
    expect(repetida.body.erro.codigo).toBe('CODIGO_INVALIDO');
  });

  it('código de recuperação entra uma vez só', async () => {
    const email = await conta('gestor');
    const { ativado } = await ligar2fa((await entrar(email)).body.token);
    const [codigo] = ativado.body.codigos_recuperacao;

    const usar = async (texto) =>
      request(app)
        .post('/auth/login/2fa')
        .set('X-Real-IP', IP)
        .send({ desafio: (await entrar(email)).body.desafio, codigo: texto });

    // Em minúsculas e sem o hífen também vale: é como a pessoa digita.
    expect((await usar(codigo.toLowerCase().replace('-', ''))).status).toBe(200);
    expect((await usar(codigo)).status).toBe(401);
  });

  it('errar o código conta no mesmo limite da senha', async () => {
    const email = await conta('gestor');
    await ligar2fa((await entrar(email)).body.token);
    const desafio = (await entrar(email)).body.desafio;
    const ip = `${IP}-limite`;

    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/auth/login/2fa').set('X-Real-IP', ip).send({ desafio, codigo: '000000' });
      expect(r.status).toBe(401);
    }
    const bloqueado = await request(app).post('/auth/login/2fa').set('X-Real-IP', ip).send({ desafio, codigo: '000000' });
    expect(bloqueado.status).toBe(429);
  });

  it('um token do tipo desafio não abre sessão, mesmo com a versão certa', async () => {
    // O desafio de verdade não carrega versão, e quem tem 2FA já subiu de
    // versão ao ligar: a recusa viria de graça. Aqui a versão bate, para
    // provar que o que barra é o tipo do token.
    const email = await conta('gestor');
    const { rows } = await pool.query('SELECT id, sessao_versao FROM usuario WHERE email = $1', [email]);
    const desafioComVersao = jwt.sign(
      { id: rows[0].id, tipo: '2fa', sv: rows[0].sessao_versao },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );
    expect((await request(app).get('/usuarios/me').set(como(desafioComVersao))).status).toBe(401);
  });

  it('digitar a senha de novo não zera as tentativas de código', async () => {
    const email = await conta('gestor');
    await ligar2fa((await entrar(email)).body.token);
    const ip = `${IP}-recomeco`;
    const errar = async () =>
      request(app)
        .post('/auth/login/2fa')
        .set('X-Real-IP', ip)
        .send({ desafio: (await entrar(email, ip)).body.desafio, codigo: '000000' });

    // Cinco erros, cada um depois de uma senha certa: quem roubou a senha não
    // ganha tentativas novas de código digitando-a de novo.
    for (let i = 0; i < 5; i++) expect((await errar()).status).toBe(401);
    const bloqueado = await request(app).post('/auth/login').set('X-Real-IP', ip).send({ email, senha: SENHA });
    expect(bloqueado.status).toBe(429);
  });

  it('desafio forjado ou vencido é recusado', async () => {
    const forjado = jwt.sign({ id: 1, tipo: '2fa' }, 'outra-chave');
    const r1 = await request(app).post('/auth/login/2fa').send({ desafio: forjado, codigo: '123456' });
    expect(r1.status).toBe(401);

    const vencido = jwt.sign({ id: 1, tipo: '2fa' }, process.env.JWT_SECRET, { expiresIn: -10 });
    const r2 = await request(app).post('/auth/login/2fa').send({ desafio: vencido, codigo: '123456' });
    expect(r2.status).toBe(401);
    expect(r2.body.erro.codigo).toBe('DESAFIO_INVALIDO');
  });

  it('desligar exige a senha e um código; só a sessão aberta não basta', async () => {
    const email = await conta('gestor');
    const { segredo, ativado } = await ligar2fa((await entrar(email)).body.token);
    const token = ativado.body.token;

    const semSenha = await request(app)
      .post('/auth/2fa/desativar')
      .set(como(token))
      .send({ senha: 'errada', codigo: codigoAgora(segredo, 1) });
    expect(semSenha.status).toBe(422);

    const certo = await request(app)
      .post('/auth/2fa/desativar')
      .set(como(token))
      .send({ senha: SENHA, codigo: codigoAgora(segredo, 1) });
    expect(certo.status).toBe(200);

    // De volta ao login de uma etapa.
    expect((await entrar(email)).body.token).toEqual(expect.any(String));
  });

  it('o administrador redefine o 2FA de quem perdeu o celular, e as sessões da pessoa caem', async () => {
    const email = await conta('gestor');
    const { ativado } = await ligar2fa((await entrar(email)).body.token);
    const sessaoDaPessoa = ativado.body.token;
    const { rows } = await pool.query('SELECT id FROM usuario WHERE email = $1', [email]);

    const admin = (await entrar(await conta('administrador'))).body.token;
    const lista = await request(app).get('/usuarios').set(como(admin));
    expect(lista.body.usuarios.find((u) => u.id === rows[0].id).dois_fatores).toBe(true);

    expect((await request(app).post(`/usuarios/${rows[0].id}/2fa/redefinir`).set(como(admin))).status).toBe(204);
    expect((await request(app).get('/usuarios/me').set(como(sessaoDaPessoa))).status).toBe(401);
    expect((await entrar(email)).body.token).toEqual(expect.any(String));
  });

  it('só o administrador redefine o 2FA de outra pessoa', async () => {
    const gestor = (await entrar(await conta('gestor'))).body.token;
    expect((await request(app).post('/usuarios/1/2fa/redefinir').set(como(gestor))).status).toBe(403);
  });
});

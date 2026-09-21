const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const recuperacao = require('../src/services/recuperacao.service');
const servicoEmail = require('../src/services/email.service');
const { MAX_PENDENTES } = recuperacao;

const { ipDaSuite } = require('./apoio/ip');

// Ver tests/apoio/ip.js: cada suíte se apresenta ao login como um cliente
// distinto, para não dividir a cota por IP com as suítes que rodam em paralelo.
const IP = ipDaSuite(__filename);

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

    const comNova = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'novaSenha456' });
    expect(comNova.status).toBe(200);

    const comAntiga = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha123' });
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
      await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'errada' });
    }
    const bloqueado = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha123' });
    expect(bloqueado.status).toBe(429);

    const token = await tokenMaisRecente();
    await request(app).post('/auth/redefinir-senha').send({ token, senha: 'senha123' });

    // Quem acabou de provar ser dono da conta não deve seguir barrado por
    // erros anteriores.
    const depois = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha123' });
    expect(depois.status).toBe(200);
  });

  it('recusa senha curta demais', async () => {
    const token = await tokenMaisRecente();
    const resp = await request(app).post('/auth/redefinir-senha').send({ token, senha: '123' });
    expect(resp.status).toBe(422);
  });
});

describe('Retenção do pedido de redefinição (LGPD)', () => {
  it('apaga pedidos velhos, junto com o IP que eles guardam', async () => {
    // A linha guarda o IP de quem pediu, e IP é dado pessoal. O token morre em
    // uma hora, mas a linha ficava para sempre: cada "esqueci minha senha"
    // deixava um endereço de rede no banco, sem prazo e sem ninguém para
    // apagá-lo.
    await pool.query(
      `INSERT INTO recuperacao_senha (usuario_id, token_hash, expira_em, ip, criado_em)
       VALUES ($1, $2, now() - interval '29 days', '203.0.113.7', now() - interval '30 days')`,
      [usuarioId, crypto.randomBytes(32).toString('hex')]
    );

    const antes = await pool.query(
      `SELECT count(*)::int AS total FROM recuperacao_senha
        WHERE usuario_id = $1 AND ip = '203.0.113.7'`,
      [usuarioId]
    );
    expect(antes.rows[0].total).toBe(1);

    // A limpeza não tem rota nem agendador: ela pega carona no próximo pedido.
    await recuperacao.solicitar(email, IP);

    const depois = await pool.query(
      `SELECT count(*)::int AS total FROM recuperacao_senha
        WHERE usuario_id = $1 AND ip = '203.0.113.7'`,
      [usuarioId]
    );
    expect(depois.rows[0].total).toBe(0);
  });

  it('não apaga o pedido que a pessoa acabou de fazer', async () => {
    // Uma limpeza gulosa demais arrancaria o token antes de a pessoa abrir o
    // e-mail — a falha seria "o link não funciona", sem pista nenhuma.
    await recuperacao.solicitar(email, IP);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS total FROM recuperacao_senha
        WHERE usuario_id = $1 AND usado_em IS NULL AND expira_em > now()`,
      [usuarioId]
    );
    expect(rows[0].total).toBe(1);
  });
});

describe('Pedido cujo e-mail não saiu não ocupa vaga', () => {
  const smtpOriginal = { host: process.env.SMTP_HOST, porta: process.env.SMTP_PORT };

  afterEach(() => {
    if (smtpOriginal.host === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = smtpOriginal.host;
    if (smtpOriginal.porta === undefined) delete process.env.SMTP_PORT;
    else process.env.SMTP_PORT = smtpOriginal.porta;
    jest.restoreAllMocks();
  });

  async function pendentesDe(id) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS total FROM recuperacao_senha
        WHERE usuario_id = $1 AND usado_em IS NULL AND expira_em > now()`,
      [id]
    );
    return rows[0].total;
  }

  it('descarta o pedido quando o SMTP recusa, em vez de trancar por uma hora', async () => {
    // Foi o que aconteceu de verdade: o Gmail recusou a senha, três cliques
    // criaram três pendentes cujos e-mails nunca saíram, e o quarto bateu no
    // MAX_PENDENTES. Sem token, sem tentativa, sem log — e a tela dizendo
    // "enviamos um link".
    process.env.SMTP_HOST = 'smtp.exemplo.invalido';
    process.env.SMTP_PORT = '587';
    jest.spyOn(servicoEmail, 'enviar').mockResolvedValue(false);

    for (let i = 0; i < MAX_PENDENTES + 2; i += 1) {
      const pedido = await recuperacao.solicitar(email, IP);
      expect(pedido).not.toBeNull();
      await recuperacao.enviarEmail(pedido, 'https://exemplo.test');
    }

    // O limite existe para conter quem pede dez vezes seguidas, não para
    // punir quem nunca recebeu nada.
    expect(await pendentesDe(usuarioId)).toBe(0);
  });

  it('mantém o pedido quando não há SMTP, porque aí o link vai para o log', async () => {
    // Sem servidor de e-mail o envio "falha" por definição, mas o controlador
    // registra o link e ele é usável. Matar o pedido aqui quebraria o
    // desenvolvimento e a instalação que ainda não tem e-mail.
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;

    const pedido = await recuperacao.solicitar(email, IP);
    await recuperacao.enviarEmail(pedido, 'https://exemplo.test');

    expect(await pendentesDe(usuarioId)).toBe(1);
  });

  it('mantém o pedido quando o e-mail sai de verdade', async () => {
    process.env.SMTP_HOST = 'smtp.exemplo.invalido';
    process.env.SMTP_PORT = '587';
    jest.spyOn(servicoEmail, 'enviar').mockResolvedValue(true);

    const pedido = await recuperacao.solicitar(email, IP);
    await recuperacao.enviarEmail(pedido, 'https://exemplo.test');

    expect(await pendentesDe(usuarioId)).toBe(1);
  });
});

describe('Para onde o link de redefinição aponta', () => {
  const original = process.env.URL_APP;

  afterEach(() => {
    if (original === undefined) delete process.env.URL_APP;
    else process.env.URL_APP = original;
  });

  async function linkEnviado() {
    // O link não volta na resposta — de propósito, senão o endpoint
    // entregaria a redefinição a quem só sabe o e-mail. Ele é lido do banco
    // pelo token, que é o mesmo caminho do e-mail.
    const espiao = jest.spyOn(servicoEmail, 'enviar').mockResolvedValue(true);
    await request(app).post('/auth/recuperar-senha').set('X-Real-IP', IP).send({ email });
    const texto = espiao.mock.calls.at(-1)[0].texto;
    espiao.mockRestore();
    return texto.match(/https?:\/\/\S+/)[0];
  }

  it('usa o endereço do app, não o da API que respondeu', async () => {
    // A API e o app são duas aplicações em domínios diferentes. Montar o link
    // a partir do host da requisição mandava a pessoa para
    // `.../redefinir-senha` no BACKEND, caminho que não existe lá: 404.
    process.env.URL_APP = 'https://conserva-predial.vercel.app';

    const link = await linkEnviado();

    expect(link).toContain('https://conserva-predial.vercel.app/redefinir-senha?token=');
    expect(link).not.toContain('backend');
  });

  it('não duplica a barra quando a variável termina com uma', async () => {
    process.env.URL_APP = 'https://conserva-predial.vercel.app/';

    const link = await linkEnviado();

    expect(link).not.toContain('app//redefinir');
  });

  it('sem a variável, cai no endereço da requisição — que serve em desenvolvimento', async () => {
    delete process.env.URL_APP;

    const link = await linkEnviado();

    expect(link).toMatch(/^https?:\/\/[^/]+\/redefinir-senha\?token=/);
  });
});

describe('O Host da requisição não decide para onde vai o link', () => {
  const original = process.env.URL_APP;

  afterEach(() => {
    if (original === undefined) delete process.env.URL_APP;
    else process.env.URL_APP = original;
    jest.restoreAllMocks();
  });

  it('sem URL_APP, um Host forjado não vira link de redefinição', async () => {
    // O endpoint é público. Sem esta barreira, qualquer um manda o e-mail da
    // vítima com `Host: sitedoatacante.exemplo` e o token dela chega na caixa
    // dela apontando para o endereço do atacante — que só precisa esperar o
    // clique. `trust proxy`, ligado para corrigir o `http://`, deixaria o
    // atacante escolher o esquema também.
    delete process.env.URL_APP;
    const espiao = jest.spyOn(servicoEmail, 'enviar').mockResolvedValue(true);

    const resp = await request(app)
      .post('/auth/recuperar-senha')
      .set('X-Real-IP', IP)
      .set('Host', 'sitedoatacante.exemplo')
      .send({ email });

    // A resposta é a de sempre: distinguir aqui contaria quem tem cadastro.
    expect(resp.status).toBe(200);
    expect(espiao).not.toHaveBeenCalled();
  });

  it('e o pedido não fica ocupando vaga por uma hora', async () => {
    delete process.env.URL_APP;
    jest.spyOn(servicoEmail, 'enviar').mockResolvedValue(true);

    await request(app)
      .post('/auth/recuperar-senha')
      .set('X-Real-IP', IP)
      .set('Host', 'sitedoatacante.exemplo')
      .send({ email });

    const { rows } = await pool.query(
      `SELECT count(*)::int AS total FROM recuperacao_senha
        WHERE usuario_id = $1 AND usado_em IS NULL AND expira_em > now()`,
      [usuarioId]
    );
    expect(rows[0].total).toBe(0);
  });

  it('com URL_APP configurada, o Host forjado é ignorado', async () => {
    process.env.URL_APP = 'https://conserva-predial.vercel.app';
    const espiao = jest.spyOn(servicoEmail, 'enviar').mockResolvedValue(true);

    await request(app)
      .post('/auth/recuperar-senha')
      .set('X-Real-IP', IP)
      .set('Host', 'sitedoatacante.exemplo')
      .send({ email });

    const texto = espiao.mock.calls.at(-1)[0].texto;
    expect(texto).toContain('https://conserva-predial.vercel.app/redefinir-senha');
    expect(texto).not.toContain('sitedoatacante');
  });
});

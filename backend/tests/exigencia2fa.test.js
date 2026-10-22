const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const configuracaoService = require('../src/services/configuracao.service');
const { codigoNoPasso, passoDe } = require('../src/utils/totp');
const { ipDaSuite } = require('./apoio/ip');

/**
 * Verificação em duas etapas exigida da gestão (configuração
 * `exigir_2fa_gestao`).
 *
 * Como na suíte da aprovação de cadastro, a exigência é ligada só para este
 * processo, trocando a leitura da configuração: ligada no banco, ela mandaria
 * para a tela de ativação os gestores de todas as outras suítes que rodassem
 * junto. O caminho do banco é conferido à parte, numa transação desfeita.
 */

const IP = ipDaSuite(__filename);
const SENHA = 'senha-teste-123';
const MARCA = `exige2fa${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
let n = 0;

let exigencia;
function exigir(ligada) {
  exigencia?.mockRestore();
  exigencia = jest.spyOn(configuracaoService, 'exige2faGestao').mockResolvedValue(ligada);
}

const entrar = (email) =>
  request(app).post('/auth/login').set('X-Real-IP', `${IP}-${Math.random()}`).send({ email, senha: SENHA });
const como = (token) => ({ Authorization: `Bearer ${token}` });
const codigoAgora = (segredo) => codigoNoPasso(segredo, passoDe(Date.now()));

async function conta(perfil) {
  const email = `${MARCA}_${perfil}_${n++}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Exige ${perfil}`, email, senha: SENHA });
  await pool.query(
    'UPDATE usuario SET perfil = $1, ativo = TRUE, cadastro_pendente_desde = NULL WHERE email = $2',
    [perfil, email]
  );
  return email;
}

async function ligar2fa(token) {
  const { segredo } = (await request(app).post('/auth/2fa/iniciar').set(como(token))).body;
  const ativado = await request(app)
    .post('/auth/2fa/ativar')
    .set(como(token))
    .send({ senha: SENHA, codigo: codigoAgora(segredo) });
  return { segredo, ativado };
}

afterEach(() => exigencia?.mockRestore());
afterAll(async () => {
  // Se a trava de "só liga quem tem a própria verificação" quebrar, o teste de
  // recusa grava a exigência ligada de verdade, e todas as suítes seguintes
  // tropeçam nela. Ela não tem linha por padrão: sai a que sobrar.
  await pool.query("DELETE FROM configuracao WHERE chave = 'exigir_2fa_gestao'");
  await pool.end();
});

describe('Exigência desligada', () => {
  it('gestão sem a verificação segue como antes', async () => {
    exigir(false);
    const login = await entrar(await conta('gestor'));
    expect(login.status).toBe(200);
    expect(login.body.usuario.dois_fatores_pendente).toBe(false);
    expect((await request(app).get('/chamados').set(como(login.body.token))).status).toBe(200);
  });
});

describe('Exigência ligada', () => {
  it('gestor sem a verificação entra, mas só alcança a própria conta até ligar', async () => {
    exigir(true);
    const login = await entrar(await conta('gestor'));
    expect(login.status).toBe(200);
    expect(login.body.usuario.dois_fatores_pendente).toBe(true);
    const token = login.body.token;

    const recusa = await request(app).get('/chamados').set(como(token));
    expect(recusa.status).toBe(403);
    expect(recusa.body.erro.codigo).toBe('DOIS_FATORES_OBRIGATORIO');
    expect((await request(app).get('/usuarios/me').set(como(token))).status).toBe(403);

    // O caminho para ligar fica aberto.
    expect((await request(app).get('/auth/2fa').set(como(token))).status).toBe(200);
    const { ativado } = await ligar2fa(token);
    expect(ativado.status).toBe(200);

    // Ligar reemite a sessão (as outras caem); com ela, tudo volta.
    const liberado = await request(app).get('/chamados').set(como(ativado.body.token));
    expect(liberado.status).toBe(200);
  });

  it('administrador sem a verificação também fica restrito, inclusive para mudar configuração', async () => {
    exigir(true);
    const login = await entrar(await conta('administrador'));
    const recusa = await request(app)
      .patch('/configuracoes')
      .set(como(login.body.token))
      .send({ exigir_2fa_gestao: false });
    expect(recusa.status).toBe(403);
    expect(recusa.body.erro.codigo).toBe('DOIS_FATORES_OBRIGATORIO');
  });

  it('solicitante e técnico não são alcançados', async () => {
    exigir(true);
    for (const perfil of ['solicitante', 'tecnico']) {
      const login = await entrar(await conta(perfil));
      expect([perfil, login.body.usuario.dois_fatores_pendente]).toEqual([perfil, false]);
      expect([perfil, (await request(app).get('/chamados').set(como(login.body.token))).status]).toEqual([perfil, 200]);
    }
  });

  it('gestão que já tem a verificação entra pelo segundo fator sem restrição', async () => {
    exigir(false);
    const email = await conta('gestor');
    const { segredo } = await ligar2fa((await entrar(email)).body.token);

    exigir(true);
    const primeira = await entrar(email);
    expect(primeira.body.requer_2fa).toBe(true);
    // Um passo adiante: o código do passo atual já foi gasto ao ligar.
    const codigo = codigoNoPasso(segredo, passoDe(Date.now()) + 1);
    const segunda = await request(app)
      .post('/auth/login/2fa')
      .set('X-Real-IP', `${IP}-${Math.random()}`)
      .send({ desafio: primeira.body.desafio, codigo });
    expect(segunda.status).toBe(200);
    expect(segunda.body.usuario.dois_fatores_pendente).toBe(false);
    expect((await request(app).get('/chamados').set(como(segunda.body.token))).status).toBe(200);
  });

  it('gestão não desliga a verificação exigida', async () => {
    exigir(false);
    const email = await conta('gestor');
    const { segredo, ativado } = await ligar2fa((await entrar(email)).body.token);

    exigir(true);
    const resp = await request(app)
      .post('/auth/2fa/desativar')
      .set(como(ativado.body.token))
      .send({ senha: SENHA, codigo: codigoNoPasso(segredo, passoDe(Date.now()) + 1) });
    expect(resp.status).toBe(409);
    expect(resp.body.erro.codigo).toBe('DOIS_FATORES_EXIGIDO');
  });

  it('quem está restrito ainda encerra as próprias sessões', async () => {
    exigir(true);
    const login = await entrar(await conta('gestor'));
    expect((await request(app).post('/auth/sair-de-todos').set(como(login.body.token))).status).toBe(204);
  });
});

describe('Ligar a exigência', () => {
  it('administrador sem a própria verificação não liga (409); gestor não muda (403)', async () => {
    exigir(false);
    const admin = (await entrar(await conta('administrador'))).body.token;
    const semAPropria = await request(app).patch('/configuracoes').set(como(admin)).send({ exigir_2fa_gestao: true });
    expect(semAPropria.status).toBe(409);
    expect(semAPropria.body.erro.codigo).toBe('SEM_2FA_PROPRIO');

    const gestor = (await entrar(await conta('gestor'))).body.token;
    expect(
      (await request(app).patch('/configuracoes').set(como(gestor)).send({ exigir_2fa_gestao: false })).status
    ).toBe(403);
  });

  it('a lista de configurações traz a exigência', async () => {
    exigir(false);
    const admin = (await entrar(await conta('administrador'))).body.token;
    const resp = await request(app).get('/configuracoes').set(como(admin));
    expect(typeof resp.body.configuracoes.exigir_2fa_gestao).toBe('boolean');
  });

  // O caminho do banco, numa transação desfeita: ligada aqui de verdade, a
  // exigência alcançaria as outras suítes.
  it('quem tem a verificação liga, e a leitura do banco devolve ligada', async () => {
    const email = await conta('administrador');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'UPDATE usuario SET totp_ativado_em = now() WHERE email = $1 RETURNING id',
        [email]
      );
      const lista = await configuracaoService.definir({ exigir_2fa_gestao: true }, { id: rows[0].id }, client);
      expect(lista.exigir_2fa_gestao).toBe(true);
      expect(await configuracaoService.exige2faGestao(client)).toBe(true);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

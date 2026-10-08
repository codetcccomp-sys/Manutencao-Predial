const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const emailService = require('../src/services/email.service');
const configuracaoService = require('../src/services/configuracao.service');
const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);

/**
 * RF01: autocadastro sob aprovação.
 *
 * A exigência é uma configuração do banco, global. Ligá-la no banco faria as
 * outras suítes — que se cadastram e entram logo em seguida — receberem
 * "aguardando aprovação" sempre que rodassem junto (`npm run test:paralelo`).
 * O app roda neste mesmo processo (supertest), então a suíte liga a exigência
 * só para si, trocando a leitura da configuração; o caminho do banco é
 * conferido à parte, numa transação que não chega a valer.
 */

const MARCA = `aprov${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
let n = 0;
const emailNovo = () => `${MARCA}_${n++}@exemplo.com`;

let admin;
let gestor;
let tecnico;

let exigencia;
function exigirAprovacao(ligada) {
  exigencia?.mockRestore();
  exigencia = jest.spyOn(configuracaoService, 'cadastroExigeAprovacao').mockResolvedValue(ligada);
}

const registrar = (email, senha = 'senha123') =>
  request(app).post('/auth/registrar').send({ nome: 'Pedido de Cadastro', email, senha });

const entrar = (email, senha = 'senha123') =>
  request(app).post('/auth/login').set('X-Real-IP', `${IP}-${Math.random()}`).send({ email, senha });

// Conta pronta para entrar, aprovação ligada ou não: quem age nos testes não
// é o pedido que está sendo testado.
async function conta(perfil) {
  const email = emailNovo();
  await registrar(email);
  await pool.query(
    'UPDATE usuario SET perfil = $1, ativo = TRUE, cadastro_pendente_desde = NULL WHERE email = $2',
    [perfil, email]
  );
  const login = await entrar(email);
  return { ...login.body.usuario, token: login.body.token };
}

async function pedido() {
  const email = emailNovo();
  const resp = await registrar(email);
  return { email, id: resp.body.usuario.id, resp };
}

beforeAll(async () => {
  admin = await conta('administrador');
  gestor = await conta('gestor');
  tecnico = await conta('tecnico');
});

beforeEach(() => exigirAprovacao(true));
afterEach(() => exigencia?.mockRestore());

afterAll(async () => {
  await pool.end();
});

describe('Cadastro com aprovação ligada', () => {
  it('o pedido fica pendente e não entra; senha errada não revela que ele existe', async () => {
    const { email, resp } = await pedido();

    expect(resp.status).toBe(201);
    expect(resp.body.aguardando_aprovacao).toBe(true);
    expect(resp.body.usuario.ativo).toBe(false);

    const certa = await entrar(email);
    expect(certa.status).toBe(403);
    expect(certa.body.erro.codigo).toBe('CADASTRO_PENDENTE');
    expect(certa.body.token).toBeUndefined();
    expect(certa.headers['set-cookie']).toBeUndefined();

    const errada = await entrar(email, 'outra-senha');
    expect(errada.status).toBe(401);
    expect(errada.body.erro.codigo).toBe('CREDENCIAIS_INVALIDAS');
  });

  it('pedido pendente não gera link de recuperação de senha', async () => {
    const { id, email } = await pedido();
    const resp = await request(app)
      .post('/auth/recuperar-senha')
      .set('X-Real-IP', `${IP}-${Math.random()}`)
      .send({ email });

    expect(resp.status).toBe(200);
    const { rows } = await pool.query('SELECT 1 FROM recuperacao_senha WHERE usuario_id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('a gestão vê os pedidos numa lista própria, fora da lista de contas', async () => {
    const { id } = await pedido();

    const pendentes = await request(app)
      .get('/usuarios')
      .query({ situacao: 'pendentes' })
      .set('Authorization', `Bearer ${gestor.token}`);
    expect(pendentes.status).toBe(200);
    const meu = pendentes.body.usuarios.find((u) => u.id === id);
    expect(meu.cadastro_pendente_desde).toBeTruthy();

    // Na lista comum, até com inativos, o pedido ganharia um "Reativar".
    const contas = await request(app)
      .get('/usuarios')
      .query({ incluir_inativos: 'true' })
      .set('Authorization', `Bearer ${admin.token}`);
    expect(contas.body.usuarios.some((u) => u.id === id)).toBe(false);
  });

  it('aprovar libera o login, avisa por e-mail e só mexe em quem está pendente', async () => {
    const { id, email } = await pedido();
    const desligada = await conta('solicitante');
    await pool.query('UPDATE usuario SET ativo = FALSE WHERE id = $1', [desligada.id]);
    const enviar = jest.spyOn(emailService, 'enviar').mockResolvedValue(true);

    const resp = await request(app)
      .post('/usuarios/aprovar')
      .set('Authorization', `Bearer ${gestor.token}`)
      .send({ ids: [id, desligada.id] });

    expect(resp.status).toBe(200);
    expect(resp.body.aprovados.map((a) => a.id)).toEqual([id]);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0][0]).toMatchObject({ para: email, assunto: expect.stringContaining('aprovado') });
    enviar.mockRestore();

    // Aprovar não é a porta dos fundos para reativar conta desligada.
    const { rows } = await pool.query('SELECT ativo FROM usuario WHERE id = $1', [desligada.id]);
    expect(rows[0].ativo).toBe(false);

    const login = await entrar(email);
    expect(login.status).toBe(200);
    expect(login.body.usuario.perfil).toBe('solicitante');
  });

  it('recusar apaga o pedido e deixa o e-mail livre para pedir de novo', async () => {
    const { id, email } = await pedido();

    const resp = await request(app)
      .post('/usuarios/recusar')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ ids: [id] });

    expect(resp.status).toBe(200);
    expect(resp.body.recusados).toEqual([id]);
    const { rows } = await pool.query('SELECT 1 FROM usuario WHERE id = $1', [id]);
    expect(rows).toHaveLength(0);

    const denovo = await registrar(email);
    expect(denovo.status).toBe(201);
  });

  it('recusar não apaga conta que não é pedido', async () => {
    const comum = await conta('solicitante');
    const resp = await request(app)
      .post('/usuarios/recusar')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ ids: [comum.id] });

    expect(resp.body.recusados).toEqual([]);
    const { rows } = await pool.query('SELECT 1 FROM usuario WHERE id = $1', [comum.id]);
    expect(rows).toHaveLength(1);
  });

  it('técnico e solicitante não aprovam nem recusam', async () => {
    const { id } = await pedido();
    const solicitante = await conta('solicitante');
    for (const quem of [tecnico, solicitante]) {
      for (const acao of ['aprovar', 'recusar']) {
        const resp = await request(app)
          .post(`/usuarios/${acao}`)
          .set('Authorization', `Bearer ${quem.token}`)
          .send({ ids: [id] });
        expect(resp.status).toBe(403);
      }
    }
  });

  it('pedido pendente não é alterado pela edição comum', async () => {
    const { id } = await pedido();
    const resp = await request(app)
      .patch(`/usuarios/${id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ ativo: true });
    expect(resp.status).toBe(409);
    expect(resp.body.erro.codigo).toBe('CADASTRO_PENDENTE');
  });

  it('lista de ids inválida é recusada', async () => {
    for (const ids of [undefined, [], ['1'], [0], Array.from({ length: 101 }, (_, i) => i + 1)]) {
      const resp = await request(app)
        .post('/usuarios/aprovar')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ ids });
      expect(resp.status).toBe(422);
    }
  });
});

describe('A exigência de aprovação', () => {
  it('desligada, o cadastro entra direto, como antes', async () => {
    exigirAprovacao(false);
    const { email, resp } = await pedido();
    expect(resp.body.aguardando_aprovacao).toBe(false);
    expect(resp.body.usuario.ativo).toBe(true);
    expect((await entrar(email)).status).toBe(200);
  });

  it('é lida do banco, e a migração a deixa desligada', async () => {
    exigencia.mockRestore();
    // Numa transação desfeita no fim: ligada de verdade, só aqui dentro.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      expect(await configuracaoService.cadastroExigeAprovacao(client)).toBe(false);
      await client.query(
        "UPDATE configuracao SET valor = 'true'::jsonb WHERE chave = 'cadastro_exige_aprovacao'"
      );
      expect(await configuracaoService.cadastroExigeAprovacao(client)).toBe(true);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('a gestão lê; só a administração liga e desliga, e só com verdadeiro ou falso', async () => {
    const lida = await request(app).get('/configuracoes').set('Authorization', `Bearer ${gestor.token}`);
    expect(lida.status).toBe(200);
    expect(lida.body.configuracoes.cadastro_exige_aprovacao).toBe(false);

    const pelaGestao = await request(app)
      .patch('/configuracoes')
      .set('Authorization', `Bearer ${gestor.token}`)
      .send({ cadastro_exige_aprovacao: false });
    expect(pelaGestao.status).toBe(403);

    const texto = await request(app)
      .patch('/configuracoes')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ cadastro_exige_aprovacao: 'sim' });
    expect(texto.status).toBe(422);

    const desconhecida = await request(app)
      .patch('/configuracoes')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ outra_coisa: true });
    expect(desconhecida.status).toBe(422);

    // Grava o valor que já está (desligado): a escrita é conferida sem que as
    // suítes que rodam junto sintam a mudança.
    const pelaAdministracao = await request(app)
      .patch('/configuracoes')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ cadastro_exige_aprovacao: false });
    expect(pelaAdministracao.status).toBe(200);
    expect(pelaAdministracao.body.configuracoes.cadastro_exige_aprovacao).toBe(false);
    const { rows } = await pool.query(
      "SELECT atualizado_por FROM configuracao WHERE chave = 'cadastro_exige_aprovacao'"
    );
    expect(rows[0].atualizado_por).toBe(admin.id);
    // Quem gravou fica referenciado e a limpeza não apagaria a conta de teste.
    await pool.query("UPDATE configuracao SET atualizado_por = NULL WHERE chave = 'cadastro_exige_aprovacao'");
  });
});

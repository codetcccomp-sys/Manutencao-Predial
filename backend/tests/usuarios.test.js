const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const usuariosService = require('../src/services/usuarios.service');

const { ipDaSuite } = require('./apoio/ip');

// Ver tests/apoio/ip.js: cada suíte se apresenta ao login como um cliente
// distinto, para não dividir a cota por IP com as suítes que rodam em paralelo.
const IP = ipDaSuite(__filename);

let admin;
let gestor;
let solicitante;

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_usr_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Usr ${perfil}`, email, senha: 'senha-teste-123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha-teste-123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

beforeAll(async () => {
  admin = await criarUsuarioELogar('administrador');
  gestor = await criarUsuarioELogar('gestor');
  solicitante = await criarUsuarioELogar('solicitante');
});

afterAll(async () => {
  await pool.end();
});

const comoAdmin = () => ({ Authorization: `Bearer ${admin.token}` });

describe('POST /usuarios', () => {
  it('administrador cria usuário com perfil escolhido', async () => {
    const resp = await request(app)
      .post('/usuarios')
      .set(comoAdmin())
      .send({
        nome: 'Técnico Novo',
        email: `tecnico_novo_${Date.now()}@exemplo.com`,
        senha: 'senha-teste-123',
        perfil: 'tecnico',
      });

    expect(resp.status).toBe(201);
    expect(resp.body.usuario.perfil).toBe('tecnico');
  });

  it('gestor não cria usuário', async () => {
    const resp = await request(app)
      .post('/usuarios')
      .set('Authorization', `Bearer ${gestor.token}`)
      .send({ nome: 'X', email: `x_${Date.now()}@exemplo.com`, senha: 'senha-teste-123', perfil: 'tecnico' });

    expect(resp.status).toBe(403);
  });
});

describe('GET /usuarios', () => {
  it('omite inativos por padrão e os inclui quando pedido', async () => {
    const criado = await request(app)
      .post('/usuarios')
      .set(comoAdmin())
      .send({
        nome: 'Vai Desligar',
        email: `desligado_${Date.now()}@exemplo.com`,
        senha: 'senha-teste-123',
        perfil: 'tecnico',
      });
    const id = criado.body.usuario.id;

    await request(app).patch(`/usuarios/${id}`).set(comoAdmin()).send({ ativo: false });

    const padrao = await request(app).get('/usuarios?perfil=tecnico').set(comoAdmin());
    expect(padrao.body.usuarios.map((u) => u.id)).not.toContain(id);

    const completo = await request(app)
      .get('/usuarios?perfil=tecnico&incluir_inativos=true')
      .set(comoAdmin());
    expect(completo.body.usuarios.map((u) => u.id)).toContain(id);
  });

  it('solicitante não lista usuários', async () => {
    const resp = await request(app)
      .get('/usuarios')
      .set('Authorization', `Bearer ${solicitante.token}`);
    expect(resp.status).toBe(403);
  });
});

describe('PATCH /usuarios/:id', () => {
  it('altera perfil de outro usuário', async () => {
    const resp = await request(app)
      .patch(`/usuarios/${solicitante.usuario.id}`)
      .set(comoAdmin())
      .send({ perfil: 'gestor' });

    expect(resp.status).toBe(200);
    expect(resp.body.usuario.perfil).toBe('gestor');

    // Devolve ao estado anterior para não interferir nos outros testes.
    await request(app)
      .patch(`/usuarios/${solicitante.usuario.id}`)
      .set(comoAdmin())
      .send({ perfil: 'solicitante' });
  });

  it('impede desativar a própria conta', async () => {
    const resp = await request(app)
      .patch(`/usuarios/${admin.usuario.id}`)
      .set(comoAdmin())
      .send({ ativo: false });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('AUTO_DESATIVACAO');
  });

  it('impede alterar o próprio perfil', async () => {
    const resp = await request(app)
      .patch(`/usuarios/${admin.usuario.id}`)
      .set(comoAdmin())
      .send({ perfil: 'solicitante' });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('AUTO_REBAIXAMENTO');
  });

  it('impede remover o último administrador ativo', async () => {
    const outroAdmin = await criarUsuarioELogar('administrador');

    // Com dois administradores, rebaixar um é permitido.
    const permitido = await request(app)
      .patch(`/usuarios/${outroAdmin.usuario.id}`)
      .set(comoAdmin())
      .send({ perfil: 'gestor' });
    expect(permitido.status).toBe(200);

    // Agora sobrou um só: outro administrador tenta desativá-lo.
    const promovido = await criarUsuarioELogar('administrador');
    const restantes = await pool.query(
      "SELECT count(*)::int AS n FROM usuario WHERE perfil='administrador' AND ativo=TRUE"
    );
    expect(restantes.rows[0].n).toBeGreaterThanOrEqual(2);

    // Desativa todos menos um, depois tenta o último.
    //
    // Este é o único teste da suíte que mexe em linhas que não criou — a trava
    // do último administrador só se verifica sobre o banco inteiro. Por isso
    // devolve o que desativou: sem o RETURNING e o finally, ele derrubava o
    // administrador semeado para os testes de ponta a ponta, que passavam a
    // falhar no login sem nenhuma relação aparente com esta suíte.
    const { rows: desativados } = await pool.query(
      `UPDATE usuario SET ativo = FALSE
        WHERE perfil = 'administrador' AND ativo = TRUE AND id NOT IN ($1, $2)
        RETURNING id`,
      [admin.usuario.id, promovido.usuario.id]
    );

    try {
      await request(app)
        .patch(`/usuarios/${promovido.usuario.id}`)
        .set(comoAdmin())
        .send({ ativo: false });

      // A versão anterior deste teste usava o token do `promovido` DEPOIS de
      // desativá-lo, e esperava a trava do último administrador. Funcionava
      // porque o token de uma conta desligada continuava valendo por 8 horas
      // — o teste dependia do buraco que ele mesmo não via. Agora a conta
      // desligada é recusada na porta:
      const resp = await request(app)
        .patch(`/usuarios/${admin.usuario.id}`)
        .set('Authorization', `Bearer ${promovido.token}`)
        .send({ ativo: false });
      expect(resp.status).toBe(401);
      expect(resp.body.erro.codigo).toBe('SESSAO_ENCERRADA');

      // E a trava deixou de ser alcançável pela API: quem chama precisa ser um
      // administrador ATIVO e diferente do alvo, então sempre sobra pelo menos
      // um. Ela fica como defesa para chamada direta ao serviço (script de
      // manutenção, rotina futura), e é nesse nível que se testa.
      await expect(
        usuariosService.atualizar(admin.usuario.id, { ativo: false }, { id: promovido.usuario.id })
      ).rejects.toMatchObject({ code: 'ULTIMO_ADMINISTRADOR' });
    } finally {
      await pool.query('UPDATE usuario SET ativo = TRUE WHERE id = ANY($1::int[])', [
        desativados.map((u) => u.id),
      ]);
    }
  });

  it('gestor não altera usuários', async () => {
    const resp = await request(app)
      .patch(`/usuarios/${solicitante.usuario.id}`)
      .set('Authorization', `Bearer ${gestor.token}`)
      .send({ perfil: 'tecnico' });

    expect(resp.status).toBe(403);
  });
});

describe('Técnico com chamado em aberto não sai da fila sem reatribuição', () => {
  // A conta desativada não entra mais, e o chamado continua designado a ela:
  // fora do filtro "sem técnico" (que procura tecnico_id nulo) e fora da fila
  // de qualquer pessoa. Parado em silêncio até estourar o prazo.
  async function tecnicoComChamado() {
    const tecnico = await criarUsuarioELogar('tecnico');
    // O local é da suíte, e não "o primeiro do banco": num banco novo (o do CI)
    // não há local nenhum até alguma outra suíte criar um, e a ordem das suítes
    // não é garantida.
    const local = [{ id: await garantirLocal({ unidade: 'Unidade da suíte de usuários' }) }];
    const { rows: categoria } = await pool.query('SELECT id FROM categoria LIMIT 1');
    const { body } = await request(app)
      .post('/chamados')
      .set(comoAdmin())
      .send({
        titulo: 'Chamado com técnico que vai sair',
        descricao: 'Designado a quem será desativado.',
        categoria_id: categoria[0].id,
        local_id: local[0].id,
      });
    await pool.query("UPDATE chamado SET tecnico_id = $1, estado = 'em_andamento' WHERE id = $2", [
      tecnico.usuario.id,
      body.chamado.id,
    ]);
    return { tecnico: tecnico.usuario, chamadoId: body.chamado.id };
  }

  const situacao = async (id) =>
    (await pool.query('SELECT ativo, perfil FROM usuario WHERE id = $1', [id])).rows[0];

  it('recusa desativar, e a conta segue como estava', async () => {
    const { tecnico } = await tecnicoComChamado();

    const resp = await request(app)
      .patch(`/usuarios/${tecnico.id}`)
      .set(comoAdmin())
      .send({ ativo: false });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('CHAMADOS_EM_ABERTO');
    expect(resp.body.erro.mensagem).toMatch(/1 chamado em aberto/);
    expect(await situacao(tecnico.id)).toEqual({ ativo: true, perfil: 'tecnico' });
  });

  it('recusa tirar o perfil de técnico: a fila some da tela dele do mesmo jeito', async () => {
    const { tecnico } = await tecnicoComChamado();

    const resp = await request(app)
      .patch(`/usuarios/${tecnico.id}`)
      .set(comoAdmin())
      .send({ perfil: 'solicitante' });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('CHAMADOS_EM_ABERTO');
    expect((await situacao(tecnico.id)).perfil).toBe('tecnico');
  });

  it('depois de o chamado ser encerrado, desativa', async () => {
    const { tecnico, chamadoId } = await tecnicoComChamado();
    await pool.query("UPDATE chamado SET estado = 'cancelado' WHERE id = $1", [chamadoId]);

    await request(app).patch(`/usuarios/${tecnico.id}`).set(comoAdmin()).send({ ativo: false }).expect(200);

    expect((await situacao(tecnico.id)).ativo).toBe(false);
  });

  it('só conta o que está em aberto: técnico sem pendência desativa e muda de perfil', async () => {
    const livre = await criarUsuarioELogar('tecnico');
    await request(app)
      .patch(`/usuarios/${livre.usuario.id}`)
      .set(comoAdmin())
      .send({ perfil: 'gestor' })
      .expect(200);
    await request(app)
      .patch(`/usuarios/${livre.usuario.id}`)
      .set(comoAdmin())
      .send({ ativo: false })
      .expect(200);
  });

  it('o bloqueio vale só para sair: renomear e reativar seguem livres', async () => {
    const { tecnico } = await tecnicoComChamado();

    await request(app)
      .patch(`/usuarios/${tecnico.id}`)
      .set(comoAdmin())
      .send({ nome: 'Técnico Renomeado' })
      .expect(200);
    await request(app).patch(`/usuarios/${tecnico.id}`).set(comoAdmin()).send({ ativo: true }).expect(200);
  });
});

describe('Nome sem espaço sobrando', () => {
  it('apara o nome no cadastro em vez de gravá-lo cru', async () => {
    const email = `apara_${Date.now()}@exemplo.com`;

    const resp = await request(app)
      .post('/usuarios')
      .set(comoAdmin())
      .send({ nome: '  Maria   Silva  ', email, senha: 'senha-teste-123', perfil: 'tecnico' });

    // O e-mail já era normalizado; o nome entrava cru. O espaço passa
    // despercebido no cadastro e reaparece no cabeçalho, na autoria do
    // comentário e no "Olá, Fulano ." do e-mail.
    expect(resp.status).toBe(201);
    expect(resp.body.usuario.nome).toBe('Maria Silva');

    const { rows } = await pool.query('SELECT nome FROM usuario WHERE email = $1', [email]);
    expect(rows[0].nome).toBe('Maria Silva');
  });

  it('recusa nome feito só de espaços, em vez de gravar vazio', async () => {
    // Três espaços passavam pelo mínimo de três caracteres, porque a medida
    // era feita no valor cru. Aparar antes de medir é o que fecha o buraco.
    const resp = await request(app)
      .post('/usuarios')
      .set(comoAdmin())
      .send({
        nome: '   ',
        email: `vazio_${Date.now()}@exemplo.com`,
        senha: 'senha-teste-123',
        perfil: 'tecnico',
      });

    expect(resp.status).toBe(422);
  });

  it('também apara ao renomear', async () => {
    const alvo = await criarUsuarioELogar('tecnico');

    const resp = await request(app)
      .patch(`/usuarios/${alvo.usuario.id}`)
      .set(comoAdmin())
      .send({ nome: '  João Técnico  ' });

    expect(resp.status).toBe(200);
    expect(resp.body.usuario.nome).toBe('João Técnico');
  });
});

describe('Nome nulo não apaga o nome', () => {
  it('PATCH com nome: null é tratado como campo ausente', async () => {
    const alvo = await criarUsuarioELogar('tecnico');
    const nomeOriginal = alvo.usuario.nome;

    // `null` escapa do validador (ele pula null antes de medir minLength) e,
    // depois que o serviço passou a normalizar, `normalizarNome(null)` devolvia
    // '' — que ia para o UPDATE e apagava o nome. Antes da normalização o NOT
    // NULL da tabela barrava; o conserto de um abriu o buraco do outro.
    const resp = await request(app)
      .patch(`/usuarios/${alvo.usuario.id}`)
      .set(comoAdmin())
      .send({ nome: null, perfil: 'gestor' });

    expect(resp.status).toBe(200);

    const { rows } = await pool.query('SELECT nome FROM usuario WHERE id = $1', [alvo.usuario.id]);
    expect(rows[0].nome).toBe(nomeOriginal);
    expect(rows[0].nome).not.toBe('');
  });

  it('e sozinho não conta como campo para atualizar', async () => {
    const alvo = await criarUsuarioELogar('tecnico');

    const resp = await request(app)
      .patch(`/usuarios/${alvo.usuario.id}`)
      .set(comoAdmin())
      .send({ nome: null });

    // Sem nenhum campo de verdade, o pedido não tem o que fazer.
    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('NADA_A_ATUALIZAR');
  });
});

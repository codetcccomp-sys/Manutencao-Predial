const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);

/**
 * Pedido de remoção atendido por anonimização (LGPD, docs/lgpd.md §5).
 *
 * A política decidida não apaga a pessoa: apaga quem ela era e preserva o
 * registro da manutenção. Apagar a linha de `usuario` arrastaria chamado,
 * comentário, avaliação, anexo e histórico — o prédio perderia a memória do
 * que foi consertado por causa de um pedido sobre dado pessoal.
 *
 * O que estes testes protegem, acima de tudo, é essa separação. É uma ação
 * sem desfazer, então errar aqui não tem conserto depois.
 */

let admin;
let outroAdmin;

async function novaConta(perfil = 'solicitante') {
  const email = `anon_${perfil}_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  const nome = `Pessoa ${Math.random().toString(36).slice(2, 7)}`;
  await request(app).post('/auth/registrar').send({ nome, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app)
    .post('/auth/login')
    .set('X-Real-IP', `${IP}-${Math.random()}`)
    .send({ email, senha: 'senha123' });
  return { ...login.body.usuario, email, nome, token: login.body.token, senha: 'senha123' };
}

beforeAll(async () => {
  admin = await novaConta('administrador');
  outroAdmin = await novaConta('administrador');
});

afterAll(async () => {
  await pool.end();
});

const comoAdmin = () => ({ Authorization: `Bearer ${admin.token}` });

describe('POST /usuarios/:id/anonimizar', () => {
  it('apaga quem a pessoa era', async () => {
    const alvo = await novaConta();

    const resp = await request(app)
      .post(`/usuarios/${alvo.id}/anonimizar`)
      .set(comoAdmin());

    expect(resp.status).toBe(200);
    expect(resp.body.usuario.nome).toBe('Usuário removido');
    expect(resp.body.usuario.ativo).toBe(false);
    expect(resp.body.usuario.anonimizado_em).toBeTruthy();

    const { rows } = await pool.query(
      'SELECT nome, email, senha_hash, ativo, anonimizado_em FROM usuario WHERE id = $1',
      [alvo.id]
    );

    // O nome e o e-mail originais não podem sobrar em lugar nenhum da linha:
    // é isso que a pessoa pediu.
    expect(rows[0].nome).not.toContain(alvo.nome);
    expect(rows[0].email).not.toBe(alvo.email);
    // `.invalid` é reservado pela RFC 2606 e nenhum servidor entrega. Um
    // domínio inventado qualquer devolveria cada aviso do sistema na caixa do
    // remetente — foi o que as 27 devoluções de `@exemplo.demo` ensinaram.
    expect(rows[0].email).toMatch(/@anonimizado\.invalid$/);
  });

  it('preserva o chamado que a pessoa abriu', async () => {
    // O ponto inteiro da anonimização em vez de exclusão.
    const alvo = await novaConta();

    const { rows: local } = await pool.query('SELECT id FROM local LIMIT 1');
    const { rows: categoria } = await pool.query('SELECT id FROM categoria LIMIT 1');

    const chamado = await request(app)
      .post('/chamados')
      .set('Authorization', `Bearer ${alvo.token}`)
      .send({
        titulo: 'Torneira pingando no sanitário',
        descricao: 'Pinga desde ontem e molha o piso inteiro.',
        categoria_id: categoria[0].id,
        local_id: local[0].id,
      });
    expect(chamado.status).toBe(201);
    const chamadoId = chamado.body.chamado.id;

    await request(app).post(`/usuarios/${alvo.id}/anonimizar`).set(comoAdmin()).expect(200);

    const { rows } = await pool.query(
      'SELECT titulo, descricao, solicitante_id FROM chamado WHERE id = $1',
      [chamadoId]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].titulo).toBe('Torneira pingando no sanitário');
    // A ligação continua de pé: o chamado sabe de qual linha veio, e aquela
    // linha agora se chama "Usuário removido".
    expect(rows[0].solicitante_id).toBe(alvo.id);

    const { rows: eventos } = await pool.query(
      'SELECT count(*)::int AS total FROM historico_chamado WHERE chamado_id = $1',
      [chamadoId]
    );
    expect(eventos[0].total).toBeGreaterThan(0);
  });

  it('a senha antiga deixa de servir', async () => {
    const alvo = await novaConta();

    await request(app).post(`/usuarios/${alvo.id}/anonimizar`).set(comoAdmin()).expect(200);

    const login = await request(app)
      .post('/auth/login')
      .set('X-Real-IP', `${IP}-login-${Math.random()}`)
      .send({ email: alvo.email, senha: alvo.senha });

    expect(login.status).toBe(401);

    // E o hash guardado não é mais o da pessoa: manter o hash antigo seria
    // guardar a senha de quem pediu para sair.
    const { rows } = await pool.query('SELECT senha_hash FROM usuario WHERE id = $1', [alvo.id]);
    expect(rows[0].senha_hash).not.toMatch(/^\$2[aby]\$/);
  });

  it('apaga o que só existia por causa da pessoa', async () => {
    const alvo = await novaConta();

    await request(app)
      .post('/auth/recuperar-senha')
      .set('X-Real-IP', `${IP}-rec-${Math.random()}`)
      .send({ email: alvo.email });

    const { rows: antes } = await pool.query(
      'SELECT count(*)::int AS total FROM recuperacao_senha WHERE usuario_id = $1',
      [alvo.id]
    );
    expect(antes[0].total).toBeGreaterThan(0);

    await request(app).post(`/usuarios/${alvo.id}/anonimizar`).set(comoAdmin()).expect(200);

    // `recuperacao_senha` é a tabela que guarda IP. Deixá-la para trás
    // manteria o endereço de rede de quem pediu para ser esquecido.
    const { rows: depois } = await pool.query(
      'SELECT count(*)::int AS total FROM recuperacao_senha WHERE usuario_id = $1',
      [alvo.id]
    );
    expect(depois[0].total).toBe(0);

    const { rows: tentativas } = await pool.query(
      'SELECT count(*)::int AS total FROM tentativa_login WHERE email = $1',
      [alvo.email]
    );
    expect(tentativas[0].total).toBe(0);

    const { rows: avisos } = await pool.query(
      'SELECT count(*)::int AS total FROM notificacao WHERE usuario_id = $1',
      [alvo.id]
    );
    expect(avisos[0].total).toBe(0);
  });
});

describe('As travas', () => {
  it('ninguém anonimiza a própria conta', async () => {
    // A ação não tem desfazer e tira o acesso na hora. Exigir outro
    // administrador é o segundo par de olhos.
    const resp = await request(app).post(`/usuarios/${admin.id}/anonimizar`).set(comoAdmin());

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('AUTO_ANONIMIZACAO');
  });

  it('não anonimiza duas vezes', async () => {
    const alvo = await novaConta();
    await request(app).post(`/usuarios/${alvo.id}/anonimizar`).set(comoAdmin()).expect(200);

    const segunda = await request(app).post(`/usuarios/${alvo.id}/anonimizar`).set(comoAdmin());

    // A segunda passagem não teria o que apagar: só moveria a data e faria
    // parecer que houve um pedido novo.
    expect(segunda.status).toBe(422);
    expect(segunda.body.erro.codigo).toBe('JA_ANONIMIZADO');
  });

  it('conta anonimizada não é reativada pelo botão da tela', async () => {
    const alvo = await novaConta();
    await request(app).post(`/usuarios/${alvo.id}/anonimizar`).set(comoAdmin()).expect(200);

    const resp = await request(app)
      .patch(`/usuarios/${alvo.id}`)
      .set(comoAdmin())
      .send({ ativo: true });

    // O `ativo = false` da anonimização não é uma desativação comum, e
    // "Reativar" devolveria acesso a uma conta cujo dono pediu para sair.
    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('CONTA_ANONIMIZADA');

    const { rows } = await pool.query('SELECT ativo FROM usuario WHERE id = $1', [alvo.id]);
    expect(rows[0].ativo).toBe(false);
  });

  it('não deixa o sistema sem administrador', async () => {
    // Mesma trava do `atualizar`, pela mesma razão: recuperar o sistema
    // exigiria acesso direto ao banco.
    //
    // Para `outroAdmin` virar o último administrador ativo é preciso desativar
    // todos os outros — e o banco é compartilhado com as demais suítes e com
    // os testes de ponta a ponta. A primeira versão deste teste desativava
    // todo mundo e, no `finally`, reativava só as duas contas que ele mesmo
    // criou. O `admin_e2e` ficava desativado para sempre, e a suíte de ponta a
    // ponta passava a falhar com 401 no login e 429 logo depois — longe daqui,
    // sem nenhuma pista de que a causa era este arquivo.
    //
    // O RETURNING guarda exatamente quem foi desligado, para devolver
    // exatamente esses — nem menos (o bug), nem mais (reativar quem já estava
    // inativo antes, por decisão de outro teste).
    const { rows: desligados } = await pool.query(
      `UPDATE usuario SET ativo = FALSE
        WHERE perfil = 'administrador' AND ativo AND id <> $1
        RETURNING id`,
      [outroAdmin.id]
    );

    try {
      const resp = await request(app)
        .post(`/usuarios/${outroAdmin.id}/anonimizar`)
        .set({ Authorization: `Bearer ${outroAdmin.token}` });

      // Cai na trava da própria conta antes; o que importa é que não passa.
      expect(resp.status).toBe(422);

      const resp2 = await request(app)
        .post(`/usuarios/${outroAdmin.id}/anonimizar`)
        .set(comoAdmin());
      expect(resp2.status).toBe(422);
      expect(resp2.body.erro.codigo).toBe('ULTIMO_ADMINISTRADOR');
    } finally {
      await pool.query('UPDATE usuario SET ativo = TRUE WHERE id = ANY($1::int[])', [
        desligados.map((r) => r.id),
      ]);
    }
  });

  it('só administrador anonimiza', async () => {
    const gestor = await novaConta('gestor');
    const alvo = await novaConta();

    const resp = await request(app)
      .post(`/usuarios/${alvo.id}/anonimizar`)
      .set({ Authorization: `Bearer ${gestor.token}` });

    expect(resp.status).toBe(403);
  });
});

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);

/**
 * O token prova quem é; o banco decide o que pode.
 *
 * O `authenticate` confiava no JWT inteiro, perfil incluído, por até 8 horas.
 * Desligar alguém não tirava o acesso; anonimizar a pedido também não; e o
 * perfil de quem era rebaixado continuava o antigo até o token expirar. Nenhum
 * teste percebia, porque todos pegavam um token novo logo antes de agir —
 * exatamente o caso em que token e banco concordam.
 *
 * Aqui o token é pego ANTES da mudança e usado DEPOIS. É o único jeito de ver
 * a diferença.
 */

async function conta(perfil) {
  const email = `sessao_${perfil}_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Sessao ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app)
    .post('/auth/login')
    .set('X-Real-IP', `${IP}-${Math.random()}`)
    .send({ email, senha: 'senha123' });
  return { ...login.body.usuario, token: login.body.token };
}

const com = (pessoa) => ({ Authorization: `Bearer ${pessoa.token}` });

afterAll(async () => {
  await pool.end();
});

describe('O token não sobrevive à conta', () => {
  it('conta desligada perde o acesso na hora, não em 8 horas', async () => {
    const pessoa = await conta('solicitante');
    expect((await request(app).get('/chamados').set(com(pessoa))).status).toBe(200);

    await pool.query('UPDATE usuario SET ativo = FALSE WHERE id = $1', [pessoa.id]);

    const depois = await request(app).get('/chamados').set(com(pessoa));
    expect(depois.status).toBe(401);
    expect(depois.body.erro.codigo).toBe('SESSAO_ENCERRADA');
  });

  it('conta anonimizada a pedido perde o acesso na hora', async () => {
    // A pessoa pediu para sair. Com a sessão aberta, ela seguia listando e
    // comentando chamados, agora assinados por "Usuário removido".
    const admin = await conta('administrador');
    const pessoa = await conta('solicitante');

    await request(app).post(`/usuarios/${pessoa.id}/anonimizar`).set(com(admin)).expect(200);

    expect((await request(app).get('/chamados').set(com(pessoa))).status).toBe(401);
  });

  it('o perfil vem do banco, não do token', async () => {
    // Um gestor rebaixado a solicitante continuava gestor até o token vencer.
    const gestor = await conta('gestor');
    expect((await request(app).get('/relatorios/resumo').set(com(gestor))).status).toBe(200);

    await pool.query("UPDATE usuario SET perfil = 'solicitante' WHERE id = $1", [gestor.id]);

    const depois = await request(app).get('/relatorios/resumo').set(com(gestor));
    expect(depois.status).toBe(403);
  });

  it('a recusa não conta a um token vazado o que houve com a conta', async () => {
    // Desligada, anonimizada ou apagada: a mesma resposta. Dizer "sua conta
    // foi desativada" entregaria a quem tem um token alheio a história da
    // conta; quem é o dono legítimo só precisa saber que tem de entrar de novo.
    const pessoa = await conta('solicitante');
    await pool.query('UPDATE usuario SET ativo = FALSE WHERE id = $1', [pessoa.id]);

    const resp = await request(app).get('/chamados').set(com(pessoa));
    expect(resp.body.erro.mensagem).toBe('Sessão encerrada. Entre novamente.');
    expect(resp.body.erro.mensagem).not.toMatch(/desativ|anonim|removid/i);
  });

  it('banco fora do ar não desloga ninguém', async () => {
    // 401 aqui mandaria o navegador descartar a sessão de todo mundo por uma
    // falha que não é de ninguém. Tem de ser 500.
    const pessoa = await conta('solicitante');
    const consulta = jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('banco caiu'));
    const aviso = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const resp = await request(app).get('/chamados').set(com(pessoa));
      expect(resp.status).toBe(500);
    } finally {
      consulta.mockRestore();
      aviso.mockRestore();
    }
  });
});

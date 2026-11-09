const request = require('supertest');
const app = require('../../src/app');
const pool = require('../../src/config/db');

/**
 * Cria uma conta `@exemplo.com` (o teardown global as apaga), ajusta o perfil
 * e devolve o token. `ip` é o da suíte (apoio/ip.js).
 */
async function criarUsuarioELogar(perfil, { ip, rotulo = 'conta' }) {
  const email = `${perfil}_${rotulo}_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Teste ${perfil}`, email, senha: 'senha-teste-123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').set('X-Real-IP', ip).send({ email, senha: 'senha-teste-123' });
  return { token: login.body.token, usuario: login.body.usuario, cabecalho: { Authorization: `Bearer ${login.body.token}` } };
}

module.exports = { criarUsuarioELogar };

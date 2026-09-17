const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');

const SALT_ROUNDS = 10;

async function criarUsuario({ nome, email, senha, perfil }) {
  const existente = await pool.query('SELECT id FROM usuario WHERE email = $1', [email]);
  if (existente.rows.length > 0) {
    throw new AppError('Já existe um usuário cadastrado com este e-mail.', 409, 'EMAIL_EM_USO');
  }

  const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);

  const { rows } = await pool.query(
    `INSERT INTO usuario (nome, email, senha_hash, perfil)
     VALUES ($1, $2, $3, $4)
     RETURNING id, nome, email, perfil, ativo, criado_em`,
    [nome, email, senhaHash, perfil]
  );

  return rows[0];
}

// Cadastro público: sempre cria perfil "solicitante". Perfis internos
// (tecnico, gestor, administrador) só podem ser criados por um administrador
// autenticado, via usuariosService.criarUsuario, para evitar escalonamento
// de privilégio por auto-cadastro.
async function registrar({ nome, email, senha }) {
  return criarUsuario({ nome, email, senha, perfil: 'solicitante' });
}

async function login({ email, senha }) {
  const { rows } = await pool.query(
    'SELECT id, nome, email, senha_hash, perfil, ativo FROM usuario WHERE email = $1',
    [email]
  );
  const usuario = rows[0];

  if (!usuario || !usuario.ativo) {
    throw new AppError('E-mail ou senha inválidos.', 401, 'CREDENCIAIS_INVALIDAS');
  }

  const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
  if (!senhaValida) {
    throw new AppError('E-mail ou senha inválidos.', 401, 'CREDENCIAIS_INVALIDAS');
  }

  const token = jwt.sign(
    { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  return {
    token,
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
  };
}

module.exports = { registrar, login, criarUsuario };

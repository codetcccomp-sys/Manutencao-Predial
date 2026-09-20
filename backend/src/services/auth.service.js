const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');

const SALT_ROUNDS = 10;

// Hash descartável, de uma senha que ninguém usa, comparado quando o e-mail
// não existe. Sem isso, "usuário inexistente" responde na hora e "senha
// errada" leva o tempo do bcrypt: a diferença é mensurável de fora e permite
// descobrir quais e-mails têm conta antes de tentar qualquer senha.
const HASH_FICTICIO = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

// A caixa do e-mail não identifica ninguém: "Joao@empresa.com" e
// "joao@empresa.com" são a mesma pessoa. Sem normalizar, quem se cadastrou de
// um jeito não conseguia entrar digitando do outro, e o UNIQUE da coluna
// deixava as duas contas coexistirem. Aplicado em toda escrita e toda busca;
// o CHECK na tabela garante o mesmo para quem escrever por fora do código.
function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Tira o espaço sobrando do nome.
 *
 * O e-mail já era normalizado; o nome entrava cru. Um espaço no fim passa
 * despercebido no cadastro e reaparece em todo lugar depois: no cabeçalho, na
 * autoria do comentário, no histórico do chamado e no "Olá, Fulano ." dos
 * e-mails. Pior, dois cadastros de "João" e "João " ficam visualmente
 * idênticos na lista de usuários e são pessoas diferentes para o sistema.
 *
 * Também colapsa espaços internos: "Maria   Silva" vira "Maria Silva". Quem
 * digita dois espaços sem querer não quis dizer nada com isso.
 */
function normalizarNome(nome) {
  return String(nome ?? '').trim().replace(/\s+/g, ' ');
}

async function criarUsuario({ nome, email, senha, perfil }) {
  const emailNormalizado = normalizarEmail(email);

  const existente = await pool.query('SELECT id FROM usuario WHERE email = $1', [emailNormalizado]);
  if (existente.rows.length > 0) {
    throw new AppError('Já existe um usuário cadastrado com este e-mail.', 409, 'EMAIL_EM_USO');
  }

  const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);

  const { rows } = await pool.query(
    `INSERT INTO usuario (nome, email, senha_hash, perfil)
     VALUES ($1, $2, $3, $4)
     RETURNING id, nome, email, perfil, ativo, criado_em`,
    [normalizarNome(nome), emailNormalizado, senhaHash, perfil]
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
    [normalizarEmail(email)]
  );
  const usuario = rows[0];

  if (!usuario || !usuario.ativo) {
    await bcrypt.compare(senha, HASH_FICTICIO);
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

module.exports = { registrar, login, criarUsuario, normalizarEmail, normalizarNome };

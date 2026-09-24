const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { AppError } = require('./errorHandler');

/**
 * Quem está pedindo, conferido no banco a cada requisição.
 *
 * Até aqui bastava a assinatura do JWT: o `payload` virava `req.usuario`
 * inteiro, perfil incluído. O token vale 8 horas, e durante esse tempo ele era
 * a verdade — não o banco. Três consequências, todas silenciosas:
 *
 * - **conta desativada continuava entrando** até o token expirar. Desligar
 *   alguém pela tela de Usuários não tirava o acesso de ninguém;
 * - **conta anonimizada a pedido também** — a pessoa pedia para sair, o
 *   administrador atendia, e a sessão aberta seguia listando e comentando
 *   chamados, agora assinados por "Usuário removido";
 * - **o perfil vinha do token**: um gestor rebaixado a solicitante continuava
 *   gestor por até 8 horas, e um técnico promovido não via a tela nova.
 *
 * O custo é uma consulta por requisição, por chave primária. A alternativa —
 * token curto com renovação — resolve o mesmo problema com mais peças móveis
 * e ainda deixa uma janela; esta não deixa nenhuma.
 *
 * O token continua provando QUEM é (a assinatura). O que a pessoa PODE fazer
 * vem do banco, que é onde a decisão de desligar, rebaixar ou anonimizar fica
 * registrada.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Token de autenticação não informado.', 401));
  }

  const token = authHeader.split(' ')[1];

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return next(new AppError('Token inválido ou expirado.', 401));
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, nome, email, perfil, ativo, anonimizado_em FROM usuario WHERE id = $1',
      [payload.id]
    );
    const conta = rows[0];

    // Mesma resposta para os três casos. Dizer "sua conta foi desativada" a
    // quem apresenta um token contaria a um token vazado o que aconteceu com
    // a conta; o que a pessoa legítima precisa saber é entrar de novo.
    if (!conta || !conta.ativo || conta.anonimizado_em) {
      return next(new AppError('Sessão encerrada. Entre novamente.', 401, 'SESSAO_ENCERRADA'));
    }

    req.usuario = { id: conta.id, nome: conta.nome, email: conta.email, perfil: conta.perfil };
    next();
  } catch (err) {
    // Banco fora do ar não é "token inválido": responder 401 aqui mandaria o
    // navegador deslogar todo mundo por uma falha que não é de ninguém.
    next(err);
  }
}

function authorize(...perfisPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return next(new AppError('Usuário não autenticado.', 401));
    }
    if (!perfisPermitidos.includes(req.usuario.perfil)) {
      return next(new AppError('Acesso negado para o seu perfil.', 403));
    }
    next();
  };
}

module.exports = { authenticate, authorize };

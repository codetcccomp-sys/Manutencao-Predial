const jwt = require('jsonwebtoken');
const { AppError } = require('./errorHandler');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Token de autenticação não informado.', 401));
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = payload;
    next();
  } catch (err) {
    next(new AppError('Token inválido ou expirado.', 401));
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

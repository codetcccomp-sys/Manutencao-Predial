function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';

  console.error(`[ERRO] ${req.method} ${req.originalUrl} ->`, err.message);

  res.status(status).json({
    erro: {
      mensagem: err.expose ? err.message : (isProd ? 'Erro interno no servidor.' : err.message),
      codigo: err.code || undefined,
    },
  });
}

class AppError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

module.exports = { errorHandler, AppError };

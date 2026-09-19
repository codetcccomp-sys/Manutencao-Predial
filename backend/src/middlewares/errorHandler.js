function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';

  console.error(`[ERRO] ${req.method} ${req.originalUrl} ->`, err.message);

  res.status(status).json({
    erro: {
      mensagem: err.expose ? err.message : (isProd ? 'Erro interno no servidor.' : err.message),
      codigo: err.code || undefined,
      // Lista de problemas, quando a recusa tem mais de um motivo. Uma
      // importação de planilha pode recusar quarenta linhas por quarenta
      // razões diferentes: emendar tudo numa frase só devolve um parágrafo
      // ilegível, e quem for corrigir o arquivo precisa da lista item a item.
      detalhes: err.expose && err.detalhes ? err.detalhes : undefined,
    },
  });
}

class AppError extends Error {
  constructor(message, status = 400, code, detalhes) {
    super(message);
    this.status = status;
    this.code = code;
    this.detalhes = detalhes;
    this.expose = true;
  }
}

module.exports = { errorHandler, AppError };

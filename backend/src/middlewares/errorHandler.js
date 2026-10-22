/**
 * Erros que o `express.json()` levanta antes de a rota existir.
 *
 * Chegam com a mensagem crua da biblioteca, em inglês ("request entity too large",
 * "Unexpected token ..."), sem dizer à pessoa o que fazer. Uma importação de
 * locais com 3.000 linhas (136 kB) passava do limite do corpo e voltava assim,
 * enquanto a de 1.500 linhas recebia a mensagem em português da própria rota.
 */
function traduzirErroDeCorpo(err) {
  if (err.type === 'entity.too.large') {
    err.message = 'O envio é maior do que o sistema aceita de uma vez. Divida o arquivo em partes menores.';
    err.code = 'CORPO_GRANDE';
    err.expose = true;
  } else if (err.type === 'entity.parse.failed') {
    err.message = 'O conteúdo enviado não é um JSON válido.';
    err.code = 'JSON_INVALIDO';
    err.expose = true;
  }
}

/**
 * Onde cada desfecho é registrado, e por quê.
 *
 * Tudo aqui saía como `console.error`, inclusive o que é funcionamento
 * normal. Nos logs de produção do piloto, "Token inválido ou expirado" já
 * aparecia marcado como ERRO sete vezes: um JWT expirar é o combinado, não um
 * defeito. O efeito de marcar o esperado como erro é que o inesperado deixa
 * de se destacar — no dia em que algo quebrar de verdade, vai estar no meio
 * dessa lista.
 *
 * A divisão segue quem pode consertar o quê:
 *
 * - **4xx é do cliente.** Senha errada, token vencido, campo faltando, origem
 *   não cadastrada. O servidor fez o certo ao recusar. Vai como `warn`, que é
 *   visível quando se procura e some do painel de erros.
 * - **5xx é nosso.** Aqui alguém precisa agir, e precisa do stack: `err.message`
 *   sozinho diz "Cannot read properties of undefined" sem dizer onde. Era
 *   exatamente ao contrário do necessário — ruído demais no esperado, detalhe
 *   de menos no inesperado.
 */
function errorHandler(err, req, res, next) {
  traduzirErroDeCorpo(err);
  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  const onde = `${req.method} ${req.originalUrl}`;

  if (status >= 500) {
    // O stack e não a mensagem: é a única chance de saber de onde veio.
    console.error(`[ERRO] ${onde} ->`, err.stack || err.message);
  } else {
    console.warn(`[RECUSA ${status}] ${onde} ->`, err.message);
  }

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

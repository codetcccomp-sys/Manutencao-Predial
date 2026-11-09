const { AppError } = require('./errorHandler');

/**
 * Forma da entrada, conferida na fronteira, antes de qualquer consulta.
 *
 * Um identificador que não é número (`/chamados/abc`), um número que não cabe
 * num INTEGER (`/chamados/99999999999999999999`) ou um filtro repetido
 * (`?busca=a&busca=b`, que chega como lista) passavam direto até o banco ou até
 * um `.trim()`, e voltavam como **500**. O efeito não era só a mensagem errada:
 * todo 5xx é gravado em `erro_aplicacao` e aparece ao administrador como defeito
 * do sistema. Bastava um endereço digitado errado, ou um robô varrendo `/chamados/x`,
 * para encher de ruído o painel que existe para mostrar falha de verdade.
 *
 * A recusa é do cliente (4xx) e não vai para o painel.
 */

// INTEGER do PostgreSQL: de 1 a 2.147.483.647. Sem sinal, sem casa decimal,
// sem zero à esquerda (o banco aceitaria "007", mas dois endereços para o mesmo
// registro só confundem cache e log).
const MAIOR_INTEIRO = 2147483647;
const SO_DIGITOS = /^[1-9]\d{0,9}$/;

function ehIdValido(valor) {
  return typeof valor === 'string' && SO_DIGITOS.test(valor) && Number(valor) <= MAIOR_INTEIRO;
}

// Parâmetros de rota que são chave numérica. `:codigo` (etiqueta do equipamento),
// `:prioridade` e `:data` são texto e têm a própria validação.
const PARAMETROS_NUMERICOS = ['id', 'anexoId', 'materialId', 'usuarioId'];

/**
 * Registra, num roteador, a conferência dos identificadores numéricos da rota.
 *
 * Responde 404, e não 422: `/chamados/abc` é um endereço que não existe, do
 * mesmo jeito que `/chamados/999999`. A tela já sabe mostrar "não encontrado".
 *
 * Roda quando a rota casa, depois dos `router.use` declarados antes dela: quem
 * não está autenticado continua recebendo 401, e não uma pista sobre o formato.
 */
function idsInteiros(router) {
  for (const nome of PARAMETROS_NUMERICOS) {
    router.param(nome, (req, res, next, valor) => {
      if (!ehIdValido(valor)) {
        return next(new AppError('Registro não encontrado.', 404, 'IDENTIFICADOR_INVALIDO'));
      }
      next();
    });
  }
  return router;
}

/**
 * Filtro de consulta é sempre um texto só.
 *
 * `?busca=a&busca=b` e `?busca[x]=1` chegam como lista e como objeto. Nenhuma
 * rota usa essas formas, e o código que espera texto (`.trim()`, comparação
 * com enum) quebrava com elas.
 */
function consultaSimples(req, res, next) {
  for (const [chave, valor] of Object.entries(req.query)) {
    if (typeof valor !== 'string') {
      return next(new AppError(`Filtro "${chave}" repetido ou em formato inválido.`, 400, 'CONSULTA_INVALIDA'));
    }
  }
  next();
}

/**
 * O PostgreSQL não guarda o caractere nulo (U+0000) em texto: recusa com
 * "invalid byte sequence", que chegava como erro interno. Ninguém digita isso;
 * vem de robô ou de arquivo corrompido colado num campo. Recusa na entrada, em
 * endereço, filtro e corpo.
 */
function temNulo(valor, nivel = 0) {
  if (typeof valor === 'string') return valor.includes('\u0000');
  // Corpo JSON é raso (o mais fundo é a lista de linhas da importação de locais).
  // O teto de profundidade evita percorrer algo montado para custar caro.
  if (valor && typeof valor === 'object' && nivel < 6) {
    return Object.values(valor).some((v) => temNulo(v, nivel + 1));
  }
  return false;
}

function semCaractereNulo(req, res, next) {
  // `%00` cobre o caminho e os filtros (é a única forma de o nulo chegar pelo
  // endereço); no corpo ele vem como `\u0000` dentro do JSON, já decodificado.
  if (req.originalUrl.includes('%00') || temNulo(req.body)) {
    return next(new AppError('A requisição contém um caractere inválido.', 400, 'CARACTERE_INVALIDO'));
  }
  next();
}

/** Filtro numérico opcional: devolve o número, `undefined` se ausente, e recusa o resto. */
function filtroInteiro(valor, nome) {
  if (valor === undefined || valor === '') return undefined;
  if (!ehIdValido(valor)) {
    throw new AppError(`Filtro "${nome}" deve ser um número inteiro.`, 422, 'FILTRO_INVALIDO');
  }
  return Number(valor);
}

/** Filtro de lista fechada opcional: recusa o que não está na lista, em vez de ignorar. */
function filtroDeLista(valor, nome, permitidos) {
  if (valor === undefined || valor === '') return undefined;
  if (!permitidos.includes(valor)) {
    throw new AppError(`Filtro "${nome}" deve ser um de: ${permitidos.join(', ')}.`, 422, 'FILTRO_INVALIDO');
  }
  return valor;
}

module.exports = { idsInteiros, consultaSimples, semCaractereNulo, filtroInteiro, filtroDeLista, ehIdValido, MAIOR_INTEIRO };

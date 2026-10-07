const multer = require('multer');
const { AppError } = require('./errorHandler');
const { TAMANHO_MAXIMO_BYTES, TIPOS_ACEITOS } = require('../services/anexos.service');

// Armazenamento em memória: o destino final é o Postgres, e escrever em disco
// antes seria escrever num sistema de arquivos efêmero do serverless.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAXIMO_BYTES, files: 1 },
  fileFilter(req, arquivo, callback) {
    // Recusa pelo tipo declarado já aqui, para não gastar memória bufferizando
    // um arquivo que seria rejeitado depois. A conferência que vale — a dos
    // bytes do arquivo — acontece no serviço, com o conteúdo em mãos.
    if (!TIPOS_ACEITOS[arquivo.mimetype]) {
      return callback(
        new AppError(
          `Tipo de arquivo não aceito. Aceitos: ${Object.keys(TIPOS_ACEITOS).join(', ')}.`,
          422,
          'TIPO_NAO_ACEITO'
        )
      );
    }
    callback(null, true);
  },
});

function envioMalformado() {
  return new AppError(
    'O envio do arquivo chegou incompleto ou malformado. Tente de novo.',
    400,
    'ENVIO_MALFORMADO'
  );
}

/**
 * Recebe um arquivo no campo "arquivo" e traduz os erros do multer, que não
 * carregam status HTTP, para a mesma forma de erro do resto da API.
 *
 * Nem todo erro vem como MulterError: o que o parser de multipart (busboy)
 * acusa — corpo cortado no meio, cabeçalho de parte quebrado, corpo que nem é
 * multipart — chega como `Error` cru. Repassado adiante, virava 500 com stack
 * no log de erros, como se o servidor tivesse quebrado; é o cliente que
 * mandou algo que não dá para ler. Com o arquivo em memória, não há outra
 * fonte de erro possível aqui além do envio.
 */
function receberArquivo(req, res, next) {
  upload.single('arquivo')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof AppError) return next(err);

    if (!(err instanceof multer.MulterError) || err.code === 'MISSING_FIELD_NAME') {
      return next(envioMalformado());
    }

    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(
        new AppError(
          `Arquivo maior que o limite de ${TAMANHO_MAXIMO_BYTES / 1024 / 1024} MB.`,
          413,
          'ARQUIVO_GRANDE'
        )
      );
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new AppError('Envie um arquivo por vez, no campo "arquivo".', 422, 'ENVIO_INVALIDO'));
    }
    return next(new AppError(`Falha no envio do arquivo: ${err.message}`, 422, 'ENVIO_INVALIDO'));
  });
}

module.exports = { receberArquivo };

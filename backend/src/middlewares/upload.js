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

/**
 * Recebe um arquivo no campo "arquivo" e traduz os erros do multer, que não
 * carregam status HTTP, para a mesma forma de erro do resto da API.
 */
function receberArquivo(req, res, next) {
  upload.single('arquivo')(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
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
    }

    next(err);
  });
}

module.exports = { receberArquivo };

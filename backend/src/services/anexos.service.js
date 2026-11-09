const pool = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');
const armazenamento = require('./armazenamento.service');
const { transacao } = require('../config/transacao');
const { LIMITE_POR_CHAMADO } = require('../config/anexos');

// Limite do corpo de uma requisição em função serverless na Vercel é 4,5 MB;
// 4 MB deixa folga para o restante do multipart.
const TAMANHO_MAXIMO_BYTES = 4 * 1024 * 1024;

/**
 * Tipos aceitos, com a assinatura que o arquivo precisa ter de verdade.
 *
 * O Content-Type do multipart é escolhido pelo cliente: aceitar só ele
 * deixaria passar qualquer coisa rotulada como "image/png". Cada tipo é
 * confirmado pelos primeiros bytes do arquivo.
 */
const TIPOS_ACEITOS = {
  'image/jpeg': { categoria: 'foto', assinaturas: [[0xff, 0xd8, 0xff]] },
  'image/png': { categoria: 'foto', assinaturas: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  'image/webp': {
    categoria: 'foto',
    // "RIFF" nos bytes 0-3 e "WEBP" nos bytes 8-11.
    assinaturas: [[0x52, 0x49, 0x46, 0x46]],
    extra: (buffer) => buffer.slice(8, 12).toString('ascii') === 'WEBP',
  },
  'application/pdf': { categoria: 'documento', assinaturas: [[0x25, 0x50, 0x44, 0x46]] },
};

function conteudoBate(buffer, mimeType) {
  const regra = TIPOS_ACEITOS[mimeType];
  if (!regra) return false;

  const casaAssinatura = regra.assinaturas.some((assinatura) =>
    assinatura.every((byte, i) => buffer[i] === byte)
  );

  return casaAssinatura && (!regra.extra || regra.extra(buffer));
}

function validarArquivo(arquivo) {
  if (!arquivo) {
    throw new AppError('Nenhum arquivo enviado.', 422, 'ARQUIVO_AUSENTE');
  }
  if (arquivo.size > TAMANHO_MAXIMO_BYTES) {
    throw new AppError(
      `Arquivo maior que o limite de ${TAMANHO_MAXIMO_BYTES / 1024 / 1024} MB.`,
      413,
      'ARQUIVO_GRANDE'
    );
  }
  if (!TIPOS_ACEITOS[arquivo.mimetype]) {
    throw new AppError(
      `Tipo de arquivo não aceito. Aceitos: ${Object.keys(TIPOS_ACEITOS).join(', ')}.`,
      422,
      'TIPO_NAO_ACEITO'
    );
  }
  if (!conteudoBate(arquivo.buffer, arquivo.mimetype)) {
    throw new AppError(
      'O conteúdo do arquivo não corresponde ao tipo declarado.',
      422,
      'CONTEUDO_INCOMPATIVEL'
    );
  }
}

function limiteAtingido() {
  return new AppError(
    `Este chamado já tem ${LIMITE_POR_CHAMADO} anexos, que é o limite. Remova algum para enviar outro.`,
    422,
    'LIMITE_DE_ANEXOS'
  );
}

async function contar(client, chamadoId) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM anexo WHERE chamado_id = $1', [chamadoId]);
  return rows[0].n;
}

async function anexar(chamadoId, usuarioId, arquivo) {
  validarArquivo(arquivo);

  // Recusa antes de subir o arquivo ao Storage: o caso comum (limite já atingido) não
  // gasta envio nem apaga objeto. A conferência que vale é a de dentro da transação.
  if ((await contar(pool, chamadoId)) >= LIMITE_POR_CHAMADO) throw limiteAtingido();

  const noStorage = armazenamento.modo() === 'supabase';
  const chave = noStorage ? armazenamento.novaChave(chamadoId) : null;

  // O arquivo sobe ANTES da linha existir: uma linha apontando para um objeto
  // que não subiu seria um anexo que não abre. O contrário (objeto sem linha,
  // se o INSERT falhar) é desfeito logo abaixo.
  if (noStorage) await armazenamento.guardar(chave, arquivo.buffer, arquivo.mimetype);

  try {
    return await transacao(async (client) => {
      // Duas fotos enviadas juntas com o chamado em 9 anexos contariam 9 cada uma e
      // passariam as duas. O cadeado é por chamado e some no fim da transação.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('anexo_chamado'), $1::int)", [chamadoId]);
      if ((await contar(client, chamadoId)) >= LIMITE_POR_CHAMADO) throw limiteAtingido();

      const { rows } = await client.query(
        `INSERT INTO anexo (chamado_id, usuario_id, tipo, nome_arquivo, mime_type, tamanho_bytes,
                            conteudo, armazenamento, chave_externa)
         VALUES ($1, $2, $3::tipo_anexo, $4, $5, $6, $7, $8, $9)
         RETURNING id, chamado_id, usuario_id, tipo, nome_arquivo, mime_type, tamanho_bytes, data_upload`,
        [
          chamadoId,
          usuarioId,
          TIPOS_ACEITOS[arquivo.mimetype].categoria,
          // Caractere de controle no nome (o nulo, que o banco recusa, e quebras de
          // linha, que bagunçam o cabeçalho de download) sai antes de gravar.
          arquivo.originalname.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'arquivo',
          arquivo.mimetype,
          arquivo.size,
          noStorage ? null : arquivo.buffer,
          noStorage ? 'supabase' : 'banco',
          chave,
        ]
      );
      return rows[0];
    });
  } catch (err) {
    if (noStorage) await armazenamento.apagar(chave);
    throw err;
  }
}

// A listagem nunca traz "conteudo": um chamado com cinco fotos devolveria
// megabytes de base64 num JSON que a interface só usa para montar links.
async function listar(chamadoId) {
  const { rows } = await pool.query(
    `SELECT a.id, a.chamado_id, a.usuario_id, u.nome AS usuario_nome, a.tipo,
            a.nome_arquivo, a.mime_type, a.tamanho_bytes, a.data_upload
       FROM anexo a JOIN usuario u ON u.id = a.usuario_id
      WHERE a.chamado_id = $1
      ORDER BY a.data_upload`,
    [chamadoId]
  );
  return rows;
}

// Para checagem de permissão e remoção: traz o que decide o acesso sem
// carregar os bytes do arquivo.
async function buscarMetadados(anexoId) {
  const { rows } = await pool.query(
    'SELECT id, chamado_id, usuario_id, nome_arquivo, mime_type FROM anexo WHERE id = $1',
    [anexoId]
  );
  if (!rows[0]) {
    throw new AppError('Anexo não encontrado.', 404, 'ANEXO_NAO_ENCONTRADO');
  }
  return rows[0];
}

/**
 * O anexo com os bytes, de onde quer que estejam.
 *
 * Cada linha diz onde está o seu arquivo: trocar a configuração de
 * armazenamento vale para os anexos novos, e os antigos continuam abrindo.
 * Quem chama confere a permissão ANTES de pedir os bytes (ver o controller),
 * para não buscar no Storage um arquivo que não vai entregar.
 */
async function buscarConteudo(anexoId) {
  const anexo = await buscarRegistroCompleto(anexoId);
  if (anexo.armazenamento === 'supabase') {
    anexo.conteudo = await armazenamento.ler(anexo.chave_externa);
  }
  return anexo;
}

async function buscarRegistroCompleto(anexoId) {
  const { rows } = await pool.query(
    `SELECT id, chamado_id, nome_arquivo, mime_type, conteudo, armazenamento, chave_externa
       FROM anexo WHERE id = $1`,
    [anexoId]
  );
  if (!rows[0]) {
    throw new AppError('Anexo não encontrado.', 404, 'ANEXO_NAO_ENCONTRADO');
  }
  return rows[0];
}

async function remover(anexoId) {
  const { rows } = await pool.query(
    'DELETE FROM anexo WHERE id = $1 RETURNING armazenamento, chave_externa',
    [anexoId]
  );
  if (!rows[0]) {
    throw new AppError('Anexo não encontrado.', 404, 'ANEXO_NAO_ENCONTRADO');
  }
  if (rows[0].armazenamento === 'supabase') await armazenamento.apagar(rows[0].chave_externa);
}

module.exports = {
  anexar,
  listar,
  buscarMetadados,
  buscarConteudo,
  remover,
  TAMANHO_MAXIMO_BYTES,
  LIMITE_POR_CHAMADO,
  TIPOS_ACEITOS,
};

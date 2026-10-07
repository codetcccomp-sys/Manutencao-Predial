const crypto = require('crypto');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Onde moram os bytes dos anexos.
 *
 * `banco` (padrão): no próprio Postgres, em bytea. Nada a configurar.
 *
 * `supabase`: no Supabase Storage, num bucket PRIVADO. A API continua sendo o
 * único caminho até o arquivo — ela lê o objeto com a chave de serviço e o
 * entrega depois de conferir a permissão do chamado, exatamente como faz com
 * o bytea. Não há URL pública nem assinada saindo para o navegador: um link
 * de arquivo que vaza por print ou por histórico não pode abrir a foto de um
 * chamado de outra pessoa.
 *
 * Variáveis (só no backend; a chave de serviço ignora as políticas de acesso
 * do banco e nunca pode ir para o frontend):
 *   ANEXOS_ARMAZENAMENTO=supabase
 *   SUPABASE_URL=https://<projeto>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<chave de serviço>
 *   ANEXOS_BUCKET=anexos          (opcional)
 */

// Cada operação tem prazo: sem ele, um Storage lento seguraria a função até o
// limite de tempo da Vercel, e o erro que chegaria à tela seria "erro interno"
// em vez de "armazenamento indisponível".
const PRAZO_MS = 10_000;

function modo() {
  return process.env.ANEXOS_ARMAZENAMENTO === 'supabase' ? 'supabase' : 'banco';
}

function configuracaoSupabase() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.ANEXOS_BUCKET || 'anexos';
  if (!url || !chave) {
    // Configuração pela metade é erro de quem configurou, e precisa aparecer
    // no log com o nome da variável — mas a resposta não conta isso a quem
    // tentou anexar.
    console.error('[armazenamento] ANEXOS_ARMAZENAMENTO=supabase sem SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.');
    throw new AppError('O armazenamento de anexos não está configurado.', 503, 'ARMAZENAMENTO_INDISPONIVEL');
  }
  return { url, chave, bucket };
}

function indisponivel(motivo) {
  console.error(`[armazenamento] ${motivo}`);
  return new AppError(
    'O armazenamento de anexos não respondeu. Tente de novo em instantes.',
    502,
    'ARMAZENAMENTO_INDISPONIVEL'
  );
}

async function pedir(caminho, opcoes) {
  const { url, chave, bucket } = configuracaoSupabase();
  let resposta;
  try {
    resposta = await fetch(`${url}/storage/v1/object/${bucket}/${caminho}`, {
      ...opcoes,
      headers: { Authorization: `Bearer ${chave}`, apikey: chave, ...opcoes.headers },
      signal: AbortSignal.timeout(PRAZO_MS),
    });
  } catch (err) {
    throw indisponivel(`${opcoes.method} ${caminho}: ${err.message}`);
  }
  return resposta;
}

/** Chave do objeto: por chamado, com um identificador que não se adivinha. */
function novaChave(chamadoId) {
  return `chamados/${Number(chamadoId)}/${crypto.randomUUID()}`;
}

async function guardar(chave, bytes, mimeType) {
  const resposta = await pedir(chave, {
    method: 'POST',
    headers: { 'Content-Type': mimeType, 'x-upsert': 'false' },
    body: bytes,
  });
  if (!resposta.ok) throw indisponivel(`envio de ${chave} recusado: ${resposta.status}`);
}

async function ler(chave) {
  const resposta = await pedir(chave, { method: 'GET', headers: {} });
  if (!resposta.ok) throw indisponivel(`leitura de ${chave} recusada: ${resposta.status}`);
  return Buffer.from(await resposta.arrayBuffer());
}

/**
 * Apaga o objeto. Falhar aqui não desfaz a remoção do anexo: o registro já
 * saiu, e um arquivo órfão no Storage é espaço desperdiçado, não dado exposto
 * (o bucket é privado e a chave não aparece em lugar nenhum). Fica no log.
 */
async function apagar(chave) {
  try {
    const resposta = await pedir(chave, { method: 'DELETE', headers: {} });
    if (!resposta.ok && resposta.status !== 404) {
      console.error(`[armazenamento] remoção de ${chave} recusada: ${resposta.status}`);
    }
  } catch (err) {
    console.error(`[armazenamento] remoção de ${chave} falhou: ${err.message}`);
  }
}

module.exports = { modo, novaChave, guardar, ler, apagar };

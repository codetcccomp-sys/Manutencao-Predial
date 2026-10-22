// Para onde o semeador escreve, e com que credenciais.
//
// O semeador (semear.mjs) cria contas e chamados pela API. Contra o banco local
// do vídeo ele usa os valores de sempre; contra uma API publicada (a da
// demonstração) não existe valor padrão para nada que seja credencial, e ele
// recusa o endereço da produção e qualquer API que não diga, pelo próprio banco,
// que é de demonstração (/health/db → demonstracao, ver
// backend/database/guarda-demonstracao.js).

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// Os endereços da produção: o do site, o da API e os que a Vercel atribui aos
// projetos dela. Os da demonstração têm "-demo" no nome e não casam.
const PRODUCAO = /\/\/(conserva-predial\.vercel\.app|manutencao-predial[a-z0-9-]*\.vercel\.app)/i;

export function resolverDestino(env = process.env) {
  const api = String(env.API ?? 'http://localhost:3333').replace(/\/+$/, '');
  const local = LOCAL.test(api);

  if (!local) {
    if (PRODUCAO.test(api)) throw new Error(`recusado: ${api} é o endereço da PRODUÇÃO.`);
    if (!api.startsWith('https://')) throw new Error(`recusado: uma API publicada precisa de https (${api}).`);
  }

  // Vazio vale como ausente: um segredo do GitHub que não existe chega como "".
  const pegar = (nome, padraoLocal) => env[nome] || (local ? padraoLocal : undefined);
  const destino = {
    api,
    local,
    adminEmail: pegar('SEMEAR_ADMIN_EMAIL', 'admin_video@exemplo.com'),
    adminSenha: pegar('SEMEAR_ADMIN_SENHA', 'senha_video_local'),
    senha: pegar('SEMEAR_SENHA', 'senha-teste-123'),
    // Sem o segredo do agendador as duas tarefas automáticas não rodam; fora do
    // banco local isso é aceito, e a tela tem o botão "Gerar agora".
    cron: pegar('SEMEAR_CRON_SECRET', 'video'),
  };

  const faltando = ['SEMEAR_ADMIN_EMAIL', 'SEMEAR_ADMIN_SENHA', 'SEMEAR_SENHA'].filter(
    (nome) => !env[nome] && !local
  );
  if (faltando.length) throw new Error(`defina ${faltando.join(', ')} para semear uma API publicada.`);
  return destino;
}

/** A API publicada precisa responder, pelo banco dela, que é de demonstração. */
export async function conferirDemonstracao(api, buscar = fetch) {
  let corpo = null;
  try {
    corpo = await (await buscar(`${api}/health/db`)).json();
  } catch {
    /* tratado abaixo, com a mesma recusa */
  }
  if (corpo?.demonstracao !== true) {
    throw new Error(
      `recusado: ${api} não confirma ser uma API de demonstração (/health/db → demonstracao). ` +
        'Rode antes a trava do banco (database/guarda-demonstracao.js --marcar) e confira o DATABASE_URL da API.'
    );
  }
}

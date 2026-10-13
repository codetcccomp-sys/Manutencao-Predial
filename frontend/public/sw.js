/**
 * Service worker do Conserva Predial.
 *
 * Duas coisas, e só duas:
 *
 * 1. O aplicativo abre sem conexão. A casca (o index.html e os arquivos de
 *    /assets, que têm o hash no nome e nunca mudam) fica guardada. Navegação
 *    é rede primeiro: com conexão, sempre a versão nova; sem, a guardada.
 *
 * 2. O técnico consulta a fila e os chamados no subsolo, na casa de máquinas,
 *    onde o sinal não chega. As LEITURAS da fila e do chamado são rede
 *    primeiro, com a última resposta guardada como reserva — e a reserva
 *    volta marcada (`X-Servido-Do-Cache`), para a tela avisar que aquilo é a
 *    última versão salva, não o estado de agora.
 *
 * O que NÃO faz: guardar escrita para mandar depois. Mudar o estado de um
 * chamado sem conexão e sincronizar mais tarde exigiria resolver conflito
 * (outra pessoa pode ter reatribuído ou cancelado enquanto isso), e um
 * conflito resolvido errado é um registro de manutenção falso. Sem conexão, a
 * escrita falha na hora e a tela diz que nada foi registrado.
 *
 * Os dados guardados são de quem estava logado: a tela apaga o cache de
 * dados no login e no logout (mensagem 'limpar-dados'), para um aparelho
 * compartilhado não mostrar a fila de uma pessoa a outra.
 */

const VERSAO = 'v1';
const CASCA = `casca-${VERSAO}`;
const DADOS = 'dados';

// Leituras que valem guardar: a fila (lista de chamados), o chamado e o que
// se lê dentro dele. O conteúdo dos anexos fica de fora — é pesado, e é o
// que estoura a cota de armazenamento de um celular simples.
const LEITURAS_GUARDADAS = [
  /^\/api\/chamados$/,
  /^\/api\/chamados\/\d+$/,
  /^\/api\/chamados\/\d+\/(comentarios|anexos|materiais)$/,
  /^\/api\/usuarios\/me$/,
  /^\/api\/equipamentos\/\d+$/,
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CASCA).then((cache) => cache.add('/')));
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(nomes.filter((n) => n !== CASCA && n !== DADOS).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (evento) => {
  if (evento.data === 'limpar-dados') evento.waitUntil(caches.delete(DADOS));
});

async function casca(requisicao) {
  try {
    const resposta = await fetch(requisicao);
    if (resposta.ok) {
      const cache = await caches.open(CASCA);
      await cache.put('/', resposta.clone());
    }
    return resposta;
  } catch {
    const guardada = await caches.match('/');
    return guardada || Response.error();
  }
}

async function arquivoImutavel(requisicao) {
  const guardado = await caches.match(requisicao);
  if (guardado) return guardado;
  const resposta = await fetch(requisicao);
  // Um arquivo de /assets que deixou de existir (o sistema foi atualizado e o
  // nome com o hash mudou) não volta 404: o rewrite do Vercel responde 200 com
  // o index.html. Guardar isso como se fosse o JavaScript pedido fixaria o erro
  // para sempre, porque este cache nunca é reconferido. Com as telas da gestão
  // carregando sob demanda, esse pedido passa a acontecer de verdade.
  const ehPaginaHtml = (resposta.headers.get('content-type') || '').includes('text/html');
  if (resposta.ok && !ehPaginaHtml) {
    const cache = await caches.open(CASCA);
    await cache.put(requisicao, resposta.clone());
  }
  return resposta;
}

async function leitura(requisicao) {
  try {
    const resposta = await fetch(requisicao);
    if (resposta.ok) {
      const cache = await caches.open(DADOS);
      await cache.put(requisicao, resposta.clone());
    }
    return resposta;
  } catch {
    const guardada = await caches.match(requisicao, { cacheName: DADOS });
    if (!guardada) return Response.error();
    const cabecalhos = new Headers(guardada.headers);
    cabecalhos.set('X-Servido-Do-Cache', '1');
    return new Response(await guardada.blob(), {
      status: guardada.status,
      statusText: guardada.statusText,
      headers: cabecalhos,
    });
  }
}

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request;
  // Escrita vai direto para a rede: ver o comentário do topo.
  if (requisicao.method !== 'GET') return;

  const url = new URL(requisicao.url);
  if (url.origin !== self.location.origin) return;

  if (requisicao.mode === 'navigate') {
    evento.respondWith(casca(requisicao));
  } else if (url.pathname.startsWith('/assets/')) {
    evento.respondWith(arquivoImutavel(requisicao));
  } else if (LEITURAS_GUARDADAS.some((padrao) => padrao.test(url.pathname))) {
    evento.respondWith(leitura(requisicao));
  }
});

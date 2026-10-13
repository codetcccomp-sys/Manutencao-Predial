import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import fonteDoServiceWorker from '../public/sw.js?raw';

/**
 * O service worker roda o arquivo public/sw.js de verdade, num contexto isolado
 * com `self`, `caches` e `fetch` trocados por simulações. Nenhum navegador
 * entra: o que se prova aqui é a decisão de guardar ou não uma resposta.
 *
 * O caso que importa nasceu com as telas da gestão carregando sob demanda. Um
 * arquivo de /assets que deixou de existir (o sistema foi atualizado e o hash
 * mudou) não volta 404 na Vercel: o rewrite devolve o index.html com 200. Se o
 * service worker o guardasse como se fosse o JavaScript pedido, o erro ficaria
 * fixado para sempre, porque o cache de arquivos com hash nunca é reconferido.
 */

const ORIGEM = 'https://app.teste';

function carregar(aoBuscar) {
  const ouvintes = {};
  const cache = { put: vi.fn(async () => {}), add: vi.fn(async () => {}) };
  const caches = {
    open: vi.fn(async () => cache),
    match: vi.fn(async () => undefined),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
  };
  const contexto = {
    self: {
      location: { origin: ORIGEM },
      addEventListener: (tipo, funcao) => {
        ouvintes[tipo] = funcao;
      },
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    },
    caches,
    fetch: aoBuscar,
    Response,
    Headers,
    URL,
  };
  vm.runInNewContext(fonteDoServiceWorker, contexto);
  return { ouvintes, cache, caches };
}

async function pedir(ouvintes, caminho) {
  let resposta;
  ouvintes.fetch({
    request: { method: 'GET', url: `${ORIGEM}${caminho}`, mode: 'no-cors' },
    respondWith: (promessa) => {
      resposta = promessa;
    },
  });
  return resposta;
}

const javascript = () =>
  new Response('export default 1;', { status: 200, headers: { 'content-type': 'text/javascript' } });

describe('service worker: arquivos com hash em /assets', () => {
  it('guarda o JavaScript que a rede devolveu', async () => {
    const { ouvintes, cache } = carregar(vi.fn(async () => javascript()));

    const resposta = await pedir(ouvintes, '/assets/Relatorios-AbC123.js');

    expect(resposta.status).toBe(200);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('não guarda o index.html que o rewrite devolve no lugar de um arquivo que sumiu', async () => {
    const html = new Response('<!doctype html><html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    const { ouvintes, cache } = carregar(vi.fn(async () => html));

    const resposta = await pedir(ouvintes, '/assets/Relatorios-Velho999.js');

    // A página recebe a resposta como veio (o import falha e a tela de erro
    // aparece); só não a fixamos no cache.
    expect(resposta.headers.get('content-type')).toContain('text/html');
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('não guarda resposta de erro', async () => {
    const { ouvintes, cache } = carregar(vi.fn(async () => new Response('nada', { status: 404 })));

    await pedir(ouvintes, '/assets/Relatorios-AbC123.js');

    expect(cache.put).not.toHaveBeenCalled();
  });

  it('serve do cache sem ir à rede quando já tem o arquivo', async () => {
    const aoBuscar = vi.fn(async () => javascript());
    const { ouvintes, caches } = carregar(aoBuscar);
    caches.match.mockResolvedValueOnce(javascript());

    const resposta = await pedir(ouvintes, '/assets/Relatorios-AbC123.js');

    expect(resposta.status).toBe(200);
    expect(aoBuscar).not.toHaveBeenCalled();
  });
});

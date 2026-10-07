/**
 * Registro do service worker (public/sw.js) e a limpeza dos dados guardados.
 *
 * Só na build de produção: no `vite dev` o service worker guardaria arquivos
 * que o HMR troca a cada segundo, e o que se via na tela deixaria de ser o
 * código que se acabou de salvar.
 */
export function registrarServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Sem service worker o sistema funciona igual, só não abre offline.
    });
  });
}

/**
 * Apaga as leituras guardadas para uso sem conexão.
 *
 * Chamado no login e no logout: num aparelho compartilhado (o celular da
 * equipe, o computador da portaria), a fila guardada de uma pessoa não pode
 * aparecer para a próxima que entrar.
 */
export function limparDadosOffline() {
  try {
    navigator.serviceWorker?.controller?.postMessage('limpar-dados');
  } catch {
    // Sem service worker, não há o que limpar.
  }
  // Também direto pela Cache API: a mensagem só chega se houver um service
  // worker controlando a página, e a primeira visita ainda não tem.
  if (typeof caches !== 'undefined') caches.delete('dados').catch(() => {});
}

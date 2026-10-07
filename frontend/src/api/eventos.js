// Nomes dos eventos que o cliente da API emite na janela. Num módulo à parte
// para quem só escuta (o aviso de conexão, no cabeçalho) não depender do
// cliente — e não quebrar nos testes que trocam o cliente por um dublê.

// O que a tela mostra veio da rede agora (detail: false) ou é a última versão
// guardada pelo service worker, sem conexão (detail: true).
export const EVENTO_DADOS_GUARDADOS = 'smp:dados-guardados';

/**
 * Medidas de desempenho da web, pela API do próprio navegador (PerformanceObserver).
 *
 * Quatro, as que o Google chama de "Core Web Vitals" mais uma: FCP (primeiro conteúdo),
 * LCP (maior elemento visível), CLS (o quanto a tela pula) e INP (a resposta mais lenta a
 * um toque ou clique). Sem biblioteca, sem rede, sem nada guardado: o que se lê é o que o
 * navegador já mede, e vai uma vez por visita, quando a página é escondida ou fechada.
 *
 * Medem a CARGA da página (o que se vê ao abrir ou recarregar). A troca de tela dentro do
 * aplicativo não é uma carga e não é medida aqui: ela custa só o que a tela baixa, e isso se
 * vê nos números da API.
 */

/** O CLS é a pior "janela" de deslocamentos: de até 5 s, com folga de no máximo 1 s entre dois. */
export function calcularCLS(entradas) {
  let pior = 0;
  let janela = 0;
  let inicio = 0;
  let ultimo = 0;
  for (const e of entradas) {
    if (e.hadRecentInput) continue;
    if (janela && (e.startTime - ultimo > 1000 || e.startTime - inicio > 5000)) janela = 0;
    if (!janela) inicio = e.startTime;
    janela += e.value;
    ultimo = e.startTime;
    pior = Math.max(pior, janela);
  }
  return pior;
}

/**
 * @param {object} p
 * @param {(metrica: string, valor: number) => void} p.registrar  quem recebe cada medida
 * @param {typeof PerformanceObserver} p.Observador               injetável, para o teste
 * @param {(aoEsconder: () => void) => void} p.aoEsconder         chama a função quando a página é escondida
 */
export function coletarVitais({ registrar, Observador, aoEsconder }) {
  if (typeof Observador !== 'function') return;

  let lcp = null;
  let inp = 0;
  const deslocamentos = [];
  const interacoes = new Map();

  function observar(tipo, tratar, extra = {}) {
    try {
      new Observador((lista) => lista.getEntries().forEach(tratar)).observe({ type: tipo, buffered: true, ...extra });
    } catch {
      // Navegador sem esse tipo de entrada (Safari, o Firefox antigo): essa medida fica de fora.
    }
  }

  observar('paint', (e) => {
    if (e.name === 'first-contentful-paint') registrar('FCP', e.startTime);
  });
  observar('largest-contentful-paint', (e) => {
    lcp = e.startTime;
  });
  observar('layout-shift', (e) => deslocamentos.push(e));
  observar(
    'event',
    (e) => {
      if (!e.interactionId) return;
      const atual = interacoes.get(e.interactionId) ?? 0;
      if (e.duration > atual) interacoes.set(e.interactionId, e.duration);
      inp = Math.max(inp, e.duration);
    },
    { durationThreshold: 40 }
  );

  let enviado = false;
  aoEsconder(() => {
    if (enviado) return;
    enviado = true;
    if (lcp !== null) registrar('LCP', lcp);
    if (deslocamentos.length) registrar('CLS', calcularCLS(deslocamentos));
    if (interacoes.size) registrar('INP', inp);
  });
}

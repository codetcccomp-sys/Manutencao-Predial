import { criarTelemetria, eRuido } from './telemetria';
import { coletarVitais } from './vitais';

/**
 * A telemetria do aplicativo: a instância única e quem a liga.
 *
 * Em teste (Vitest) e fora de um navegador, ela nasce desligada: nenhuma tela mede nem
 * envia nada por acaso. Só `iniciarMonitoramento`, chamada uma vez em `main.jsx`, ativa
 * os ouvintes.
 */

const emTeste = import.meta.env.MODE === 'test';
const semNavegador = typeof window === 'undefined';

// "Não rastrear" e o Controle de Privacidade Global (sinal de que a pessoa não quer ser medida).
function pediuParaNaoSerMedida() {
  const nav = typeof navigator === 'undefined' ? {} : navigator;
  return nav.doNotTrack === '1' || window.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

// Mesma origem e o cabeçalho que o resto da tela manda. `keepalive` deixa o envio terminar mesmo com
// a página sendo fechada. Falha de rede aqui não é da conta de ninguém: telemetria nunca atrapalha o uso.
function enviar(caminho, corpo) {
  try {
    fetch(`/api${caminho}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Conserva': '1' },
      body: JSON.stringify(corpo),
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {});
  } catch {
    // Navegador sem fetch: não há como enviar.
  }
}

export const telemetria = criarTelemetria({
  enviar,
  desligada: () => emTeste || semNavegador,
  semMedicao: () => !semNavegador && pediuParaNaoSerMedida(),
});

// A tela em que a página foi carregada: é a dona das medidas de desempenho.
let telaDaCarga = null;
let telaAtual = 'outra';

/** Chamada a cada troca de caminho, com o MODELO da rota (nunca o caminho real). */
export function registrarTela(tela) {
  telaAtual = tela;
  if (telaDaCarga === null) telaDaCarga = tela;
  telemetria.registrarTela(tela);
}

export const registrarAcao = (nome) => telemetria.registrarAcao(nome);

export function registrarErro(erro, pilha) {
  telemetria.registrarErro({
    mensagem: typeof erro === 'string' ? erro : erro?.message,
    tela: telaAtual,
    pilha: pilha ?? erro?.stack,
  });
}

let iniciado = false;

export function iniciarMonitoramento() {
  if (iniciado || emTeste || semNavegador) return;
  iniciado = true;

  window.addEventListener('error', (e) => {
    // Erro de outro endereço (extensão do navegador, script de fora) não é do aplicativo.
    if (e.filename && !e.filename.startsWith(window.location.origin)) return;
    if (!eRuido(e.message)) registrarErro(e.error ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const motivo = e.reason;
    if (!eRuido(motivo?.message ?? motivo)) registrarErro(motivo instanceof Error ? motivo : String(motivo));
  });

  const aoEsconder = (funcao) => {
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && funcao());
    window.addEventListener('pagehide', funcao);
  };
  coletarVitais({
    registrar: (metrica, valor) => telemetria.registrarMedida(metrica, telaDaCarga ?? 'outra', valor),
    Observador: window.PerformanceObserver,
    aoEsconder,
  });

  // Envia o que juntou de tempos em tempos, e quando a página é escondida (a pessoa trocou de aba ou fechou).
  setInterval(telemetria.descarregar, 30_000);
  aoEsconder(telemetria.descarregar);
}

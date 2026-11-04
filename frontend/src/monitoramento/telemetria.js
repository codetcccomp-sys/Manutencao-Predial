/**
 * Uso, desempenho e erros da tela, para a administração (docs/lgpd.md, seção 8).
 *
 * É a ponta do aplicativo do que a migração 031 guarda: contadores por dia, sem
 * ninguém. Três regras seguram tudo:
 *
 * - **A tela vai pelo MODELO da rota** (`/chamados/:id`), nunca pelo caminho real.
 *   Quem chama passa o modelo (`padraoDaRota`); aqui nada olha o endereço.
 * - **Nada é guardado no aparelho.** Não há cookie, nem `localStorage`, nem
 *   identificador: os números ficam em memória até o envio. Quem recarrega a página
 *   começa do zero, e é isso que impede de reconhecer a mesma pessoa em dois dias.
 * - **Quem pede para não ser medido não é.** "Não rastrear" (DNT) ou "Controle de
 *   Privacidade Global" ligados no navegador desligam o uso e o desempenho. O erro
 *   da tela continua: ele não identifica ninguém e é como o defeito chega a quem o
 *   conserta, mas leva a mensagem sem e-mail (o servidor mascara) e a tela pelo modelo.
 *
 * A fábrica recebe `enviar` e os predicados de fora para ser testada sem rede e sem
 * navegador; o que o aplicativo usa de fato está em `./index.js`.
 */

const MAX_CONTAGEM = 100; // o mesmo teto do servidor
const MAX_MEDIDAS = 12;
const MAX_ERROS_POR_CARGA = 5;

export function criarTelemetria({ enviar, desligada = () => false, semMedicao = () => false }) {
  let telas = {};
  let acoes = {};
  let medidas = [];
  const erros = new Set();

  const contar = (alvo, nome) => ({ ...alvo, [nome]: Math.min((alvo[nome] ?? 0) + 1, MAX_CONTAGEM) });
  const medindo = () => !desligada() && !semMedicao();

  function registrarTela(tela) {
    if (medindo()) telas = contar(telas, tela);
  }

  function registrarAcao(nome) {
    if (medindo()) acoes = contar(acoes, nome);
  }

  function registrarMedida(metrica, tela, valor) {
    if (!medindo() || !Number.isFinite(valor) || valor < 0 || medidas.length >= MAX_MEDIDAS) return;
    medidas = [...medidas, { metrica, tela, valor: Math.round(valor * 1000) / 1000 }];
  }

  /** Manda o que juntou e zera. Sem nada, não faz requisição. */
  function descarregar() {
    if (!Object.keys(telas).length && !Object.keys(acoes).length && medidas.length === 0) return;
    const corpo = { telas, acoes, desempenho: medidas };
    telas = {};
    acoes = {};
    medidas = [];
    enviar('/telemetria', corpo);
  }

  /**
   * Um erro da tela. No máximo cinco por carga e uma vez cada mensagem: um laço que falha
   * a cada quadro não pode virar uma enxurrada de requisições.
   */
  function registrarErro({ mensagem, tela, pilha }) {
    if (desligada() || typeof mensagem !== 'string' || !mensagem.trim()) return;
    const chave = mensagem.slice(0, 200);
    if (erros.has(chave) || erros.size >= MAX_ERROS_POR_CARGA) return;
    erros.add(chave);
    enviar('/telemetria/erro', {
      mensagem: chave,
      tela,
      ...(typeof pilha === 'string' ? { pilha: pilha.slice(0, 4000) } : {}),
    });
  }

  return { registrarTela, registrarAcao, registrarMedida, registrarErro, descarregar };
}

/** Erros que não são do aplicativo nem de quem o usa: o navegador reclamando de si mesmo. */
const RUIDO = [/ResizeObserver loop/i, /^Script error\.?$/i, /Non-Error promise rejection captured/i];

export const eRuido = (mensagem) => RUIDO.some((regra) => regra.test(String(mensagem ?? '')));

import gsap from 'gsap';

/**
 * Regras de movimento do sistema, num lugar só.
 *
 * Duas camadas animam a interface: CSS (entrada de página, modal, aviso, barras)
 * e GSAP (contagem de números e entrada em sequência das listas). O CSS já
 * obedece a `prefers-reduced-motion` pela regra global de index.css; o GSAP não,
 * porque anima por JavaScript. `reduzMovimento` é a mesma regra para ele.
 */

/**
 * Quem pediu menos movimento recebe o estado final na hora, sem animação.
 *
 * Fora de um navegador (jsdom nos testes de componente) não há `matchMedia`, e
 * o caminho seguro é NÃO animar: o teste vê o valor final no primeiro quadro, e
 * ninguém precisa esperar relógio para conferir um texto.
 */
export function reduzMovimento() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Curva de desaceleração suave: sai rápido e assenta, sem "quicar". */
export const CURVA = 'power3.out';

export { gsap };

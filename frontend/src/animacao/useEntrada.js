import { useLayoutEffect } from 'react';
import { CURVA, gsap, reduzMovimento } from './movimento';

/**
 * Faz os elementos marcados com `data-anim` entrarem em sequência: sobem
 * levemente e passam de desfocados para nítidos.
 *
 * - `useLayoutEffect`, e não `useEffect`: o estado inicial (invisível) precisa
 *   valer antes do primeiro quadro pintado. Com `useEffect` o conteúdo aparece
 *   inteiro por um instante e some para então entrar — um piscar que parece
 *   defeito.
 * - O atraso entre os itens tem teto de meio segundo no total. Uma lista de 20
 *   chamados com 60 ms cada levaria mais de um segundo para terminar, e animação
 *   que faz esperar para ler deixa de ser enfeite e vira obstáculo.
 * - `clearProps` devolve o elemento ao estilo normal no fim. Um `filter` ou
 *   `transform` que sobrasse criaria um bloco de contenção novo e faria
 *   `position: fixed` (o painel de avisos, os modais) se ancorar no elemento em
 *   vez da janela.
 * - O `ctx.revert()` na limpeza também restaura o estado quando a tela some no
 *   meio da animação.
 *
 * `dependencias` diz quando repetir: a lista chega depois da requisição, então
 * a animação precisa esperar os itens existirem.
 */
export function useEntrada(ref, dependencias = []) {
  useLayoutEffect(() => {
    const raiz = ref.current;
    if (!raiz || reduzMovimento()) return undefined;

    const alvos = raiz.querySelectorAll('[data-anim]');
    if (alvos.length === 0) return undefined;

    const contexto = gsap.context(() => {
      gsap.from(alvos, {
        opacity: 0,
        y: 14,
        filter: 'blur(6px)',
        duration: 0.55,
        ease: CURVA,
        stagger: { amount: Math.min(0.45, alvos.length * 0.06) },
        clearProps: 'opacity,transform,filter',
        // Estado inicial na hora. Por padrão o GSAP pode ADIAR a primeira pintura de
        // um from() para o próximo tick do ticker, conforme o estado dele (ver
        // `lazy` em gsap-core.js). Num navegador isso cai antes do quadro e não se
        // vê; mas deixa de ser verdade que "o item já está escondido quando o
        // layout effect termina", e foi um teste que dependia disso que falhou no
        // CI sem falhar localmente.
        lazy: false,
      });
    }, raiz);

    return () => contexto.revert();
    // `ref` é estável por construção; as dependências são as da tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencias);
}

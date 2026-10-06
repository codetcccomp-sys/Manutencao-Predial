import { useLayoutEffect, useRef } from 'react';
import { CURVA, gsap, reduzMovimento } from './movimento';

/**
 * Lista que se reorganiza com movimento: o cartão que continua na lista desliza
 * do lugar antigo para o novo, e o que acabou de chegar entra em sequência.
 *
 * É a técnica FLIP (First, Last, Invert, Play): mede onde cada item estava,
 * deixa o React colocá-lo onde ele vai ficar, e anima do antigo para o novo
 * por `transform`, que não força o navegador a refazer o layout a cada quadro.
 * Os itens se identificam por `data-flip="<id>"` — a chave estável, e não a
 * posição, é o que diz que "este é o mesmo chamado de antes".
 *
 * Duas decisões que não são óbvias:
 *
 * - **As posições vêm relativas ao contêiner**, não à janela. A rolagem da
 *   página muda as coordenadas da janela sem mover nada na lista, e comparar
 *   coordenadas de janela animaria um "movimento" que é só a pessoa rolando.
 *
 * - **O retrato anterior sobrevive ao esqueleto.** Cada troca de filtro nestas
 *   telas liga `carregando` e troca a lista por um esqueleto antes de trazer os
 *   itens de volta. Se o retrato fosse refeito a cada render, ele estaria
 *   vazio quando a lista voltasse e todo item pareceria novo — o deslizar nunca
 *   aconteceria. Render sem nenhum item marcado não apaga o que se sabia.
 *
 * Quem pediu menos movimento recebe a lista direto no lugar.
 */
export function useListaAnimada(ref, dependencias = []) {
  const anteriores = useRef(new Map());

  useLayoutEffect(() => {
    const raiz = ref.current;
    if (!raiz) return undefined;

    const itens = [...raiz.querySelectorAll('[data-flip]')];
    if (itens.length === 0) return undefined;

    // Posições de agora, medidas antes de qualquer animação começar.
    const origem = raiz.getBoundingClientRect();
    const agora = new Map(
      itens.map((no) => {
        const r = no.getBoundingClientRect();
        return [no.dataset.flip, { x: r.left - origem.left, y: r.top - origem.top }];
      })
    );

    const antes = anteriores.current;
    anteriores.current = agora;

    if (reduzMovimento()) return undefined;

    const novos = itens.filter((no) => !antes.has(no.dataset.flip));
    // Menos de 1px é arredondamento de layout, não movimento.
    const movidos = itens.filter((no) => {
      const a = antes.get(no.dataset.flip);
      const n = agora.get(no.dataset.flip);
      return a && (Math.abs(a.x - n.x) > 1 || Math.abs(a.y - n.y) > 1);
    });
    if (novos.length === 0 && movidos.length === 0) return undefined;

    const contexto = gsap.context(() => {
      movidos.forEach((no) => {
        const a = antes.get(no.dataset.flip);
        const n = agora.get(no.dataset.flip);
        // Começa no lugar antigo (a diferença, em transform) e vai para o zero.
        gsap.fromTo(
          no,
          { x: a.x - n.x, y: a.y - n.y },
          { x: 0, y: 0, duration: 0.5, ease: CURVA, clearProps: 'transform' }
        );
      });

      if (novos.length > 0) {
        gsap.from(novos, {
          opacity: 0,
          y: 14,
          filter: 'blur(6px)',
          duration: 0.55,
          ease: CURVA,
          stagger: { amount: Math.min(0.45, novos.length * 0.06) },
          clearProps: 'opacity,transform,filter',
        });
      }
    }, raiz);

    return () => contexto.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencias);
}

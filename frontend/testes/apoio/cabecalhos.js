import { expect } from 'vitest';

/**
 * Confere a árvore de cabeçalhos de uma tela.
 *
 * Quem usa leitor de tela navega por cabeçalhos — é o atalho equivalente a
 * correr o olho pela página. Duas coisas quebram esse atalho:
 *
 * 1. Não haver <h1>: a pessoa cai no meio da árvore sem saber onde está.
 * 2. Pular nível (h1 direto para h3): o leitor anuncia "nível 3" e a pessoa
 *    procura o nível 2 que nunca vem, concluindo que perdeu conteúdo.
 *
 * As telas internas deste sistema começavam em <h2> sem <h1> nenhum, e os
 * painéis ficavam em <h3>. Depois da correção a árvore é h1 (o que esta tela
 * é) → h2 (cada painel) → h3 (subdivisão dentro de um painel).
 */
export function conferirCabecalhos(container) {
  const niveis = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .filter((el) => !el.closest('[aria-hidden="true"]'))
    .map((el) => ({ nivel: Number(el.tagName[1]), texto: el.textContent.trim() }));

  const titulos = niveis.filter((h) => h.nivel === 1);
  expect(titulos, 'a tela precisa de exatamente um <h1>').toHaveLength(1);
  expect(niveis[0]?.nivel, 'o primeiro cabeçalho da tela precisa ser o <h1>').toBe(1);

  let anterior = 1;
  for (const { nivel, texto } of niveis.slice(1)) {
    expect(
      nivel,
      `"${texto}" está em h${nivel} depois de um h${anterior}: a árvore pula nível`
    ).toBeLessThanOrEqual(anterior + 1);
    anterior = nivel;
  }

  return niveis;
}

import { useEffect, useRef } from 'react';

/**
 * O que um diálogo precisa para ser usável por teclado, num lugar só.
 *
 * Nasceu dentro de `Confirmacao` e saiu de lá quando o painel lateral de resumo
 * precisou das mesmas três coisas — e comportamento de foco copiado em dois
 * componentes diverge na primeira correção que entrar em só um deles:
 *
 * 1. O foco entra e não sai enquanto está aberto (Tab dá a volta).
 * 2. Esc fecha.
 * 3. O foco volta para quem abriu.
 *
 * `aoFechar` e `bloqueado` ficam em refs, e o efeito só depende de `aberto`:
 * quem chama passa uma seta nova a cada render, e com ela nas dependências o
 * efeito se refazia enquanto o diálogo estava aberto — a limpeza devolvia o foco
 * ao botão ATRÁS do diálogo, sem ninguém ter fechado nada. Enquanto `bloqueado`
 * (uma ação em curso), Esc não fecha: recusar deixou de ser uma saída.
 */
export function useJanelaModal({
  aberto,
  aoFechar,
  bloqueado = false,
  caixa,
  focoInicial,
  focaveis = 'button:not([disabled]), a[href]',
}) {
  const origemDoFoco = useRef(null);
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;
  const ocupado = useRef(bloqueado);
  ocupado.current = bloqueado;

  useEffect(() => {
    if (!aberto) return undefined;

    origemDoFoco.current = document.activeElement;
    caixa.current?.querySelector(focoInicial)?.focus();

    function aoTeclar(evento) {
      if (evento.key === 'Escape') {
        evento.preventDefault();
        if (!ocupado.current) fechar.current();
        return;
      }
      if (evento.key !== 'Tab') return;

      const lista = caixa.current?.querySelectorAll(focaveis);
      if (!lista?.length) return;
      const primeiro = lista[0];
      const ultimo = lista[lista.length - 1];

      // A armadilha é só o ciclo entre o primeiro e o último: no meio da lista o
      // Tab do navegador já faz a coisa certa.
      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      // O `focus` é condicional porque o botão de origem pode ter sumido junto
      // com o item removido.
      if (origemDoFoco.current?.isConnected) origemDoFoco.current.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);
}

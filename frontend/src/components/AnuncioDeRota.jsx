import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { descricaoDaRota, padraoDaRota, tituloDaRota } from '../dominio/titulosDeRota';
import { registrarTela } from '../monitoramento';

/**
 * O que o navegador faz sozinho ao trocar de página e uma SPA não faz.
 *
 * Numa página nova, o navegador põe o título novo na aba, leva o foco ao início
 * e o leitor de tela anuncia a página. No React Router nada disso acontece: o
 * título fica o mesmo e, quando o link clicado some da tela, o foco cai no
 * `body`. Quem usa teclado recomeça do alto, pelo cabeçalho inteiro; quem usa
 * leitor de tela não ouve que mudou de tela.
 *
 * Aqui, a cada troca de CAMINHO (trocar só `?aba=` na mesma tela não conta), o
 * título e a descrição da página são atualizados e o foco vai para o `h1`, que o leitor lê. A primeira
 * carga não mexe no foco: levá-lo ao título de uma página recém-aberta tiraria
 * a pessoa do campo que o navegador já tinha escolhido.
 *
 * O `h1` não é focável por padrão: ganha `tabindex="-1"` (focável por código, fora
 * da ordem do Tab) e perde o anel, que num título só atrapalha. Sem `h1` (uma tela
 * que ainda carrega), o foco vai para o `main`.
 */
export default function AnuncioDeRota() {
  const { pathname } = useLocation();
  const anterior = useRef(pathname);

  useEffect(() => {
    document.title = tituloDaRota(pathname);
    // O `index.html` já traz a meta de descrição (e a de `noindex`); aqui só o texto troca.
    document.querySelector('meta[name="description"]')?.setAttribute('content', descricaoDaRota(pathname));
    // Uma abertura de tela para a contagem de uso, pelo MODELO da rota e nunca pelo caminho real.
    registrarTela(padraoDaRota(pathname));

    if (anterior.current === pathname) return;
    anterior.current = pathname;

    function focar(alvo) {
      if (!alvo.hasAttribute('tabindex')) alvo.setAttribute('tabindex', '-1');
      alvo.classList.add('outline-none');
      alvo.focus();
    }

    const titulo = document.querySelector('h1');
    if (titulo) {
      focar(titulo);
      return undefined;
    }

    // Sem título ainda: a tela é sob demanda (telaSobDemanda) e o pedaço dela está
    // chegando. Enquanto isso o foco vai para o `main`, para quem usa teclado não
    // ficar sem lugar; quando o `h1` aparecer, passa para ele, a não ser que a
    // pessoa já tenha mexido o foco para outro lugar.
    const principal = document.querySelector('main');
    if (!principal) return undefined;
    focar(principal);

    const observador = new MutationObserver(() => {
      const chegou = document.querySelector('h1');
      if (!chegou) return;
      observador.disconnect();
      if (document.activeElement === principal) focar(chegou);
    });
    observador.observe(document.body, { childList: true, subtree: true });
    // Tela que nunca ganha título (ou erro): para de observar.
    const limite = setTimeout(() => observador.disconnect(), 5000);

    return () => {
      clearTimeout(limite);
      observador.disconnect();
    };
  }, [pathname]);

  return null;
}

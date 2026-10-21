import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { tituloDaRota } from '../dominio/titulosDeRota';

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
 * título é atualizado e o foco vai para o `h1`, que o leitor lê. A primeira
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

    if (anterior.current === pathname) return;
    anterior.current = pathname;

    const alvo = document.querySelector('h1') ?? document.querySelector('main');
    if (!alvo) return;
    if (!alvo.hasAttribute('tabindex')) alvo.setAttribute('tabindex', '-1');
    alvo.classList.add('outline-none');
    alvo.focus();
  }, [pathname]);

  return null;
}

import { useLayoutEffect, useRef } from 'react';
import { gsap, reduzMovimento } from './movimento';

const formatar = (n) => Math.round(n).toLocaleString('pt-BR');

/**
 * Um número que sobe do valor anterior até o atual.
 *
 * O texto é escrito direto no nó, e não por estado do React: uma contagem de 60
 * quadros por segundo via `setState` renderizaria o componente 50 vezes para
 * mostrar um número. O `<span>` nasce vazio de propósito para o React não ter
 * um nó de texto seu que a animação pudesse trocar por baixo dele.
 *
 * Sem movimento (preferência do sistema, ou jsdom nos testes) o valor final é
 * escrito na hora, no mesmo ciclo de renderização: quem lê a tela nunca vê um
 * número intermediário que não existe nos dados.
 *
 * Na primeira vez sobe de 0; nas seguintes parte do que estava na tela, porque
 * um indicador que passa de 24 para 25 deve dar um passo, não recomeçar.
 */
function NumeroAnimado({ valor, className = '', duracao = 0.9 }) {
  const no = useRef(null);
  const exibido = useRef(0);

  useLayoutEffect(() => {
    const elemento = no.current;
    if (!elemento) return undefined;

    const final = Number.isFinite(valor) ? valor : 0;

    if (reduzMovimento() || exibido.current === final) {
      elemento.textContent = formatar(final);
      exibido.current = final;
      return undefined;
    }

    const contador = { v: exibido.current };
    elemento.textContent = formatar(contador.v);

    const animacao = gsap.to(contador, {
      v: final,
      duration: duracao,
      ease: 'power2.out',
      onUpdate: () => {
        elemento.textContent = formatar(contador.v);
        exibido.current = contador.v;
      },
      onComplete: () => {
        elemento.textContent = formatar(final);
        exibido.current = final;
      },
    });

    return () => {
      animacao.kill();
      // Interrompida no meio, o que vale é onde a contagem PAROU, não onde
      // ela ia chegar. Se chegou outro valor, o próximo efeito parte daqui e
      // dá o passo que falta; o texto não fica parado num intermediário porque
      // esse efeito começa na mesma hora. E é isso que deixa a contagem
      // sobreviver ao StrictMode, que desmonta e remonta o efeito: a versão
      // anterior pulava para o final aqui, a remontagem via "nada a animar" e
      // o número aparecia pronto.
      exibido.current = contador.v;
    };
  }, [valor, duracao]);

  return <span ref={no} className={className} />;
}

export default NumeroAnimado;

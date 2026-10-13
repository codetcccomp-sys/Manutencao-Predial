import { useEffect, useRef } from 'react';
import Aviso from './ui/Aviso';

/**
 * "Pedido enviado": a conta nova espera a aprovação da gestão (RF01).
 *
 * Existia só no cadastro por e-mail. O cadastro pelo Google mostrava o mesmo
 * estado de outro jeito, como um aviso azul sobre um formulário de login ainda
 * ativo, e a pessoa podia tentar entrar de novo achando que nada tinha
 * acontecido. Dois caminhos para a mesma situação agora têm a mesma tela; o
 * texto e o que vem depois (voltar ao login) são de quem a usa.
 */
function PedidoEnviado({ children, acao }) {
  const titulo = useRef(null);

  // A tela troca o formulário que tinha o foco. Sem levá-lo ao título, o
  // teclado recomeça do topo e o leitor de tela não anuncia a mudança.
  useEffect(() => {
    titulo.current?.focus();
  }, []);

  return (
    <main className="min-h-screen bg-fundo flex items-center justify-center px-4 py-8">
      <div className="bg-superficie rounded-lg border border-borda shadow-sm p-8 w-full max-w-sm grid gap-4">
        <h1 ref={titulo} tabIndex={-1} className="text-xl font-bold text-navy outline-none">
          Pedido enviado
        </h1>
        <Aviso tipo="sucesso">{children}</Aviso>
        {acao}
      </div>
    </main>
  );
}

export default PedidoEnviado;

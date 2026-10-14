import Icone from './ui/Icone';

/**
 * Diz, em todas as telas autenticadas, que isto é a demonstração publicada.
 *
 * O site da demonstração é a mesma build da produção, mudando só o endereço da
 * API e esta variável (VITE_AMBIENTE, definida no projeto da Vercel e embutida
 * na build). Sem a faixa, nada na tela distinguiria um do outro, e quem
 * experimenta poderia achar que o chamado de teste que abriu foi para uma
 * instituição de verdade — ou quem apresenta, que os dados são reais.
 */
export const ehDemonstracao = () => import.meta.env.VITE_AMBIENTE === 'demonstracao';

function FaixaDeDemonstracao() {
  if (!ehDemonstracao()) return null;

  return (
    <div role="note" className="bg-atencao-tenue text-atencao print:hidden">
      <p className="max-w-7xl mx-auto px-4 py-2 text-sm flex items-start gap-2">
        <Icone nome="alerta" classe="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          <strong>Ambiente de demonstração.</strong> Os dados são fictícios e podem ser apagados a
          qualquer momento. Não registre informação de verdade aqui.
        </span>
      </p>
    </div>
  );
}

export default FaixaDeDemonstracao;

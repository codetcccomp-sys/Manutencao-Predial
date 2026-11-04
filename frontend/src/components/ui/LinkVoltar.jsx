import { Link } from 'react-router';

/**
 * "Voltar" no alto das telas que se abrem a partir de uma lista.
 *
 * O destino é fixo (a lista de onde a pessoa costuma vir), e não "a página
 * anterior do histórico": quem acabou de abrir um chamado chega ao detalhe vindo
 * do formulário, e voltar um passo no histórico o devolveria a um formulário
 * vazio. Com o destino fixo, o botão faz sempre a mesma coisa, e o do navegador
 * continua fazendo a sua.
 */
function LinkVoltar({ para = '/', children = 'Voltar' }) {
  return (
    <Link
      to={para}
      className="alvo-toque inline-flex w-fit items-center gap-1 rounded text-sm font-medium text-navy hover:underline"
    >
      <span aria-hidden="true">←</span> {children}
    </Link>
  );
}

export default LinkVoltar;

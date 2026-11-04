import { Link } from 'react-router';
import { useUsuarioSeHouver } from '../../context/AuthContext';

/**
 * A página pública de texto corrido: aviso de privacidade, termos de uso,
 * cookies e suporte.
 *
 * Todas ficam fora do login (quem ainda vai se cadastrar precisa poder lê-las) e
 * têm o mesmo corpo: uma coluna estreita, de leitura confortável, com um `h1`,
 * seções com `h2` e, no fim, a navegação entre elas. Cada uma escrevia a própria
 * casca; aqui fica uma só, e a navegação entre as quatro não diverge.
 */

export const LINK = 'font-medium text-navy underline';
// Link solto, fora de um parágrafo: alvo de ao menos 24px (WCAG 2.5.8), e 44px no toque.
export const LINK_SOLTO = `${LINK} alvo-toque inline-block py-1`;
export const LISTA = 'grid list-disc gap-1.5 pl-5';

export function Secao({ titulo, children }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-base font-semibold text-navy">{titulo}</h2>
      {children}
    </section>
  );
}

/**
 * Os caminhos entre as páginas de informação, e de volta ao sistema.
 *
 * "Entrar" e "Criar conta" ficam aqui: a página costuma ser aberta em outra aba
 * por quem ainda vai se cadastrar, e o caminho natural de volta é um dos dois.
 * Para quem já está logado, o caminho é o início do sistema.
 */
export function NavegacaoDasPaginas({ atual }) {
  const logado = Boolean(useUsuarioSeHouver());
  const paginas = [
    ['/termos', 'Termos de uso'],
    ['/privacidade', 'Aviso de privacidade'],
    ['/cookies', 'Cookies e armazenamento'],
    ['/suporte', 'Ajuda e suporte'],
  ].filter(([caminho]) => caminho !== atual);

  return (
    <nav aria-label="Voltar ao sistema" className="flex flex-wrap gap-x-4 gap-y-2 border-t border-borda pt-4">
      {paginas.map(([caminho, rotulo]) => (
        <Link key={caminho} to={caminho} className={LINK_SOLTO}>
          {rotulo}
        </Link>
      ))}
      {logado ? (
        <Link to="/" className={LINK_SOLTO}>
          Ir para o início
        </Link>
      ) : (
        <>
          <Link to="/login" className={LINK_SOLTO}>
            Entrar
          </Link>
          <Link to="/cadastro" className={LINK_SOLTO}>
            Criar conta
          </Link>
        </>
      )}
    </nav>
  );
}

function PaginaDeTexto({ titulo, atual, introducao, children }) {
  return (
    <main className="min-h-screen bg-fundo flex justify-center px-4 py-8">
      <article className="bg-superficie rounded-lg border border-borda shadow-sm p-6 sm:p-8 w-full max-w-2xl min-w-0 grid gap-6 text-sm leading-relaxed text-tinta">
        <header className="grid gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-tinta-2">Conserva Predial</p>
          <h1 className="text-xl font-bold text-navy">{titulo}</h1>
          {introducao && <p>{introducao}</p>}
        </header>
        {children}
        <NavegacaoDasPaginas atual={atual} />
      </article>
    </main>
  );
}

export default PaginaDeTexto;

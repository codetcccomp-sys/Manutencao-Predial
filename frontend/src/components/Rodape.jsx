import { Link } from 'react-router';

/**
 * O rodapé das telas autenticadas: onde ficam as informações que a pessoa
 * procura de vez em quando (termos, privacidade, cookies, suporte).
 *
 * Fora do papel, como o cabeçalho: a tela de etiquetas imprime só as etiquetas.
 * Os links abrem as páginas públicas, que têm o próprio caminho de volta.
 */
const LINK = 'alvo-toque inline-block rounded px-1 py-1 text-tinta-2 underline hover:text-navy';

function Rodape() {
  return (
    <footer className="border-t border-borda print:hidden">
      <nav
        aria-label="Informações do sistema"
        className="max-w-7xl mx-auto flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 text-xs"
      >
        <Link to="/termos" className={LINK}>
          Termos de uso
        </Link>
        <Link to="/privacidade" className={LINK}>
          Privacidade
        </Link>
        <Link to="/cookies" className={LINK}>
          Cookies e armazenamento
        </Link>
        <Link to="/suporte" className={LINK}>
          Ajuda e suporte
        </Link>
      </nav>
    </footer>
  );
}

export default Rodape;

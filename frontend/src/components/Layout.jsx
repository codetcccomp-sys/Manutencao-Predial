import { Link, NavLink, Outlet, useLocation } from 'react-router';
import AvisoDeConexao from './AvisoDeConexao';
import { useAuth } from '../context/AuthContext';
import Avisos from './Avisos';
import Marca from './ui/Marca';
import { rotuloPerfil } from '../dominio/rotulos';

/**
 * Invólucro das telas autenticadas.
 *
 * Sobre não haver barra lateral: são quatro destinos. Uma sidebar cobraria uns
 * 240px permanentes de largura para listar quatro links — o contrário do que
 * um sistema de dados operacionais precisa. Barra superior é a forma certa
 * nesta escala; se um dia a navegação passar de sete ou oito itens, aí sim a
 * conversa muda.
 */

const LINK_BASE =
  'text-sm font-medium shrink-0 rounded px-2 py-1 transition-colors hover:bg-navy-2';

// `aria-current="page"` não é enfeite: é o que faz um leitor de tela anunciar
// "página atual" no item ativo. O sublinhado é o mesmo sinal para quem enxerga.
const LINK_ATIVO = 'bg-navy-2 underline underline-offset-4';

function ItemDeMenu({ para, children }) {
  return (
    <NavLink
      to={para}
      end
      className={({ isActive }) =>
        `${LINK_BASE} ${isActive ? LINK_ATIVO : 'text-tinta-clara'}`
      }
    >
      {children}
    </NavLink>
  );
}

function Layout() {
  const localizacao = useLocation();
  const { usuario, logout } = useAuth();
  // Enquanto a verificação exigida não é ligada, o menu levaria a telas que a
  // API recusa: só fica Minha conta (RotaProtegida).
  const restrito = Boolean(usuario?.dois_fatores_pendente);
  const podeVerRelatorios = ['administrador', 'gestor'].includes(usuario?.perfil) && !restrito;
  const ehAdministrador = usuario?.perfil === 'administrador' && !restrito;

  return (
    <div className="min-h-screen bg-fundo">
      {/*
        Primeiro elemento focável da página, invisível até receber foco. Sem
        ele, quem navega por teclado percorre os cinco links do cabeçalho em
        toda troca de tela antes de chegar ao conteúdo.
      */}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-superficie focus:px-4 focus:py-2 focus:font-medium focus:text-navy focus:shadow-md"
      >
        Pular para o conteúdo
      </a>

      {/* Em telas estreitas o título e a identificação do usuário disputavam a
          mesma linha: o título quebrava em três linhas e espremia o botão Sair.
          Abaixo de sm eles viram duas linhas; a partir de sm voltam lado a lado. */}
      {/* Fora do papel: a tela de etiquetas imprime só as etiquetas. */}
      <header className="bg-navy text-white print:hidden">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* flex-wrap nos dois níveis: os itens de menu ganharam preenchimento
              próprio para virar alvo tocável, e três deles mais o título não
              cabem nos 393px de um celular. Sem a quebra, o último link sai
              pela direita — e `shrink-0` neles impede que encolham para
              caber, de propósito: link espremido a ponto de cortar a palavra
              é pior que link na linha de baixo. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
            <Link to="/" className="mr-2 rounded px-1 shrink-0">
              <Marca invertido />
            </Link>

            <nav
              aria-label="Seções do sistema"
              className="flex flex-wrap items-center gap-1 min-w-0"
            >
              {podeVerRelatorios && <ItemDeMenu para="/relatorios">Relatórios</ItemDeMenu>}
              {podeVerRelatorios && <ItemDeMenu para="/preventiva">Preventiva</ItemDeMenu>}
              {podeVerRelatorios && <ItemDeMenu para="/cadastros">Cadastros</ItemDeMenu>}
              {ehAdministrador && <ItemDeMenu para="/usuarios">Usuários</ItemDeMenu>}
            </nav>
          </div>

          <div className="flex items-center justify-between gap-3 text-sm sm:justify-end">
            <Link to="/conta" className="truncate rounded hover:underline" title="Minha conta">
              {usuario?.nome} <span className="text-tinta-clara">({rotuloPerfil(usuario?.perfil)})</span>
            </Link>
            <Avisos />
            <button
              onClick={logout}
              className="bg-navy-2 rounded px-3 py-1 shrink-0 hover:opacity-90"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <AvisoDeConexao />

      {/*
        A largura saiu de 896px para 1280px.
        Num monitor de 1920px o sistema ocupava menos da metade da tela
        enquanto as tabelas de relatório rolavam na horizontal dentro de um
        container apertado. Formulários continuam estreitos por conta própria
        — medida de leitura confortável é outra coisa que largura de tabela.
      */}
      <main id="conteudo" className="max-w-7xl mx-auto px-4 py-8">
        {/* A chave é o caminho: cada tela nova remonta o envoltório e a entrada
            (de desfocado para nítido) roda de novo. Trocar só os filtros da
            mesma tela não muda o caminho, então não pisca. */}
        <div key={localizacao.pathname} className="animate-pagina-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default Layout;

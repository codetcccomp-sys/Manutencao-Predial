import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function Layout() {
  const { usuario, logout } = useAuth();
  const podeVerRelatorios = ['administrador', 'gestor'].includes(usuario?.perfil);
  const ehAdministrador = usuario?.perfil === 'administrador';

  return (
    <div className="min-h-screen bg-[#EEF1F5]">
      {/* Em telas estreitas o título e a identificação do usuário disputavam a
          mesma linha: o título quebrava em três linhas e espremia o botão Sair.
          Abaixo de sm eles viram duas linhas; a partir de sm voltam lado a lado. */}
      <header className="bg-navy text-white">
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="font-bold leading-tight">
              Sistema de Manutenção Predial
            </Link>
            {podeVerRelatorios && (
              <Link to="/relatorios" className="text-sm text-amber shrink-0 hover:underline">
                Relatórios
              </Link>
            )}
            {podeVerRelatorios && (
              <Link to="/cadastros" className="text-sm text-amber shrink-0 hover:underline">
                Cadastros
              </Link>
            )}
            {ehAdministrador && (
              <Link to="/usuarios" className="text-sm text-amber shrink-0 hover:underline">
                Usuários
              </Link>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 text-sm sm:justify-end">
            <span className="truncate">
              {usuario?.nome} <span className="text-amber">({usuario?.perfil})</span>
            </span>
            <button
              onClick={logout}
              className="bg-navy-2 rounded px-3 py-1 shrink-0 hover:opacity-90"
            >
              Sair
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;

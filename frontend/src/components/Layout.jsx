import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function Layout() {
  const { usuario, logout } = useAuth();

  return (
    <div className="min-h-screen bg-[#EEF1F5]">
      <header className="bg-navy text-white px-6 py-4 flex items-center justify-between">
        <Link to="/" className="font-bold">
          Sistema de Manutenção Predial
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span>
            {usuario?.nome} <span className="text-amber">({usuario?.perfil})</span>
          </span>
          <button onClick={logout} className="bg-navy-2 rounded px-3 py-1 hover:opacity-90">
            Sair
          </button>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;

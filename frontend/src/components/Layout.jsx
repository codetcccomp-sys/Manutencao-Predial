import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Avisos from './Avisos';

function Layout() {
  const { usuario, logout } = useAuth();
  const podeVerRelatorios = ['administrador', 'gestor'].includes(usuario?.perfil);
  const ehAdministrador = usuario?.perfil === 'administrador';

  return (
    <div className="min-h-screen bg-fundo">
      {/* Em telas estreitas o título e a identificação do usuário disputavam a
          mesma linha: o título quebrava em três linhas e espremia o botão Sair.
          Abaixo de sm eles viram duas linhas; a partir de sm voltam lado a lado. */}
      <header className="bg-navy text-white">
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="font-bold leading-tight">
              Sistema de Manutenção Predial
            </Link>
            {/* Os links eram âmbar sobre o navy: 4,28:1, abaixo do mínimo. E
                o âmbar já significava perfil, KPI e reabertura ao mesmo tempo
                — navegação não é aviso. Tinta clara resolve as duas coisas de
                uma vez: 9,89:1, e a cor de atenção fica livre para atenção. */}
            {podeVerRelatorios && (
              <Link
                to="/relatorios"
                className="text-sm font-medium text-tinta-clara shrink-0 hover:underline"
              >
                Relatórios
              </Link>
            )}
            {podeVerRelatorios && (
              <Link
                to="/cadastros"
                className="text-sm font-medium text-tinta-clara shrink-0 hover:underline"
              >
                Cadastros
              </Link>
            )}
            {ehAdministrador && (
              <Link
                to="/usuarios"
                className="text-sm font-medium text-tinta-clara shrink-0 hover:underline"
              >
                Usuários
              </Link>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 text-sm sm:justify-end">
            <span className="truncate">
              {usuario?.nome} <span className="text-tinta-clara">({usuario?.perfil})</span>
            </span>
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
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;

import { Link, useNavigate } from 'react-router';
import Botao from '../components/ui/Botao';
import { LINK } from '../components/ui/PaginaDeTexto';
import { useAuth } from '../context/AuthContext';

/**
 * Página para o endereço que não existe.
 *
 * Fica fora do login, de propósito: quem digitou um endereço errado ainda não
 * sabe se está logado, e mandá-lo para o login por um endereço inexistente
 * esconderia o que aconteceu. O caminho de volta muda conforme haja sessão: com
 * ela, o início do sistema; sem ela, a tela de entrada.
 *
 * O endereço digitado não é repetido na tela: ele não ajuda a pessoa, e
 * devolver à página um texto que veio de fora é um hábito que não vale começar.
 */
function NaoEncontrada() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const destino = usuario ? '/' : '/login';
  const rotulo = usuario ? 'Ir para o início' : 'Ir para a tela de entrada';
  // Sem página anterior no histórico (a pessoa abriu o endereço direto), "Voltar"
  // não teria para onde ir: o botão só aparece quando há.
  const temAnterior = window.history.state?.idx > 0;

  return (
    <main className="min-h-screen bg-fundo flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md min-w-0 rounded-lg border border-borda bg-superficie p-6 shadow-sm sm:p-8 grid gap-4 text-center">
        <p className="text-4xl font-bold text-navy" aria-hidden="true">
          404
        </p>
        <h1 className="text-xl font-bold text-navy">Página não encontrada</h1>
        <p className="text-sm text-tinta-2">
          O endereço que você abriu não existe ou foi movido. Confira se ele foi digitado
          corretamente, ou volte para o início e siga pelo menu.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            to={destino}
            className="alvo-toque inline-flex items-center justify-center gap-2 rounded bg-navy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-2"
          >
            {rotulo}
          </Link>
          {temAnterior && (
            <Botao onClick={() => navigate(-1)}>Voltar à página anterior</Botao>
          )}
        </div>
        <p className="text-sm text-tinta-2">
          Precisa de ajuda?{' '}
          <Link to="/suporte" className={LINK}>
            Ajuda e suporte
          </Link>
        </p>
      </div>
    </main>
  );
}

export default NaoEncontrada;

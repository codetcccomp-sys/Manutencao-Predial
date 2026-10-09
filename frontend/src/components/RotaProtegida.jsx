import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext';

/**
 * Sem sessão, vai para o login — levando o endereço pedido.
 *
 * Antes o login sempre devolvia para o início. Com o QR Code colado no
 * equipamento, isso quebrava o caminho inteiro: a pessoa lia a etiqueta,
 * entrava, e caía na lista de chamados em vez do formulário já preenchido.
 * O mesmo vale para quem tinha a sessão expirada no meio de um chamado.
 *
 * Quem clicou em Sair, não: guardar o endereço ali mandaria a PRÓXIMA pessoa
 * que entrasse no aparelho para a tela de quem saiu (o chamado do colega, que
 * o servidor recusaria ou, pior, mostraria se ela também tivesse acesso).
 */
function RotaProtegida({ children }) {
  const { usuario, saiu } = useAuth();
  const local = useLocation();

  if (!usuario) {
    if (saiu) return <Navigate to="/login" replace />;
    return <Navigate to="/login" replace state={{ de: `${local.pathname}${local.search}` }} />;
  }

  // Gestão com a verificação em duas etapas exigida e ainda desligada: a API
  // só atende Minha conta, então qualquer outra tela seria uma tela de erro.
  if (usuario.dois_fatores_pendente && local.pathname !== '/conta') {
    return <Navigate to="/conta" replace />;
  }

  return children;
}

export default RotaProtegida;

import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext';

/**
 * Sem sessão, vai para o login — levando o endereço pedido.
 *
 * Antes o login sempre devolvia para o início. Com o QR Code colado no
 * equipamento, isso quebrava o caminho inteiro: a pessoa lia a etiqueta,
 * entrava, e caía na lista de chamados em vez do formulário já preenchido.
 * O mesmo vale para quem tinha a sessão expirada no meio de um chamado.
 */
function RotaProtegida({ children }) {
  const { usuario } = useAuth();
  const local = useLocation();

  if (!usuario) {
    return <Navigate to="/login" replace state={{ de: `${local.pathname}${local.search}` }} />;
  }

  return children;
}

export default RotaProtegida;

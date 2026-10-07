import { Navigate } from 'react-router';
import { useAuth } from '../context/AuthContext';

function RotaProtegida({ children }) {
  const { usuario } = useAuth();

  if (!usuario) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default RotaProtegida;

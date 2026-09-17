import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import RotaProtegida from './components/RotaProtegida';
import Layout from './components/Layout';
import Login from './pages/Login';
import Cadastro from './pages/Cadastro';
import Dashboard from './pages/Dashboard';
import NovoChamado from './pages/NovoChamado';
import ChamadoDetalhe from './pages/ChamadoDetalhe';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/cadastro" element={<Cadastro />} />

          <Route
            element={
              <RotaProtegida>
                <Layout />
              </RotaProtegida>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/chamados/novo" element={<NovoChamado />} />
            <Route path="/chamados/:id" element={<ChamadoDetalhe />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

import { BrowserRouter, Routes, Route } from 'react-router';
import { AuthProvider } from './context/AuthContext';
import AnuncioDeRota from './components/AnuncioDeRota';
import RotaProtegida from './components/RotaProtegida';
import Layout from './components/Layout';
import Login from './pages/Login';
import Cadastro from './pages/Cadastro';
import RecuperarSenha from './pages/RecuperarSenha';
import RedefinirSenha from './pages/RedefinirSenha';
import Privacidade from './pages/Privacidade';
import TermosDeUso from './pages/TermosDeUso';
import Cookies from './pages/Cookies';
import Suporte from './pages/Suporte';
import NaoEncontrada from './pages/NaoEncontrada';
import { telaSobDemanda } from './dominio/telaSobDemanda';
import Inicio from './pages/Inicio';
import NovoChamado from './pages/NovoChamado';
import ChamadoDetalhe from './pages/ChamadoDetalhe';
// Telas de gestão sob demanda: a fila, o chamado e o formulário de abertura (o que o
// técnico usa no subsolo, e o que o service worker guarda para uso sem conexão)
// ficam no arquivo principal; o resto só é baixado ao abrir a rota.
const Relatorios = telaSobDemanda(() => import('./pages/Relatorios'));
const Usuarios = telaSobDemanda(() => import('./pages/Usuarios'));
const Cadastros = telaSobDemanda(() => import('./pages/Cadastros'));
const Preventiva = telaSobDemanda(() => import('./pages/Preventiva'));
const Equipamento = telaSobDemanda(() => import('./pages/Equipamento'));
const Etiquetas = telaSobDemanda(() => import('./pages/Etiquetas'));
const MinhaConta = telaSobDemanda(() => import('./pages/MinhaConta'));

function App() {
  return (
    <BrowserRouter>
      <AnuncioDeRota />
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/cadastro" element={<Cadastro />} />
          <Route path="/recuperar-senha" element={<RecuperarSenha />} />
          <Route path="/redefinir-senha" element={<RedefinirSenha />} />
          <Route path="/privacidade" element={<Privacidade />} />
          <Route path="/termos" element={<TermosDeUso />} />
          <Route path="/cookies" element={<Cookies />} />
          <Route path="/suporte" element={<Suporte />} />

          <Route
            element={
              <RotaProtegida>
                <Layout />
              </RotaProtegida>
            }
          >
            <Route path="/" element={<Inicio />} />
            <Route path="/chamados/novo" element={<NovoChamado />} />
            <Route path="/chamados/:id" element={<ChamadoDetalhe />} />
            <Route path="/relatorios" element={<Relatorios />} />
            <Route path="/usuarios" element={<Usuarios />} />
            <Route path="/cadastros" element={<Cadastros />} />
            <Route path="/preventiva" element={<Preventiva />} />
            <Route path="/equipamentos/:id" element={<Equipamento />} />
            <Route path="/etiquetas" element={<Etiquetas />} />
            <Route path="/conta" element={<MinhaConta />} />
          </Route>

          {/* Endereço que não existe: página própria, fora do login. */}
          <Route path="*" element={<NaoEncontrada />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

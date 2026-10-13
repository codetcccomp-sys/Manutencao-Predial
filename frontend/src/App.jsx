import { lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router';
import { AuthProvider } from './context/AuthContext';
import RotaProtegida from './components/RotaProtegida';
import Layout from './components/Layout';
import Login from './pages/Login';
import Cadastro from './pages/Cadastro';
import RecuperarSenha from './pages/RecuperarSenha';
import RedefinirSenha from './pages/RedefinirSenha';
import Privacidade from './pages/Privacidade';
import Inicio from './pages/Inicio';
import NovoChamado from './pages/NovoChamado';
import ChamadoDetalhe from './pages/ChamadoDetalhe';
import Equipamento from './pages/Equipamento';
import MinhaConta from './pages/MinhaConta';

// As telas da gestão carregam sob demanda: quem pede e quem executa nunca as
// abre, e baixar o código delas num celular simples é tempo de tela parada para
// nada. O que fica no pacote principal é o caminho do técnico sem conexão (fila,
// chamado, equipamento) e a Minha conta, para onde o 2FA pendente redireciona.
// A tela de gestão não tem leitura guardada para o uso offline (sw.js), então
// perder o pedaço sem conexão não tira nada que ela oferecesse antes.
//
// Uma declaração por linha, no formato `const X = lazy(() => import(...))`: é o
// que a mutação em testes/mutacao.mjs desfaz para provar que o pedaço some do
// pacote principal.
const Relatorios = lazy(() => import('./pages/Relatorios'));
const Usuarios = lazy(() => import('./pages/Usuarios'));
const Cadastros = lazy(() => import('./pages/Cadastros'));
const Preventiva = lazy(() => import('./pages/Preventiva'));
const Etiquetas = lazy(() => import('./pages/Etiquetas'));

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/cadastro" element={<Cadastro />} />
          <Route path="/recuperar-senha" element={<RecuperarSenha />} />
          <Route path="/redefinir-senha" element={<RedefinirSenha />} />
          <Route path="/privacidade" element={<Privacidade />} />

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
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

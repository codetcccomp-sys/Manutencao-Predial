import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const { login, sessaoExpirada } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      await login(email, senha);
      navigate('/');
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível entrar.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#EEF1F5] flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-md p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-navy mb-1">Sistema de Manutenção Predial</h1>
        <p className="text-sm text-gray-500 mb-6">Entre com sua conta</p>

        {/* Quem caiu aqui por token vencido merece saber o motivo, em vez de
            simplesmente reencontrar a tela de login sem explicação. */}
        {sessaoExpirada && !erro && (
          <div className="bg-amber/10 text-amber text-sm rounded p-2 mb-4">
            Sua sessão expirou. Entre novamente para continuar.
          </div>
        )}

        {erro && (
          <div className="bg-red-50 text-red-700 text-sm rounded p-2 mb-4">{erro}</div>
        )}

        <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-navy"
        />

        <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
        <input
          type="password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-6 focus:outline-none focus:ring-2 focus:ring-navy"
        />

        <button
          type="submit"
          disabled={carregando}
          className="w-full bg-navy text-white rounded py-2 font-medium hover:bg-navy-2 disabled:opacity-60"
        >
          {carregando ? 'Entrando...' : 'Entrar'}
        </button>

        <p className="text-sm text-gray-500 mt-4 text-center">
          <Link to="/recuperar-senha" className="text-amber font-medium">
            Esqueci minha senha
          </Link>
        </p>

        <p className="text-sm text-gray-500 mt-2 text-center">
          Não tem conta?{' '}
          <Link to="/cadastro" className="text-amber font-medium">
            Cadastre-se
          </Link>
        </p>
      </form>
    </div>
  );
}

export default Login;

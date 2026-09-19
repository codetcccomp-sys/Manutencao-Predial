import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function Cadastro() {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const { registrar } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      await registrar(nome, email, senha);
      setSucesso(true);
      setTimeout(() => navigate('/login'), 1200);
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível concluir o cadastro.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="min-h-screen bg-fundo flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-md p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-navy mb-1">Criar conta</h1>
        <p className="text-sm text-gray-500 mb-6">Cadastro como solicitante</p>

        {erro && <div className="bg-red-50 text-red-700 text-sm rounded p-2 mb-4">{erro}</div>}
        {sucesso && (
          <div className="bg-green-50 text-green-700 text-sm rounded p-2 mb-4">
            Conta criada! Redirecionando para login...
          </div>
        )}

        {/* htmlFor/id: sem o par, o rótulo fica só desenhado ao lado — quem
            usa leitor de tela ouve "caixa de edição" sem saber do quê. */}
        <label htmlFor="nome" className="block text-sm font-medium text-gray-700 mb-1">
          Nome
        </label>
        <input
          id="nome"
          required
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-navy"
        />

        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
          E-mail
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-navy"
        />

        <label htmlFor="senha" className="block text-sm font-medium text-gray-700 mb-1">
          Senha
        </label>
        <input
          id="senha"
          type="password"
          required
          minLength={6}
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-6 focus:outline-none focus:ring-2 focus:ring-navy"
        />

        <button
          type="submit"
          disabled={carregando}
          className="w-full bg-navy text-white rounded py-2 font-medium hover:bg-navy-2 disabled:opacity-60"
        >
          {carregando ? 'Enviando...' : 'Cadastrar'}
        </button>

        <p className="text-sm text-gray-500 mt-4 text-center">
          Já tem conta?{' '}
          <Link to="/login" className="text-amber font-medium">
            Entrar
          </Link>
        </p>
      </form>
    </div>
  );
}

export default Cadastro;

import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api/client';

function RedefinirSenha() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();

  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  async function enviar(e) {
    e.preventDefault();
    setErro('');

    // Conferido aqui porque o servidor não tem como saber que houve engano de
    // digitação: para ele, os dois campos seriam uma senha só.
    if (senha !== confirmacao) {
      setErro('As senhas não conferem.');
      return;
    }

    setCarregando(true);
    try {
      await api.post('/auth/redefinir-senha', { token, senha });
      navigate('/login', { replace: true });
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível redefinir a senha.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#EEF1F5] flex items-center justify-center px-4">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-navy mb-1">Definir nova senha</h1>

        {!token ? (
          <>
            <p className="text-sm text-gray-600 my-6">
              Este endereço não traz um token de redefinição. Use o link que enviamos por e-mail, ou
              peça um novo.
            </p>
            <Link to="/recuperar-senha" className="text-sm text-amber font-medium">
              Pedir novo link
            </Link>
          </>
        ) : (
          <form onSubmit={enviar}>
            <p className="text-sm text-gray-500 mb-6">
              Escolha uma senha de ao menos 6 caracteres.
            </p>

            {erro && <div className="bg-red-50 text-red-700 text-sm rounded p-2 mb-4">{erro}</div>}

            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="senha">
              Nova senha
            </label>
            <input
              id="senha"
              type="password"
              required
              minLength={6}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="w-full border rounded px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-navy"
            />

            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="confirmacao">
              Repita a nova senha
            </label>
            <input
              id="confirmacao"
              type="password"
              required
              minLength={6}
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              className="w-full border rounded px-3 py-2 mb-6 focus:outline-none focus:ring-2 focus:ring-navy"
            />

            <button
              type="submit"
              disabled={carregando}
              className="w-full bg-navy text-white rounded py-2 font-medium hover:bg-navy-2 disabled:opacity-60"
            >
              {carregando ? 'Salvando...' : 'Salvar nova senha'}
            </button>

            <p className="text-sm text-gray-500 mt-4 text-center">
              <Link to="/recuperar-senha" className="text-amber font-medium">
                Pedir outro link
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default RedefinirSenha;

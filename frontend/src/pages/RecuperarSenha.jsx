import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';

function RecuperarSenha() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  async function enviar(e) {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      await api.post('/auth/recuperar-senha', { email });
      setEnviado(true);
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível processar o pedido.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="min-h-screen bg-fundo flex items-center justify-center px-4">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-navy mb-1">Recuperar senha</h1>

        {enviado ? (
          <>
            {/* A mesma mensagem sai exista ou não a conta: dizer "e-mail não
                cadastrado" transformaria esta tela numa consulta de quem tem
                conta no sistema. */}
            <p className="text-sm text-gray-600 my-6">
              Se houver uma conta ativa com este e-mail, enviamos um link de redefinição. Ele vale
              por 60 minutos e só pode ser usado uma vez.
            </p>
            <Link to="/login" className="text-sm text-amber font-medium">
              Voltar para o login
            </Link>
          </>
        ) : (
          <form onSubmit={enviar}>
            <p className="text-sm text-gray-500 mb-6">
              Informe seu e-mail e enviaremos um link para definir uma nova senha.
            </p>

            {erro && <div className="bg-red-50 text-red-700 text-sm rounded p-2 mb-4">{erro}</div>}

            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded px-3 py-2 mb-6 focus:outline-none focus:ring-2 focus:ring-navy"
            />

            <button
              type="submit"
              disabled={carregando}
              className="w-full bg-navy text-white rounded py-2 font-medium hover:bg-navy-2 disabled:opacity-60"
            >
              {carregando ? 'Enviando...' : 'Enviar link'}
            </button>

            <p className="text-sm text-gray-500 mt-4 text-center">
              <Link to="/login" className="text-amber font-medium">
                Voltar para o login
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default RecuperarSenha;

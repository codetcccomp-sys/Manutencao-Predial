import { useState } from 'react';
import { Link } from 'react-router';
import api from '../api/client';
import { Campo } from '../components/ui/Campo';
import Botao from '../components/ui/Botao';
import Aviso from '../components/ui/Aviso';

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
    <div className="min-h-screen bg-fundo flex items-center justify-center px-4 py-8">
      <div className="bg-superficie rounded-lg border border-borda shadow-sm p-8 w-full max-w-sm grid gap-4">
        <h1 className="text-xl font-bold text-navy">Recuperar senha</h1>

        {enviado ? (
          <>
            {/* A mesma mensagem sai exista ou não a conta: dizer "e-mail não
                cadastrado" transformaria esta tela numa consulta de quem tem
                conta no sistema. */}
            <Aviso tipo="info">
              Se houver uma conta ativa com este e-mail, enviamos um link de redefinição. Ele vale
              por 60 minutos e só pode ser usado uma vez.
            </Aviso>
            <Link to="/login" className="text-sm font-medium text-navy hover:underline">
              Voltar para o login
            </Link>
          </>
        ) : (
          <form onSubmit={enviar} className="grid gap-4">
            <p className="text-sm text-tinta-2">
              Informe seu e-mail e enviaremos um link para definir uma nova senha.
            </p>

            {erro && <Aviso tipo="erro">{erro}</Aviso>}

            <Campo
              rotulo="E-mail"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <Botao type="submit" variante="primaria" carregando={carregando} larguraTotal>
              {carregando ? 'Enviando...' : 'Enviar link'}
            </Botao>

            <p className="text-sm text-center">
              <Link to="/login" className="font-medium text-navy hover:underline">
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

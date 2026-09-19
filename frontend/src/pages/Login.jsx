import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Campo } from '../components/ui/Campo';
import Botao from '../components/ui/Botao';
import Aviso from '../components/ui/Aviso';
import Marca from '../components/ui/Marca';

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
    <div className="min-h-screen bg-fundo flex items-center justify-center px-4 py-8">
      <form
        onSubmit={handleSubmit}
        className="bg-superficie rounded-lg border border-borda shadow-sm p-8 w-full max-w-sm grid gap-4"
      >
        <div>
          {/* A marca é o <h1> da tela, não um enfeite acima dele: esta página
              não tem outro título, e um h1 escondido atrás de uma logomarca
              seria um título duplicado para quem navega por cabeçalhos. */}
          <h1>
            <Marca tamanho="destaque" comDescritor />
          </h1>
          <p className="text-sm text-tinta-2 mt-3">Entre com sua conta</p>
        </div>

        {/* Quem caiu aqui por token vencido merece saber o motivo, em vez de
            simplesmente reencontrar a tela de login sem explicação. */}
        {sessaoExpirada && !erro && (
          <Aviso tipo="atencao">Sua sessão expirou. Entre novamente para continuar.</Aviso>
        )}

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <Campo
          rotulo="E-mail"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <Campo
          rotulo="Senha"
          type="password"
          autoComplete="current-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />

        <Botao type="submit" variante="primaria" carregando={carregando} larguraTotal>
          {carregando ? 'Entrando...' : 'Entrar'}
        </Botao>

        <div className="grid gap-1 text-center text-sm text-tinta-2">
          <p>
            <Link to="/recuperar-senha" className="font-medium text-navy hover:underline">
              Esqueci minha senha
            </Link>
          </p>
          <p>
            Não tem conta?{' '}
            <Link to="/cadastro" className="font-medium text-navy hover:underline">
              Cadastre-se
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}

export default Login;

import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { Campo } from '../components/ui/Campo';
import Botao from '../components/ui/Botao';
import Aviso from '../components/ui/Aviso';
import Marca from '../components/ui/Marca';

/**
 * Para onde voltar depois de entrar.
 *
 * Só caminho interno: começa com uma barra, e não com duas (`//outro.site` é
 * endereço de outro domínio para o navegador) nem com barra invertida, que
 * alguns navegadores tratam como barra. O valor vem do estado da navegação,
 * não da URL, mas a regra é barata e fecha a porta de vez para um redirect
 * aberto se um dia alguém passar a lê-lo de um parâmetro.
 */
export function destinoSeguro(destino) {
  if (typeof destino !== 'string') return '/';
  if (!destino.startsWith('/') || destino.startsWith('//') || destino.includes('\\')) return '/';
  if (destino.startsWith('/login')) return '/';
  return destino;
}

function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  // Com a verificação em duas etapas, a senha certa devolve um desafio, e a
  // tela passa a pedir o código. O desafio vale poucos minutos.
  const [desafio, setDesafio] = useState(null);
  const [codigo, setCodigo] = useState('');
  const { login, confirmarCodigo, sessaoExpirada } = useAuth();
  const navigate = useNavigate();
  const local = useLocation();

  const seguir = () => navigate(destinoSeguro(local.state?.de), { replace: true });

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      if (desafio) {
        await confirmarCodigo(desafio, codigo);
        seguir();
        return;
      }
      const resultado = await login(email, senha);
      if (resultado?.requer2fa) {
        setDesafio(resultado.desafio);
        setSenha('');
        return;
      }
      seguir();
    } catch (err) {
      const corpo = err.response?.data?.erro;
      // Desafio vencido: volta para a primeira etapa, que é o que resolve.
      if (corpo?.codigo === 'DESAFIO_INVALIDO') {
        setDesafio(null);
        setCodigo('');
      }
      setErro(corpo?.mensagem || 'Não foi possível entrar.');
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

        {desafio ? (
          <>
            <p className="text-sm text-tinta">
              Digite o código de 6 dígitos do aplicativo autenticador. Sem o celular, use um dos
              códigos de recuperação.
            </p>
            <Campo
              rotulo="Código"
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
            />
            <Botao type="submit" variante="primaria" carregando={carregando} larguraTotal>
              {carregando ? 'Conferindo...' : 'Confirmar'}
            </Botao>
            <button
              type="button"
              onClick={() => {
                setDesafio(null);
                setCodigo('');
                setErro('');
              }}
              className="text-sm text-navy hover:underline"
            >
              Voltar e entrar com outra conta
            </button>
          </>
        ) : (
          <>
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
          </>
        )}

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

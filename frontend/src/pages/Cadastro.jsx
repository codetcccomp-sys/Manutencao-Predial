import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { Campo } from '../components/ui/Campo';
import Botao from '../components/ui/Botao';
import Aviso from '../components/ui/Aviso';
import PedidoEnviado from '../components/PedidoEnviado';
import { AJUDA_SENHA, MINIMO_SENHA } from '../dominio/senha';

function Cadastro() {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  // null até a resposta; depois, se a conta (quando é criada) espera a gestão.
  const [recebido, setRecebido] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const { registrar } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      const resposta = await registrar(nome, email, senha);
      // A resposta é a mesma para e-mail novo e repetido (o servidor não diz se havia conta),
      // então a tela também não pode dizer "conta criada": diz que o pedido foi recebido e o
      // que fazer em cada caso.
      setRecebido({ aguardando: Boolean(resposta?.aguardando_aprovacao) });
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível concluir o cadastro.');
    } finally {
      setCarregando(false);
    }
  }

  if (recebido) {
    return (
      <PedidoEnviado
        acao={
          <div className="grid gap-1">
            <Link to="/login" className="alvo-toque inline-block py-1 text-center text-sm font-medium text-navy hover:underline">
              Ir para o login
            </Link>
            <Link to="/recuperar-senha" className="alvo-toque inline-block py-1 text-center text-sm font-medium text-navy hover:underline">
              Esqueci minha senha
            </Link>
          </div>
        }
      >
        {recebido.aguardando
          ? 'Recebemos o pedido de cadastro. Se este e-mail ainda não tinha conta, ela foi criada e aguarda a aprovação da gestão: você poderá entrar com este e-mail e a senha que escolheu assim que ela for aprovada. '
          : 'Recebemos o pedido de cadastro. Se este e-mail ainda não tinha conta, ela foi criada: entre com este e-mail e a senha que você escolheu. '}
        Se você já tinha conta, a senha dela não mudou: entre com ela ou peça uma nova.
      </PedidoEnviado>
    );
  }

  return (
    <main className="min-h-screen bg-fundo flex items-center justify-center px-4 py-8">
      <form
        onSubmit={handleSubmit}
        className="bg-superficie rounded-lg border border-borda shadow-sm p-8 w-full max-w-sm grid gap-4"
      >
        <div>
          <h1 className="text-xl font-bold text-navy">Criar conta</h1>
          <p className="text-sm text-tinta-2 mt-1">Cadastro como solicitante</p>
        </div>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <Campo
          rotulo="Nome"
          autoComplete="name"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />

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
          autoComplete="new-password"
          minLength={MINIMO_SENHA}
          ajuda={AJUDA_SENHA}
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />

        {/* Antes de a pessoa entregar os dados, o que será feito com eles. Abre
            em outra aba para que quem já digitou o formulário não o perca. */}
        <p className="text-xs text-tinta-2">
          Guardamos seu nome, seu e-mail e o que você escrever nos chamados. Saiba como no{' '}
          <a
            href="/privacidade"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-navy underline"
          >
            aviso de privacidade{' '}<span className="sr-only">(abre em outra aba)</span>
          </a>
          . Ao criar a conta, você concorda com os{' '}
          <a
            href="/termos"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-navy underline"
          >
            termos de uso{' '}<span className="sr-only">(abre em outra aba)</span>
          </a>
          .
        </p>

        <Botao type="submit" variante="primaria" carregando={carregando} larguraTotal>
          {carregando ? 'Enviando...' : 'Cadastrar'}
        </Botao>

        <p className="text-sm text-tinta-2 text-center">
          Já tem conta?{' '}
          <Link to="/login" className="font-medium text-navy underline">
            Entrar
          </Link>
        </p>
      </form>
    </main>
  );
}

export default Cadastro;

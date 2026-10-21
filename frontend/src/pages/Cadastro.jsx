import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { Campo } from '../components/ui/Campo';
import Botao from '../components/ui/Botao';
import Aviso from '../components/ui/Aviso';
import PedidoEnviado from '../components/PedidoEnviado';

function Cadastro() {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState(false);
  const [aguardando, setAguardando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const { registrar } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      const resposta = await registrar(nome, email, senha);
      // Esperando aprovação não vai ao login: lá a pessoa leria "aguarda
      // aprovação" como erro e tentaria de novo.
      if (resposta?.aguardando_aprovacao) {
        setAguardando(true);
        return;
      }
      setSucesso(true);
      setTimeout(() => navigate('/login'), 1200);
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível concluir o cadastro.');
    } finally {
      setCarregando(false);
    }
  }

  if (aguardando) {
    return (
      <PedidoEnviado
        acao={
          <Link to="/login" className="alvo-toque inline-block py-1 text-center text-sm font-medium text-navy hover:underline">
            Voltar para o login
          </Link>
        }
      >
        Seu cadastro foi recebido e aguarda a aprovação da gestão. Você poderá entrar com este e-mail e
        senha assim que ele for aprovado.
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
        {sucesso && <Aviso tipo="sucesso">Conta criada! Redirecionando para login...</Aviso>}

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
          minLength={6}
          ajuda="Ao menos 6 caracteres."
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

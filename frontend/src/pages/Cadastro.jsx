import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Campo } from '../components/ui/Campo';
import Botao from '../components/ui/Botao';
import Aviso from '../components/ui/Aviso';

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
    <div className="min-h-screen bg-fundo flex items-center justify-center px-4 py-8">
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

        <Botao type="submit" variante="primaria" carregando={carregando} larguraTotal>
          {carregando ? 'Enviando...' : 'Cadastrar'}
        </Botao>

        <p className="text-sm text-tinta-2 text-center">
          Já tem conta?{' '}
          <Link to="/login" className="font-medium text-navy hover:underline">
            Entrar
          </Link>
        </p>
      </form>
    </div>
  );
}

export default Cadastro;

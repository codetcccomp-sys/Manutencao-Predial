import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import api from '../api/client';
import { Campo } from '../components/ui/Campo';
import Botao from '../components/ui/Botao';
import Aviso from '../components/ui/Aviso';

function RedefinirSenha() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();

  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  // Erro de conferência fica no campo, não na faixa do topo: é ali que a
  // pessoa está olhando quando digita a segunda senha.
  const naoConferem = confirmacao.length > 0 && senha !== confirmacao;

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
    <div className="min-h-screen bg-fundo flex items-center justify-center px-4 py-8">
      <div className="bg-superficie rounded-lg border border-borda shadow-sm p-8 w-full max-w-sm grid gap-4">
        <h1 className="text-xl font-bold text-navy">Definir nova senha</h1>

        {!token ? (
          <>
            <Aviso tipo="atencao">
              Este endereço não traz um token de redefinição. Use o link que enviamos por e-mail, ou
              peça um novo.
            </Aviso>
            <Link to="/recuperar-senha" className="text-sm font-medium text-navy hover:underline">
              Pedir novo link
            </Link>
          </>
        ) : (
          <form onSubmit={enviar} className="grid gap-4">
            <p className="text-sm text-tinta-2">Escolha uma senha de ao menos 6 caracteres.</p>

            {erro && <Aviso tipo="erro">{erro}</Aviso>}

            <Campo
              rotulo="Nova senha"
              type="password"
              autoComplete="new-password"
              minLength={6}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />

            <Campo
              rotulo="Repita a nova senha"
              type="password"
              autoComplete="new-password"
              minLength={6}
              value={confirmacao}
              erro={naoConferem ? 'As senhas não conferem.' : undefined}
              onChange={(e) => setConfirmacao(e.target.value)}
            />

            <Botao
              type="submit"
              variante="primaria"
              carregando={carregando}
              disabled={naoConferem}
              larguraTotal
            >
              {carregando ? 'Salvando...' : 'Salvar nova senha'}
            </Botao>

            <p className="text-sm text-center">
              <Link to="/recuperar-senha" className="font-medium text-navy hover:underline">
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

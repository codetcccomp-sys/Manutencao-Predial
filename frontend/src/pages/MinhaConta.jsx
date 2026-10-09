import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Aviso from '../components/ui/Aviso';
import Botao from '../components/ui/Botao';
import Cartao from '../components/ui/Cartao';
import CabecalhoDePagina from '../components/ui/CabecalhoDePagina';
import CodigoQR from '../components/ui/CodigoQR';
import { Campo } from '../components/ui/Campo';
import { rotuloPerfil } from '../dominio/rotulos';

/**
 * A conta de quem está logado: verificação em duas etapas e sessões.
 *
 * A verificação em duas etapas é de quem quiser, e recomendada para quem pode
 * mais (gestão e administração): com ela, a senha vazada não abre a conta
 * sozinha.
 */
function MinhaConta() {
  const { usuario, logout, concluirDoisFatores } = useAuth();
  const recomendada = ['administrador', 'gestor'].includes(usuario?.perfil);

  const [situacao, setSituacao] = useState(null);
  const [cadastro, setCadastro] = useState(null); // { segredo, endereco } durante a ativação
  const [codigos, setCodigos] = useState(null); // códigos de recuperação, mostrados uma vez
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [desligando, setDesligando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(() => {
    api
      .get('/auth/2fa')
      .then(({ data }) => setSituacao(data))
      .catch(() => setErro('Não foi possível carregar a situação da conta.'));
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function executar(acao) {
    setErro('');
    setAviso('');
    try {
      return await acao();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível concluir.');
      return null;
    }
  }

  async function iniciar() {
    const r = await executar(() => api.post('/auth/2fa/iniciar'));
    if (r) {
      setCadastro(r.data);
      setCodigos(null);
      setCodigo('');
    }
  }

  async function ativar(e) {
    e.preventDefault();
    const r = await executar(() => api.post('/auth/2fa/ativar', { senha, codigo }));
    if (r) {
      setCadastro(null);
      setSenha('');
      setCodigo('');
      setCodigos(r.data.codigos_recuperacao);
      setAviso('Verificação em duas etapas ligada. As outras sessões desta conta foram encerradas.');
      concluirDoisFatores();
      carregar();
    }
  }

  async function gerarCodigos(e) {
    e.preventDefault();
    const r = await executar(() => api.post('/auth/2fa/codigos', { codigo }));
    if (r) {
      setCodigo('');
      setCodigos(r.data.codigos_recuperacao);
      setAviso('Códigos novos gerados. Os anteriores deixaram de valer.');
      carregar();
    }
  }

  async function desligar(e) {
    e.preventDefault();
    const r = await executar(() => api.post('/auth/2fa/desativar', { senha, codigo }));
    if (r) {
      setDesligando(false);
      setSenha('');
      setCodigo('');
      setCodigos(null);
      setAviso('Verificação em duas etapas desligada.');
      carregar();
    }
  }

  async function sairDeTodos() {
    const r = await executar(() => api.post('/auth/sair-de-todos'));
    if (r) logout();
  }

  function baixarCodigos() {
    const texto = `Códigos de recuperação — Conserva Predial (${usuario.email})\n` +
      'Cada código vale uma vez. Guarde longe do celular.\n\n' +
      codigos.join('\n') + '\n';
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'conserva-predial-codigos-de-recuperacao.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  // "Sair de todos" encerra esta sessão também: entre o logout e o
  // redirecionamento da rota protegida, não há mais quem mostrar.
  if (!usuario) return null;

  return (
    <div className="grid gap-6 max-w-3xl">
      <CabecalhoDePagina
        titulo="Minha conta"
        descricao={`${usuario.nome} · ${usuario.email} · ${rotuloPerfil(usuario.perfil)}`}
        className="mb-0"
      />

      {usuario.dois_fatores_pendente && (
        <Aviso tipo="atencao" titulo="Falta ligar a verificação em duas etapas">
          A administração exige a verificação para o seu perfil. Ligue abaixo para voltar a usar o
          sistema; até lá, só esta tela fica disponível.
        </Aviso>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}

      <Cartao
        titulo="Verificação em duas etapas"
        descricao="Além da senha, um código de 6 dígitos do aplicativo autenticador do celular (Google Authenticator, Microsoft Authenticator, Aegis, o do seu gerenciador de senhas)."
      >
        {situacao === null ? (
          <p className="text-sm text-tinta-2">Carregando...</p>
        ) : situacao.ativo ? (
          <div className="grid gap-4 text-sm">
            <p>
              <strong className="text-sucesso">Ligada</strong> desde{' '}
              {new Date(situacao.ativado_em).toLocaleDateString('pt-BR')}.{' '}
              {situacao.codigos_restantes} código(s) de recuperação ainda sem uso.
            </p>

            {!desligando ? (
              <form onSubmit={gerarCodigos} className="grid gap-3 sm:grid-cols-[12rem_auto] sm:items-end">
                <Campo
                  rotulo="Código do aplicativo"
                  autoComplete="one-time-code"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Botao type="submit">Gerar códigos de recuperação novos</Botao>
                  <Botao variante="perigo" onClick={() => setDesligando(true)}>
                    Desligar
                  </Botao>
                </div>
              </form>
            ) : (
              <form onSubmit={desligar} className="grid gap-3 sm:grid-cols-2">
                <Campo
                  rotulo="Senha"
                  type="password"
                  autoComplete="current-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                />
                <Campo
                  rotulo="Código do aplicativo"
                  autoComplete="one-time-code"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  ajuda="Ou um código de recuperação."
                />
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <Botao type="submit" variante="perigo">
                    Confirmar e desligar
                  </Botao>
                  <Botao variante="discreta" onClick={() => setDesligando(false)}>
                    Cancelar
                  </Botao>
                </div>
              </form>
            )}
          </div>
        ) : cadastro ? (
          <form onSubmit={ativar} className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
            <CodigoQR
              texto={cadastro.endereco}
              tamanho={176}
              rotulo="QR Code para cadastrar a conta no aplicativo autenticador"
            />
            <div className="grid gap-3 text-sm min-w-0">
              <ol className="list-decimal pl-5 grid gap-1">
                <li>No aplicativo autenticador, adicione uma conta lendo o QR Code.</li>
                <li>
                  Sem câmera? Digite a chave:{' '}
                  <code className="break-all rounded bg-fundo px-1 font-mono">{cadastro.segredo}</code>
                </li>
                <li>Digite abaixo o código de 6 dígitos que o aplicativo mostrar, e a sua senha.</li>
              </ol>
              <Campo
                rotulo="Código do aplicativo"
                autoComplete="one-time-code"
                inputMode="numeric"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
              />
              {/* A senha prova que é a dona da conta quem está cadastrando o
                  aplicativo, e não alguém com a sessão aberta na mão. */}
              <Campo
                rotulo="Senha"
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                ajuda='Entrou só pelo Google e não tem senha? Crie uma em "Esqueci minha senha", na tela de login.'
              />
              <div className="flex flex-wrap gap-2">
                <Botao type="submit" variante="primaria">
                  Ligar
                </Botao>
                <Botao
                  variante="discreta"
                  onClick={() => {
                    setCadastro(null);
                    setSenha('');
                  }}
                >
                  Cancelar
                </Botao>
              </div>
            </div>
          </form>
        ) : (
          <div className="grid gap-3 text-sm">
            <p>
              <strong>Desligada.</strong>{' '}
              {recomendada
                ? 'Recomendada para o seu perfil: a gestão pode distribuir, cancelar e configurar o sistema.'
                : 'Opcional para o seu perfil.'}
            </p>
            <Botao variante="primaria" onClick={iniciar} className="justify-self-start">
              Ligar a verificação em duas etapas
            </Botao>
          </div>
        )}

        {codigos && (
          <div className="mt-4 grid gap-3 rounded border border-atencao/40 bg-atencao-tenue p-4 text-sm">
            <p className="font-medium text-atencao">
              Guarde estes códigos agora: eles não aparecem de novo. Cada um entra uma vez, para quando
              o celular não estiver à mão.
            </p>
            <ul className="grid grid-cols-2 gap-1 font-mono sm:grid-cols-4">
              {codigos.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Botao onClick={baixarCodigos} className="justify-self-start">
              Baixar em arquivo
            </Botao>
          </div>
        )}
      </Cartao>

      <Cartao
        titulo="Sessões"
        descricao="Esqueceu a conta aberta num computador compartilhado, ou acha que alguém entrou? Isto encerra a sessão em todos os aparelhos, inclusive neste."
      >
        <Botao variante="perigo" onClick={sairDeTodos}>
          Sair de todos os aparelhos
        </Botao>
      </Cartao>
    </div>
  );
}

export default MinhaConta;

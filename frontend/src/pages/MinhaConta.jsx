import { useCallback, useEffect, useRef, useState } from 'react';
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
 * sozinha. Se a administração exigir, ela deixa de ser opcional (e o resto do
 * sistema fica fechado até a pessoa ligar: ver RotaProtegida).
 *
 * O foco acompanha o que muda na tela. Ao abrir os passos da ativação, o botão
 * que foi clicado some, e o foco caía no corpo da página: quem usa teclado ou
 * leitor de tela recomeçava do cabeçalho, no único passo que a conta restrita
 * precisa dar. Por isso o foco vai ao começo do bloco novo — e não ao campo do
 * código, porque no celular o teclado subiria e cobriria o QR Code e os passos
 * antes de a pessoa lê-los.
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
  const [copia, setCopia] = useState(''); // '' | 'copiada' | 'falhou'

  const blocoAtivacao = useRef(null);
  const blocoCodigos = useRef(null);
  const voltarAoBotao = useRef(false);

  // Abriu os passos da ativação: o foco vai para o começo deles.
  useEffect(() => {
    if (cadastro) blocoAtivacao.current?.focus();
  }, [cadastro]);

  // Os códigos de recuperação aparecem uma vez só: o foco vai até eles.
  useEffect(() => {
    if (codigos) blocoCodigos.current?.focus();
  }, [codigos]);

  // Cancelou a ativação: o foco volta para o botão que a abriu.
  useEffect(() => {
    if (!cadastro && voltarAoBotao.current) {
      voltarAoBotao.current = false;
      document.getElementById('ligar-2fa')?.focus();
    }
  }, [cadastro]);

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
      setCopia('');
    }
  }

  // Num celular não dá para ler o QR Code da própria tela: a chave copiada
  // (sem os espaços de leitura) é o caminho que sobra. A API de área de
  // transferência só existe em conexão segura e pode ser recusada.
  async function copiarChave() {
    try {
      await navigator.clipboard.writeText(cadastro.segredo);
      setCopia('copiada');
    } catch {
      setCopia('falhou');
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
        descricao="Além da senha, um código de 6 dígitos do aplicativo autenticador."
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
          <form
            ref={blocoAtivacao}
            tabIndex={-1}
            aria-label="Passos para ligar a verificação em duas etapas"
            onSubmit={ativar}
            className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start"
          >
            <CodigoQR
              texto={cadastro.endereco}
              tamanho={176}
              rotulo="QR Code para cadastrar a conta no aplicativo autenticador"
            />
            <div className="grid gap-3 text-sm min-w-0">
              <ol className="list-decimal pl-5 grid gap-2">
                <li>
                  No aplicativo autenticador, adicione uma conta lendo o QR Code.
                  {/* Só em tela de toque: no computador o link não leva a lugar
                      nenhum, e no celular é o caminho principal. */}
                  <span className="mt-1 hidden [@media(pointer:coarse)]:block">
                    Neste celular não dá para ler o QR Code da própria tela.{' '}
                    <a
                      href={cadastro.endereco}
                      className="alvo-toque font-medium text-navy underline"
                    >
                      Abrir no aplicativo autenticador
                    </a>
                    , ou copie a chave abaixo.
                  </span>
                </li>
                <li>
                  Sem câmera? Copie a chave e cole no aplicativo:
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="select-all break-words rounded bg-fundo px-1 font-mono">
                      {cadastro.segredo.replace(/(.{4})/g, '$1 ').trim()}
                    </code>
                    <Botao tamanho="sm" onClick={copiarChave}>
                      Copiar chave
                    </Botao>
                  </span>
                  <span role="status" className="mt-1 block text-xs">
                    {copia === 'copiada' && <span className="text-sucesso">Chave copiada.</span>}
                    {copia === 'falhou' && (
                      <span className="text-erro">
                        Não foi possível copiar. Toque na chave para selecioná-la e copie.
                      </span>
                    )}
                  </span>
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
              />
              {/* Quase todo mundo tem senha; a ajuda de quem entrou só pelo
                  Google fica recolhida, para não ser lida (e estranhada) por
                  todos. A saída passa por sair da conta, e o texto diz isso:
                  em conta restrita pela exigência, é a única tela alcançável. */}
              <details className="text-xs text-tinta-2">
                <summary className="alvo-toque cursor-pointer py-1 font-medium text-navy">
                  Não tenho senha
                </summary>
                <p className="mt-1">
                  Quem entrou só pelo Google ainda não tem senha. Saia da conta e crie uma em "Esqueci
                  minha senha", na tela de login; depois volte para ligar a verificação.
                </p>
              </details>
              <div className="flex flex-wrap gap-2">
                <Botao type="submit" variante="primaria">
                  Ligar
                </Botao>
                <Botao
                  variante="discreta"
                  onClick={() => {
                    voltarAoBotao.current = true;
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
              {usuario.dois_fatores_pendente
                ? 'Obrigatória para o seu perfil: a administração exige a verificação de quem é da gestão.'
                : recomendada
                  ? 'Recomendada para o seu perfil: a gestão pode distribuir, cancelar e configurar o sistema.'
                  : 'Opcional para o seu perfil.'}
            </p>
            <Botao
              id="ligar-2fa"
              variante="primaria"
              onClick={iniciar}
              className="justify-self-start"
            >
              Ligar a verificação em duas etapas
            </Botao>
          </div>
        )}

        {codigos && (
          <div
            ref={blocoCodigos}
            tabIndex={-1}
            role="region"
            aria-label="Códigos de recuperação"
            className="mt-4 grid gap-3 rounded border border-atencao/40 bg-atencao-tenue p-4 text-sm"
          >
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
        descricao="Encerra a sessão em todos os aparelhos, inclusive neste."
      >
        <Botao variante="perigo" onClick={sairDeTodos}>
          Sair de todos os aparelhos
        </Botao>
      </Cartao>

      <Cartao titulo="Seus dados">
        <a
          href="/privacidade"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-navy underline"
        >
          Ler o aviso de privacidade{' '}<span className="sr-only">(abre em outra aba)</span>
        </a>
      </Cartao>
    </div>
  );
}

export default MinhaConta;

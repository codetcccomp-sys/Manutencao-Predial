import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Tabela from '../components/ui/Tabela';
import Aviso from '../components/ui/Aviso';
import CabecalhoDePagina from '../components/ui/CabecalhoDePagina';
import Botao from '../components/ui/Botao';
import { Esqueleto, Regiao } from '../components/ui/Estados';
import Confirmacao from '../components/ui/Confirmacao';
import MostrarMais from '../components/ui/MostrarMais';
import CadastrosPendentes from '../components/CadastrosPendentes';
import ExigenciaDoisFatores from '../components/ExigenciaDoisFatores';
import LimiteDeAnexos from '../components/LimiteDeAnexos';
import ErrosDoSistema from '../components/ErrosDoSistema';
import UsoEDesempenho from '../components/UsoEDesempenho';
import { MINIMO_SENHA } from '../dominio/senha';

const PERFIS = [
  { valor: 'solicitante', rotulo: 'Solicitante' },
  { valor: 'tecnico', rotulo: 'Técnico' },
  { valor: 'gestor', rotulo: 'Gestor' },
  { valor: 'administrador', rotulo: 'Administrador' },
];

const PERFIL_COR = {
  solicitante: 'bg-gray-200 text-gray-800',
  tecnico: 'bg-blue-100 text-blue-700',
  gestor: 'bg-amber/20 text-amber',
  administrador: 'bg-green-100 text-sucesso',
};

// Quantas contas a tabela desenha de cada vez (cada linha vira duas: tabela e cartão, no celular).
const PASSO_DA_LISTA = 25;
// Abaixo disto o filtro só atrapalharia.
const MINIMO_PARA_FILTRAR = 12;
const FORMULARIO_VAZIO = { nome: '', email: '', senha: '', perfil: 'tecnico' };

function Usuarios() {
  const { usuario } = useAuth();
  const ehAdministrador = usuario.perfil === 'administrador';

  const [usuarios, setUsuarios] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [quantos, setQuantos] = useState(PASSO_DA_LISTA);
  const [novo, setNovo] = useState(FORMULARIO_VAZIO);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  // Quem está para ser anonimizado. `null` é o diálogo fechado.
  const [aAnonimizar, setAAnonimizar] = useState(null);
  const [aRedefinir2fa, setARedefinir2fa] = useState(null);
  const [redefinindo, setRedefinindo] = useState(false);
  const [anonimizando, setAnonimizando] = useState(false);

  const carregar = useCallback(() => {
    setCarregando(true);
    api
      .get('/usuarios', { params: { incluir_inativos: 'true' } })
      .then(({ data }) => setUsuarios(data.usuarios))
      .catch(() => setErro('Não foi possível carregar os usuários.'))
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => {
    if (ehAdministrador) carregar();
  }, [carregar, ehAdministrador]);

  if (!ehAdministrador) return <Navigate to="/" replace />;

  async function criar(e) {
    e.preventDefault();
    setErro('');
    setAviso('');
    setSalvando(true);
    try {
      const { data } = await api.post('/usuarios', novo);
      setNovo(FORMULARIO_VAZIO);
      const rotulo = PERFIS.find((p) => p.valor === data.usuario.perfil)?.rotulo ?? data.usuario.perfil;
      setAviso(`${data.usuario.nome} cadastrado como ${rotulo.toLowerCase()}.`);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível cadastrar o usuário.');
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Atende um pedido de remoção (LGPD, docs/lgpd.md §5).
   *
   * A rota existia e a tela não sabia dela: anonimizar exigia chamar a API
   * na mão. E a tela ainda oferecia "Reativar" para a conta anonimizada — um
   * botão que falhava sempre, porque conta anonimizada não volta.
   */
  // Para quem perdeu o celular e os códigos de recuperação.
  async function redefinir2fa() {
    setErro('');
    setAviso('');
    setRedefinindo(true);
    try {
      await api.post(`/usuarios/${aRedefinir2fa.id}/2fa/redefinir`);
      setAviso(
        `A verificação em duas etapas de ${aRedefinir2fa.nome} foi desligada, e as sessões dela encerradas. Ela entra só com a senha e pode ligar de novo em Minha conta.`
      );
      setARedefinir2fa(null);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível redefinir.');
      setARedefinir2fa(null);
    } finally {
      setRedefinindo(false);
    }
  }

  async function anonimizar() {
    setErro('');
    setAviso('');
    setAnonimizando(true);
    try {
      await api.post(`/usuarios/${aAnonimizar.id}/anonimizar`);
      setAviso(`${aAnonimizar.nome} foi anonimizado. Os chamados continuam no histórico.`);
      setAAnonimizar(null);
      carregar();
    } catch (err) {
      // A recusa mais comum é de técnico com chamado em aberto, e a mensagem
      // do servidor já diz quantos e o que fazer. O diálogo fecha para a
      // pessoa ler o aviso e ir reatribuir.
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível anonimizar.');
      setAAnonimizar(null);
    } finally {
      setAnonimizando(false);
    }
  }

  async function alterar(id, mudanca) {
    setErro('');
    setAviso('');
    try {
      await api.patch(`/usuarios/${id}`, mudanca);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível alterar o usuário.');
    }
  }

  // O filtro vale para a lista inteira; só o desenho é adiado (MostrarMais).
  const termo = filtro.trim().toLowerCase();
  const usuariosFiltrados = termo
    ? usuarios.filter((u) => `${u.nome} ${u.email}`.toLowerCase().includes(termo))
    : usuarios;
  const usuariosVisiveis = usuariosFiltrados.slice(0, quantos);

  return (
    <div className="grid gap-6">
      <CabecalhoDePagina titulo="Usuários" className="mb-0" />

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <div className="bg-sucesso-tenue text-sucesso text-sm rounded p-3">{aviso}</div>}

      <CadastrosPendentes comConfiguracao />

      {!carregando && <ExigenciaDoisFatores usuarios={usuarios} />}

      <LimiteDeAnexos />

      <form onSubmit={criar} className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3">
        <h2 className="font-medium text-navy">Cadastrar usuário</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-tinta-2">Nome</span>
            <input
              required
              type="text"
              minLength={3}
              value={novo.nome}
              onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
              className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-tinta-2">E-mail</span>
            <input
              required
              type="email"
              value={novo.email}
              onChange={(e) => setNovo({ ...novo, email: e.target.value })}
              className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-tinta-2">Senha provisória (ao menos {MINIMO_SENHA} caracteres)</span>
            <input
              required
              type="password"
              minLength={MINIMO_SENHA}
              value={novo.senha}
              onChange={(e) => setNovo({ ...novo, senha: e.target.value })}
              className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-tinta-2">Perfil</span>
            <select
              value={novo.perfil}
              onChange={(e) => setNovo({ ...novo, perfil: e.target.value })}
              className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
            >
              {PERFIS.map((p) => (
                <option key={p.valor} value={p.valor}>
                  {p.rotulo}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          disabled={salvando}
          className="bg-navy text-white rounded py-2 font-medium hover:bg-navy-2 disabled:opacity-60 justify-self-start px-6"
        >
          {salvando ? 'Cadastrando...' : 'Cadastrar'}
        </button>
      </form>

      {/* min-w-0: o cartão é item de grid, e sem isso a tabela de cinco
          colunas vazava para fora em vez de rolar dentro do overflow-x-auto,
          levando a página inteira junto no celular. */}
      <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6 min-w-0">
        <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-medium text-navy">Cadastrados</h2>
          {usuarios.length > MINIMO_PARA_FILTRAR && (
            <input
              type="search"
              aria-label="Filtrar usuários por nome ou e-mail"
              value={filtro}
              onChange={(e) => {
                setFiltro(e.target.value);
                setQuantos(PASSO_DA_LISTA);
              }}
              placeholder="Filtrar por nome ou e-mail"
              className="min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm sm:w-64"
            />
          )}
        </div>

        <Regiao carregando={carregando}>
        {carregando ? (
          <Esqueleto linhas={3} altura="h-10" />
        ) : (
        <Tabela
          legenda="Usuários cadastrados no sistema"
          chaveDaLinha={(u) => u.id}
          linhas={usuariosVisiveis}
          vazio={
            <p className="text-sm text-tinta-2">
              {filtro.trim() ? 'Nenhuma conta corresponde ao filtro.' : 'Nenhum usuário cadastrado.'}
            </p>
          }
          colunas={[
            {
              chave: 'nome',
              rotulo: 'Nome',
              principal: true,
              conteudo: (u) => (
                <span className={u.ativo ? '' : 'opacity-60'}>
                  {u.nome}
                  {u.id === usuario.id && <span className="text-xs text-tinta-2"> (você)</span>}
                </span>
              ),
            },
            {
              chave: 'email',
              rotulo: 'E-mail',
              conteudo: (u) => <span className="text-tinta-2 break-all">{u.email}</span>,
            },
            {
              chave: 'perfil',
              rotulo: 'Perfil',
              conteudo: (u) => (
                <>
                  {/* O seletor não tem rótulo visível — a coluna já diz o que
                      é —, mas precisa de nome acessível próprio: numa tela com
                      vinte usuários, um leitor de tela anunciaria vinte
                      "caixas de seleção" idênticas.

                      `aria-label`, e não `<label htmlFor>`: a Tabela desenha a
                      MESMA coluna duas vezes, como linha de tabela e como
                      bloco, escondendo uma das duas por CSS. Um `id` aqui
                      apareceria duas vezes no documento, e o `htmlFor` casaria
                      sempre com a primeira — a escondida. No celular, o
                      seletor visível ficava sem nome acessível nenhum. O
                      `aria-label` não depende de id e por isso não quebra. */}
                  <select
                    aria-label={`Perfil de ${u.nome}`}
                    value={u.perfil}
                    disabled={u.id === usuario.id || Boolean(u.anonimizado_em)}
                    onChange={(e) => alterar(u.id, { perfil: e.target.value })}
                    className={`rounded px-2 py-1 text-xs ${PERFIL_COR[u.perfil]} disabled:cursor-not-allowed`}
                    title={u.id === usuario.id ? 'Não é possível alterar o próprio perfil.' : undefined}
                  >
                    {PERFIS.map((p) => (
                      <option key={p.valor} value={p.valor}>
                        {p.rotulo}
                      </option>
                    ))}
                  </select>
                </>
              ),
            },
            {
              chave: 'ativo',
              rotulo: 'Situação',
              conteudo: (u) =>
                u.anonimizado_em ? (
                  <span className="text-tinta-2">Anonimizado</span>
                ) : u.ativo ? (
                  <span className="text-sucesso">
                    Ativo{u.dois_fatores && <span className="text-tinta-2"> · duas etapas</span>}
                  </span>
                ) : (
                  <span className="text-tinta-2">Desligado</span>
                ),
            },
            {
              chave: 'acoes',
              rotulo: 'Ações',
              conteudo: (u) =>
                // Conta anonimizada não tem ação nenhuma: não volta, e a
                // segunda anonimização é recusada. Oferecer "Reativar" aqui
                // era oferecer um botão que falha sempre.
                u.anonimizado_em ? (
                  <span className="text-xs text-tinta-2">—</span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Botao
                      variante="discreta"
                      tamanho="sm"
                      disabled={u.id === usuario.id}
                      onClick={() => alterar(u.id, { ativo: !u.ativo })}
                      title={u.id === usuario.id ? 'Não é possível desativar a própria conta.' : undefined}
                    >
                      {u.ativo ? 'Desligar' : 'Reativar'}
                    </Botao>
                    {u.id !== usuario.id && u.dois_fatores && (
                      <Botao variante="discreta" tamanho="sm" onClick={() => setARedefinir2fa(u)}>
                        Redefinir duas etapas
                      </Botao>
                    )}
                    {u.id !== usuario.id && (
                      <Botao variante="discreta" tamanho="sm" onClick={() => setAAnonimizar(u)}>
                        Anonimizar
                      </Botao>
                    )}
                  </div>
                ),
            },
          ]}
        />
        )}
        </Regiao>
        <MostrarMais
          mostrando={usuariosVisiveis.length}
          total={usuariosFiltrados.length}
          passo={PASSO_DA_LISTA}
          onMais={() => setQuantos((n) => n + PASSO_DA_LISTA)}
          nome="contas"
        />
      </div>

      <UsoEDesempenho />
      <ErrosDoSistema />

      <Confirmacao
        aberto={Boolean(aRedefinir2fa)}
        titulo={aRedefinir2fa ? `Redefinir as duas etapas de ${aRedefinir2fa.nome}?` : ''}
        rotuloConfirmar="Redefinir"
        carregando={redefinindo}
        onConfirmar={redefinir2fa}
        onCancelar={() => setARedefinir2fa(null)}
      >
        <p>
          Para quem perdeu o celular e os códigos de recuperação. A conta volta a entrar só com a senha,
          e todas as sessões abertas dela são encerradas.
        </p>
        <p className="mt-2 font-medium">
          Confirme por outro canal que o pedido veio mesmo da pessoa: quem tem a senha dela e pede
          isso está pedindo para tirar a última proteção da conta.
        </p>
      </Confirmacao>

      <Confirmacao
        aberto={Boolean(aAnonimizar)}
        titulo={aAnonimizar ? `Anonimizar ${aAnonimizar.nome}?` : ''}
        rotuloConfirmar="Anonimizar"
        carregando={anonimizando}
        onConfirmar={anonimizar}
        onCancelar={() => setAAnonimizar(null)}
      >
        <p>
          Nome, e-mail e senha são apagados e a conta não entra mais. Os chamados, comentários e
          avaliações continuam no histórico, assinados por &quot;Usuário removido&quot;.
        </p>
        <p className="mt-2 font-medium">Não dá para desfazer.</p>
      </Confirmacao>
    </div>
  );
}

export default Usuarios;

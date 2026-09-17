import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

const ABAS = [
  { id: 'locais', rotulo: 'Locais' },
  { id: 'categorias', rotulo: 'Categorias' },
  { id: 'equipes', rotulo: 'Equipes' },
];

const LOCAL_VAZIO = { unidade: '', bloco: '', pavimento: '', setor: '', ambiente: '' };

// Os cinco níveis do local, na ordem em que o Termo de Abertura os descreve.
const NIVEIS_LOCAL = [
  { campo: 'unidade', rotulo: 'Unidade', obrigatorio: true },
  { campo: 'bloco', rotulo: 'Bloco' },
  { campo: 'pavimento', rotulo: 'Pavimento' },
  { campo: 'setor', rotulo: 'Setor' },
  { campo: 'ambiente', rotulo: 'Ambiente' },
];

function rotuloLocal(local) {
  return NIVEIS_LOCAL.map((n) => local[n.campo])
    .filter(Boolean)
    .join(' / ');
}

function Cadastros() {
  const { usuario } = useAuth();
  const podeGerenciar = ['administrador', 'gestor'].includes(usuario.perfil);

  const [aba, setAba] = useState('locais');
  const [locais, setLocais] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [equipes, setEquipes] = useState([]);
  const [tecnicos, setTecnicos] = useState([]);

  const [novoLocal, setNovoLocal] = useState(LOCAL_VAZIO);
  const [filtroLocal, setFiltroLocal] = useState('');
  const [novaCategoria, setNovaCategoria] = useState('');
  const [novaEquipe, setNovaEquipe] = useState('');
  const [equipeAberta, setEquipeAberta] = useState(null);

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(() => {
    setCarregando(true);
    Promise.all([
      api.get('/locais', { params: { incluir_inativos: 'true' } }),
      api.get('/categorias'),
      api.get('/equipes', { params: { incluir_inativas: 'true' } }),
      api.get('/usuarios', { params: { perfil: 'tecnico' } }),
    ])
      .then(([l, c, e, t]) => {
        setLocais(l.data.locais);
        setCategorias(c.data.categorias);
        setEquipes(e.data.equipes);
        setTecnicos(t.data.usuarios);
      })
      .catch(() => setErro('Não foi possível carregar os cadastros.'))
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => {
    if (podeGerenciar) carregar();
  }, [carregar, podeGerenciar]);

  if (!podeGerenciar) return <Navigate to="/" replace />;

  const termo = filtroLocal.trim().toLowerCase();
  const locaisFiltrados = termo
    ? locais.filter((l) => rotuloLocal(l).toLowerCase().includes(termo))
    : locais;

  async function executar(acao, mensagem) {
    setErro('');
    setAviso('');
    try {
      await acao();
      if (mensagem) setAviso(mensagem);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível concluir a operação.');
    }
  }

  async function abrirEquipe(id) {
    setErro('');
    try {
      const { data } = await api.get(`/equipes/${id}`);
      setEquipeAberta(data.equipe);
    } catch {
      setErro('Não foi possível carregar a equipe.');
    }
  }

  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-lg font-bold text-navy">Cadastros</h2>
        <p className="text-sm text-gray-500">
          Nada aqui é apagado: locais e equipes são desativados, e categorias são renomeadas. Os
          chamados antigos continuam apontando para o registro original.
        </p>
      </div>

      {erro && <div className="bg-red-50 text-red-700 text-sm rounded p-3">{erro}</div>}
      {aviso && <div className="bg-green-50 text-green-700 text-sm rounded p-3">{aviso}</div>}

      <div className="flex gap-2 border-b">
        {ABAS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              aba === a.id ? 'border-navy text-navy' : 'border-transparent text-gray-500'
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {carregando && <p className="text-gray-500 text-sm">Carregando...</p>}

      {!carregando && aba === 'locais' && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              executar(async () => {
                await api.post('/locais', novoLocal);
                setNovoLocal(LOCAL_VAZIO);
              }, 'Local cadastrado.');
            }}
            className="bg-white rounded-lg shadow-sm p-6 grid gap-3"
          >
            <h3 className="font-medium text-navy">Cadastrar local</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {NIVEIS_LOCAL.map((n) => (
                <label key={n.campo} className="grid gap-1 text-sm">
                  <span className="text-gray-600">
                    {n.rotulo}
                    {!n.obrigatorio && <span className="text-gray-400"> (opcional)</span>}
                  </span>
                  <input
                    type="text"
                    required={n.obrigatorio}
                    value={novoLocal[n.campo]}
                    onChange={(e) => setNovoLocal({ ...novoLocal, [n.campo]: e.target.value })}
                    className="border rounded px-3 py-2"
                  />
                </label>
              ))}
            </div>
            <button className="bg-navy text-white rounded py-2 font-medium hover:bg-navy-2 justify-self-start px-6">
              Cadastrar
            </button>
          </form>

          <div className="bg-white rounded-lg shadow-sm p-6">
            {/* Uma instituição tem centenas de ambientes. Sem um filtro, achar
                um local para desativar vira rolagem de página inteira. */}
            <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="font-medium text-navy">Cadastrados</h3>
              <input
                type="search"
                value={filtroLocal}
                onChange={(e) => setFiltroLocal(e.target.value)}
                placeholder="Filtrar locais"
                className="border rounded px-3 py-2 text-sm sm:w-64"
              />
            </div>
            <p className="text-xs text-gray-500 mb-3">
              {locaisFiltrados.length} de {locais.length}{' '}
              {locais.length === 1 ? 'local' : 'locais'}.
            </p>
            <ul className="grid gap-2 text-sm">
              {locaisFiltrados.length === 0 && (
                <li className="text-gray-500">Nenhum local corresponde ao filtro.</li>
              )}
              {locaisFiltrados.map((l) => (
                <li
                  key={l.id}
                  className={`flex items-center justify-between gap-3 border rounded px-3 py-2 ${
                    l.ativo ? '' : 'opacity-60'
                  }`}
                >
                  <span className="text-navy">{rotuloLocal(l)}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={l.ativo ? 'text-green-700 text-xs' : 'text-gray-500 text-xs'}>
                      {l.ativo ? 'Ativo' : 'Desativado'}
                    </span>
                    <button
                      onClick={() =>
                        executar(() => api.patch(`/locais/${l.id}`, { ativo: !l.ativo }))
                      }
                      className="text-xs text-navy hover:underline"
                    >
                      {l.ativo ? 'Desativar' : 'Reativar'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {!carregando && aba === 'categorias' && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              executar(async () => {
                await api.post('/categorias', { nome: novaCategoria });
                setNovaCategoria('');
              }, 'Categoria cadastrada.');
            }}
            className="bg-white rounded-lg shadow-sm p-6 grid gap-3"
          >
            <h3 className="font-medium text-navy">Cadastrar categoria</h3>
            <div className="flex gap-2">
              <input
                type="text"
                required
                minLength={3}
                value={novaCategoria}
                onChange={(e) => setNovaCategoria(e.target.value)}
                className="border rounded px-3 py-2 flex-1"
              />
              <button className="bg-navy text-white rounded px-6 font-medium hover:bg-navy-2">
                Cadastrar
              </button>
            </div>
          </form>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="font-medium text-navy mb-3">Cadastradas</h3>
            <ul className="grid gap-2 text-sm">
              {categorias.map((c) => (
                <li key={c.id} className="flex items-center gap-2 border rounded px-3 py-2">
                  <input
                    type="text"
                    defaultValue={c.nome}
                    onBlur={(e) => {
                      const nome = e.target.value.trim();
                      if (nome && nome !== c.nome) {
                        executar(() => api.patch(`/categorias/${c.id}`, { nome }), 'Categoria renomeada.');
                      }
                    }}
                    className="border rounded px-2 py-1 flex-1"
                  />
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {!carregando && aba === 'equipes' && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              executar(async () => {
                await api.post('/equipes', { nome: novaEquipe });
                setNovaEquipe('');
              }, 'Equipe cadastrada.');
            }}
            className="bg-white rounded-lg shadow-sm p-6 grid gap-3"
          >
            <h3 className="font-medium text-navy">Cadastrar equipe</h3>
            <div className="flex gap-2">
              <input
                type="text"
                required
                minLength={2}
                value={novaEquipe}
                onChange={(e) => setNovaEquipe(e.target.value)}
                className="border rounded px-3 py-2 flex-1"
              />
              <button className="bg-navy text-white rounded px-6 font-medium hover:bg-navy-2">
                Cadastrar
              </button>
            </div>
          </form>

          <div className="bg-white rounded-lg shadow-sm p-6 grid gap-3">
            <h3 className="font-medium text-navy">Cadastradas</h3>
            <ul className="grid gap-2 text-sm">
              {equipes.map((e) => (
                <li key={e.id} className={`border rounded px-3 py-2 ${e.ativo ? '' : 'opacity-60'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={() => abrirEquipe(e.id)}
                      className="text-navy font-medium hover:underline text-left"
                    >
                      {e.nome}
                    </button>
                    <div className="flex items-center gap-3 shrink-0 text-xs">
                      <span className="text-gray-500">
                        {e.total_tecnicos} {e.total_tecnicos === 1 ? 'técnico' : 'técnicos'}
                      </span>
                      <button
                        onClick={() =>
                          executar(() => api.patch(`/equipes/${e.id}`, { ativo: !e.ativo }))
                        }
                        className="text-navy hover:underline"
                      >
                        {e.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                    </div>
                  </div>

                  {equipeAberta?.id === e.id && (
                    <div className="mt-3 border-t pt-3 grid gap-2">
                      {equipeAberta.tecnicos.length === 0 ? (
                        <p className="text-gray-500 text-xs">Nenhum técnico nesta equipe.</p>
                      ) : (
                        equipeAberta.tecnicos.map((t) => (
                          <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                            <span>
                              {t.nome} <span className="text-gray-500">{t.email}</span>
                            </span>
                            <button
                              onClick={() =>
                                executar(async () => {
                                  await api.delete(`/equipes/${e.id}/tecnicos/${t.id}`);
                                  abrirEquipe(e.id);
                                })
                              }
                              className="text-red-600 hover:underline"
                            >
                              Remover
                            </button>
                          </div>
                        ))
                      )}

                      <select
                        value=""
                        onChange={(ev) => {
                          if (!ev.target.value) return;
                          executar(async () => {
                            await api.post(`/equipes/${e.id}/tecnicos`, {
                              usuario_id: Number(ev.target.value),
                            });
                            abrirEquipe(e.id);
                          });
                        }}
                        className="border rounded px-2 py-1 text-xs"
                      >
                        <option value="">Adicionar técnico...</option>
                        {tecnicos
                          .filter((t) => !equipeAberta.tecnicos.some((m) => m.id === t.id))
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.nome}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export default Cadastros;

import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

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
  administrador: 'bg-green-100 text-green-700',
};

const FORMULARIO_VAZIO = { nome: '', email: '', senha: '', perfil: 'tecnico' };

function Usuarios() {
  const { usuario } = useAuth();
  const ehAdministrador = usuario.perfil === 'administrador';

  const [usuarios, setUsuarios] = useState([]);
  const [novo, setNovo] = useState(FORMULARIO_VAZIO);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

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

  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-lg font-bold text-navy">Usuários</h2>
        <p className="text-sm text-gray-500">
          Técnicos, gestores e administradores só podem ser criados aqui — o cadastro público sempre
          gera um solicitante.
        </p>
      </div>

      {erro && <div className="bg-red-50 text-red-700 text-sm rounded p-3">{erro}</div>}
      {aviso && <div className="bg-green-50 text-green-700 text-sm rounded p-3">{aviso}</div>}

      <form onSubmit={criar} className="bg-white rounded-lg shadow-sm p-6 grid gap-3">
        <h3 className="font-medium text-navy">Cadastrar usuário</h3>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-gray-600">Nome</span>
            <input
              required
              type="text"
              minLength={3}
              value={novo.nome}
              onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
              className="border rounded px-3 py-2"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-gray-600">E-mail</span>
            <input
              required
              type="email"
              value={novo.email}
              onChange={(e) => setNovo({ ...novo, email: e.target.value })}
              className="border rounded px-3 py-2"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-gray-600">Senha provisória</span>
            <input
              required
              type="password"
              minLength={6}
              value={novo.senha}
              onChange={(e) => setNovo({ ...novo, senha: e.target.value })}
              className="border rounded px-3 py-2"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-gray-600">Perfil</span>
            <select
              value={novo.perfil}
              onChange={(e) => setNovo({ ...novo, perfil: e.target.value })}
              className="border rounded px-3 py-2"
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

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="font-medium text-navy mb-3">Cadastrados</h3>

        {carregando ? (
          <p className="text-sm text-gray-500">Carregando...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-4 font-medium">Nome</th>
                  <th className="py-2 pr-4 font-medium">E-mail</th>
                  <th className="py-2 pr-4 font-medium">Perfil</th>
                  <th className="py-2 pr-4 font-medium">Situação</th>
                  <th className="py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => {
                  const ehEu = u.id === usuario.id;
                  return (
                    <tr key={u.id} className={`border-b last:border-0 ${u.ativo ? '' : 'opacity-60'}`}>
                      <td className="py-2 pr-4 text-navy">
                        {u.nome}
                        {ehEu && <span className="text-xs text-gray-500"> (você)</span>}
                      </td>
                      <td className="py-2 pr-4 text-gray-600">{u.email}</td>
                      <td className="py-2 pr-4">
                        <select
                          value={u.perfil}
                          disabled={ehEu}
                          onChange={(e) => alterar(u.id, { perfil: e.target.value })}
                          className={`text-xs rounded px-2 py-1 ${PERFIL_COR[u.perfil]} disabled:cursor-not-allowed`}
                          title={ehEu ? 'Não é possível alterar o próprio perfil.' : undefined}
                        >
                          {PERFIS.map((p) => (
                            <option key={p.valor} value={p.valor}>
                              {p.rotulo}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-4">
                        {u.ativo ? (
                          <span className="text-green-700">Ativo</span>
                        ) : (
                          <span className="text-gray-500">Desligado</span>
                        )}
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => alterar(u.id, { ativo: !u.ativo })}
                          disabled={ehEu}
                          className="text-xs text-navy hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                          title={ehEu ? 'Não é possível desativar a própria conta.' : undefined}
                        >
                          {u.ativo ? 'Desligar' : 'Reativar'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default Usuarios;

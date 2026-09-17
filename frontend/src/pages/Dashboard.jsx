import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';

const ESTADO_LABEL = {
  aberto: 'Aberto',
  em_triagem: 'Em triagem',
  atribuido: 'Atribuído',
  em_andamento: 'Em andamento',
  aguardando_material: 'Aguardando material',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

const ESTADO_COR = {
  aberto: 'bg-gray-200 text-gray-800',
  em_triagem: 'bg-amber/20 text-amber',
  atribuido: 'bg-blue-100 text-blue-700',
  em_andamento: 'bg-blue-100 text-blue-700',
  aguardando_material: 'bg-yellow-100 text-yellow-700',
  concluido: 'bg-green-100 text-green-700',
  cancelado: 'bg-red-100 text-red-700',
};

function Dashboard() {
  const [chamados, setChamados] = useState([]);
  const [paginacao, setPaginacao] = useState({ pagina: 1, limite: 20, total: 0, paginas: 0 });
  const [estado, setEstado] = useState('');
  const [somenteAtrasados, setSomenteAtrasados] = useState(false);
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  // Uma consulta por tecla afogaria o banco e faria a lista piscar a cada
  // letra; espera a digitação parar antes de perguntar.
  useEffect(() => {
    const id = setTimeout(() => {
      setBuscaAplicada(busca.trim());
      setPagina(1);
    }, 400);
    return () => clearTimeout(id);
  }, [busca]);

  const carregar = useCallback(() => {
    setCarregando(true);
    setErro('');
    api
      .get('/chamados', {
        params: {
          pagina,
          ...(estado ? { estado } : {}),
          ...(somenteAtrasados ? { atrasados: 'true' } : {}),
          ...(buscaAplicada ? { busca: buscaAplicada } : {}),
        },
      })
      .then(({ data }) => {
        setChamados(data.chamados);
        setPaginacao(data.paginacao);
      })
      .catch(() => setErro('Não foi possível carregar os chamados.'))
      .finally(() => setCarregando(false));
  }, [pagina, estado, somenteAtrasados, buscaAplicada]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Trocar o filtro com a página 3 aberta pediria uma página que o novo
  // filtro pode nem ter; volta para a primeira.
  function trocarEstado(novo) {
    setEstado(novo);
    setPagina(1);
  }

  function alternarAtrasados(ligado) {
    setSomenteAtrasados(ligado);
    setPagina(1);
  }

  const primeiro = paginacao.total === 0 ? 0 : (paginacao.pagina - 1) * paginacao.limite + 1;
  const ultimo = Math.min(paginacao.pagina * paginacao.limite, paginacao.total);

  return (
    <div>
      <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-bold text-navy">Chamados</h2>
        <Link
          to="/chamados/novo"
          className="bg-amber text-white text-sm font-medium rounded px-4 py-2 hover:opacity-90 text-center"
        >
          + Novo chamado
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex-1 min-w-[16rem]">
          <label className="sr-only" htmlFor="busca">
            Buscar
          </label>
          <input
            id="busca"
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por protocolo ou título"
            className="border rounded px-3 py-2 text-sm bg-white w-full"
          />
        </div>

        <div>
          <label className="text-sm text-gray-600 mr-2" htmlFor="filtro-estado">
            Estado
          </label>
          <select
            id="filtro-estado"
            value={estado}
            onChange={(e) => trocarEstado(e.target.value)}
            className="border rounded px-3 py-2 text-sm bg-white"
          >
            <option value="">Todos</option>
            {Object.entries(ESTADO_LABEL).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={somenteAtrasados}
            onChange={(e) => alternarAtrasados(e.target.checked)}
            className="rounded"
          />
          Somente atrasados
        </label>
      </div>

      {erro && <div className="bg-red-50 text-red-700 text-sm rounded p-3 mb-4">{erro}</div>}
      {carregando && <p className="text-gray-500 text-sm">Carregando...</p>}

      {!carregando && chamados.length === 0 && (
        <p className="text-gray-500 text-sm">
          {buscaAplicada
            ? `Nenhum chamado encontrado para "${buscaAplicada}".`
            : 'Nenhum chamado encontrado.'}
        </p>
      )}

      {/* min-w-0 no cartão: item de grid não encolhe abaixo do próprio
          conteúdo por padrão, então um título longo — que o truncate deveria
          cortar — esticava a página inteira e dava rolagem horizontal no
          celular. */}
      <div className="grid gap-3">
        {chamados.map((c) => (
          <Link
            key={c.id}
            to={`/chamados/${c.id}`}
            className="bg-white rounded-lg shadow-sm p-4 flex items-center justify-between gap-3 min-w-0 hover:shadow-md transition"
          >
            <div className="min-w-0">
              <p className="font-medium text-navy truncate">{c.titulo}</p>
              <p className="text-xs text-gray-500">{c.protocolo}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {c.em_atraso && (
                <span className="text-xs font-medium px-2 py-1 rounded bg-red-100 text-red-700">
                  Em atraso
                </span>
              )}
              <span className={`text-xs font-medium px-2 py-1 rounded ${ESTADO_COR[c.estado]}`}>
                {ESTADO_LABEL[c.estado]}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {paginacao.total > 0 && (
        <div className="flex items-center justify-between gap-3 mt-6 text-sm">
          <span className="text-gray-600">
            {primeiro}–{ultimo} de {paginacao.total}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPagina((p) => p - 1)}
              disabled={paginacao.pagina <= 1 || carregando}
              className="border rounded px-3 py-1 bg-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Anterior
            </button>
            <span className="text-gray-600">
              {paginacao.pagina} / {paginacao.paginas}
            </span>
            <button
              onClick={() => setPagina((p) => p + 1)}
              disabled={paginacao.pagina >= paginacao.paginas || carregando}
              className="border rounded px-3 py-1 bg-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;

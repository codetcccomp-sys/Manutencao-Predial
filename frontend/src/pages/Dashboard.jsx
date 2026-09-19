import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { BadgeAtraso, BadgeEstado, BadgePrioridade } from '../components/ui/Badge';
import { ESTADOS, ORDEM_ESTADOS } from '../dominio/rotulos';

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
            {ORDEM_ESTADOS.map((valor) => (
              <option key={valor} value={valor}>
                {ESTADOS[valor].rotulo}
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
              {/* A prioridade não aparecia na lista: quem varre o painel
                  procurando o que atacar primeiro não tinha como saber sem
                  abrir chamado por chamado — justamente o dado que a
                  priorização do §2.5 existe para produzir. Fica à esquerda,
                  com o protocolo, para não disputar largura com estado e
                  atraso no celular. */}
              <div className="flex items-center gap-2 mt-0.5 min-w-0">
                <span className="text-xs text-tinta-2 truncate">{c.protocolo}</span>
                <BadgePrioridade prioridade={c.prioridade} />
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {c.em_atraso && <BadgeAtraso />}
              <BadgeEstado estado={c.estado} />
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

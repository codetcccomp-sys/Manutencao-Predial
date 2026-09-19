import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { BadgeAtraso, BadgeEstado, BadgePrioridade } from '../components/ui/Badge';
import { ESTADOS, ORDEM_ESTADOS } from '../dominio/rotulos';
import CabecalhoDePagina from '../components/ui/CabecalhoDePagina';
import Aviso from '../components/ui/Aviso';
import Botao from '../components/ui/Botao';
import { EstadoVazio, Esqueleto, Regiao } from '../components/ui/Estados';
import Icone from '../components/ui/Icone';

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

  function limparFiltros() {
    setBusca('');
    setEstado('');
    setSomenteAtrasados(false);
    setPagina(1);
  }

  const temFiltro = Boolean(buscaAplicada || estado || somenteAtrasados);
  const primeiro = paginacao.total === 0 ? 0 : (paginacao.pagina - 1) * paginacao.limite + 1;
  const ultimo = Math.min(paginacao.pagina * paginacao.limite, paginacao.total);

  return (
    <div>
      <CabecalhoDePagina
        titulo="Chamados"
        acao={
          <Link
            to="/chamados/novo"
            className="alvo-toque inline-flex items-center justify-center gap-2 rounded bg-navy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-2"
          >
            + Novo chamado
          </Link>
        }
      />

      {/* Os filtros numa faixa própria, separados da lista por borda em vez de
          cartão: são controles, não conteúdo, e um cartão a mais só somaria
          moldura ao redor de três campos. */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-borda bg-superficie p-3">
        <div className="min-w-[14rem] flex-1">
          <label className="sr-only" htmlFor="busca">
            Buscar
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tinta-2">
              <Icone nome="busca" />
            </span>
            <input
              id="busca"
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por protocolo ou título"
              className="w-full min-w-0 rounded border border-borda-forte bg-superficie py-2 pl-9 pr-3 text-sm placeholder:text-tinta-2"
            />
          </div>
        </div>

        <div className="min-w-0">
          <label className="mr-2 text-sm text-tinta-2" htmlFor="filtro-estado">
            Estado
          </label>
          <select
            id="filtro-estado"
            value={estado}
            onChange={(e) => trocarEstado(e.target.value)}
            className="min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            {ORDEM_ESTADOS.map((valor) => (
              <option key={valor} value={valor}>
                {ESTADOS[valor].rotulo}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 py-2 text-sm text-tinta-2">
          <input
            type="checkbox"
            checked={somenteAtrasados}
            onChange={(e) => alternarAtrasados(e.target.checked)}
            className="h-4 w-4 rounded border-borda-forte"
          />
          Somente atrasados
        </label>

        {temFiltro && (
          <Botao variante="discreta" tamanho="sm" onClick={limparFiltros}>
            Limpar filtros
          </Botao>
        )}
      </div>

      {erro && (
        <Aviso tipo="erro" className="mb-4">
          {erro}
        </Aviso>
      )}

      <Regiao carregando={carregando}>
        {/* O esqueleto tem a forma dos cartões que vão chegar: "Carregando..."
            não dizia se vinha uma linha ou vinte, e a tela saltava quando o
            conteúdo entrava. */}
        {carregando && <Esqueleto linhas={4} altura="h-[4.5rem]" />}

        {!carregando && chamados.length === 0 && (
          <EstadoVazio
            titulo={
              buscaAplicada
                ? `Nenhum chamado encontrado para "${buscaAplicada}".`
                : 'Nenhum chamado encontrado.'
            }
            descricao={
              temFiltro
                ? 'Os filtros ativos podem estar estreitando demais o resultado.'
                : 'Quando alguém abrir um chamado, ele aparece aqui.'
            }
            acao={
              temFiltro ? (
                <Botao variante="secundaria" tamanho="sm" onClick={limparFiltros}>
                  Limpar filtros
                </Botao>
              ) : null
            }
          />
        )}

        {/* min-w-0 no cartão: item de grid não encolhe abaixo do próprio
            conteúdo por padrão, então um título longo — que o truncate deveria
            cortar — esticava a página inteira e dava rolagem horizontal no
            celular. */}
        {!carregando && chamados.length > 0 && (
          <ul className="grid gap-3">
            {chamados.map((c) => (
              <li key={c.id} className="min-w-0">
                <Link
                  to={`/chamados/${c.id}`}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-borda bg-superficie p-4 shadow-sm transition hover:border-borda-forte"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-navy">{c.titulo}</p>
                    {/* A prioridade não aparecia na lista: quem varre o painel
                        procurando o que atacar primeiro não tinha como saber
                        sem abrir chamado por chamado — justamente o dado que a
                        priorização do §2.5 existe para produzir. Fica à
                        esquerda, com o protocolo, para não disputar largura
                        com estado e atraso no celular. */}
                    <div className="mt-1 flex min-w-0 items-center gap-2">
                      <span className="truncate text-xs text-tinta-2">{c.protocolo}</span>
                      <BadgePrioridade prioridade={c.prioridade} />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {c.em_atraso && <BadgeAtraso />}
                    <BadgeEstado estado={c.estado} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Regiao>

      {paginacao.total > 0 && (
        <nav
          aria-label="Paginação dos chamados"
          className="mt-6 flex items-center justify-between gap-3 text-sm"
        >
          <span className="text-tinta-2">
            {primeiro}–{ultimo} de {paginacao.total}
          </span>
          <div className="flex items-center gap-2">
            <Botao
              variante="secundaria"
              tamanho="sm"
              onClick={() => setPagina((p) => p - 1)}
              disabled={paginacao.pagina <= 1 || carregando}
            >
              Anterior
            </Botao>
            <span className="text-tinta-2">
              {paginacao.pagina} / {paginacao.paginas}
            </span>
            <Botao
              variante="secundaria"
              tamanho="sm"
              onClick={() => setPagina((p) => p + 1)}
              disabled={paginacao.pagina >= paginacao.paginas || carregando}
            >
              Próxima
            </Botao>
          </div>
        </nav>
      )}
    </div>
  );
}

export default Dashboard;

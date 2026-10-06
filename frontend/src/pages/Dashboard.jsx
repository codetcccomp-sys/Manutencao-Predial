import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useEntrada } from '../animacao/useEntrada';
import NumeroAnimado from '../animacao/NumeroAnimado';
import CartaoDeChamado from '../components/chamados/CartaoDeChamado';
import { ESTADOS, ORDEM_ESTADOS } from '../dominio/rotulos';
import CabecalhoDePagina from '../components/ui/CabecalhoDePagina';
import Aviso from '../components/ui/Aviso';
import Botao from '../components/ui/Botao';
import { EstadoVazio, Esqueleto, Regiao } from '../components/ui/Estados';
import Icone from '../components/ui/Icone';

/**
 * A tela de quem distribui e cobra.
 *
 * É a lista completa, e continua sendo — gestão precisa do recorte livre, ao
 * contrário de quem pede e de quem executa. O que faltava era um começo: a
 * lista abria ordenada por data, e "o que chegou por último" não é a pergunta
 * de quem gerencia.
 *
 * Os três números no topo são as três perguntas, na ordem em que importam:
 *
 * 1. **Sem técnico** vem primeiro e é o mais grave, embora pareça o mais
 *    brando: é o único caso em que NINGUÉM está com o chamado. Um chamado
 *    atrasado com técnico designado tem alguém trabalhando nele; um chamado
 *    parado sem designação não se move, não reclama e não aparece — o relógio
 *    corre do mesmo jeito. Era, também, o único recorte que a API não sabia
 *    responder.
 * 2. **Atrasados** — o prazo já estourou.
 * 3. **Em aberto** — o tamanho da fila, para dar escala aos dois primeiros.
 *    Cinco atrasados em oito abertos é uma situação; em duzentos, é outra.
 *
 * Clicar aplica o filtro na lista abaixo em vez de abrir outra tela: o número
 * e a lista que ele resume ficam na mesma página, e voltar é desmarcar.
 */
function Dashboard() {
  const [chamados, setChamados] = useState([]);
  const [paginacao, setPaginacao] = useState({ pagina: 1, limite: 20, total: 0, paginas: 0 });
  const [estado, setEstado] = useState('');
  const [somenteAtrasados, setSomenteAtrasados] = useState(false);
  const [semTecnico, setSemTecnico] = useState(false);
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [resumo, setResumo] = useState(null);
  // Os indicadores entram quando o resumo chega e a lista quando os chamados chegam:
  // são duas requisições, e uma única animação reanimaria os indicadores a cada lista.
  const refResumo = useRef(null);
  const refLista = useRef(null);
  useEntrada(refResumo, [Boolean(resumo)]);
  useEntrada(refLista, [chamados, carregando]);

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
          ...(semTecnico ? { sem_tecnico: 'true' } : {}),
          ...(buscaAplicada ? { busca: buscaAplicada } : {}),
        },
      })
      .then(({ data }) => {
        setChamados(data.chamados);
        setPaginacao(data.paginacao);
      })
      .catch(() => setErro('Não foi possível carregar os chamados.'))
      .finally(() => setCarregando(false));
  }, [pagina, estado, somenteAtrasados, semTecnico, buscaAplicada]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  /**
   * Os três números do topo.
   *
   * Três consultas de uma linha cada, pedindo `limite=1` e lendo só o total da
   * paginação: a API já devolve a contagem do filtro junto com a página, então
   * não há endpoint novo nem varredura extra — a alternativa seria puxar todos
   * os chamados para contá-los no navegador.
   *
   * Roda uma vez ao abrir, e não a cada filtro: os números descrevem a
   * operação inteira, não o recorte visível. Se recalculassem junto com o
   * filtro, clicar em "Atrasados" faria o próprio cartão de atrasados passar a
   * contar apenas os atrasados — o número viraria o eco da seleção.
   */
  useEffect(() => {
    const contar = (params) =>
      api
        .get('/chamados', { params: { ...params, limite: 1 } })
        .then(({ data }) => data.paginacao.total)
        .catch(() => null);

    Promise.all([
      contar({ sem_tecnico: 'true' }),
      contar({ atrasados: 'true' }),
      // "Em aberto" não é o total da lista, que inclui concluídos. A primeira
      // versão lia `totais.em_aberto` de /relatorios/resumo — cinco consultas
      // de agregação, com JOIN, para aproveitar um número e jogar quatro fora.
      // Com `situacao=abertos` é a mesma contagem leve dos outros dois cartões.
      contar({ situacao: 'abertos' }),
    ]).then(([semDono, atrasados, emAberto]) => setResumo({ semDono, atrasados, emAberto }));
  }, []);

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
    setSemTecnico(false);
    setPagina(1);
  }

  // Clicar num cartão aplica aquele recorte e desliga os outros dois. Somar
  // "sem técnico" com "atrasados" devolveria a interseção — um conjunto menor
  // que os dois números mostrados —, e o cartão passaria a contradizer a
  // lista logo abaixo dele.
  function focar(recorte) {
    setEstado('');
    setSomenteAtrasados(recorte === 'atrasados');
    setSemTecnico(recorte === 'semDono');
    setPagina(1);
  }

  const temFiltro = Boolean(buscaAplicada || estado || somenteAtrasados || semTecnico);
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

      {resumo && (
        <div ref={refResumo} className="mb-4 grid gap-3 sm:grid-cols-3">
          {[
            {
              chave: 'semDono',
              rotulo: 'Sem técnico',
              valor: resumo.semDono,
              ajuda: 'Ninguém foi designado — ninguém pode agir',
              alerta: resumo.semDono > 0,
              ativo: semTecnico,
            },
            {
              chave: 'atrasados',
              rotulo: 'Atrasados',
              valor: resumo.atrasados,
              ajuda: 'O prazo já venceu',
              alerta: resumo.atrasados > 0,
              ativo: somenteAtrasados,
            },
            {
              chave: 'emAberto',
              rotulo: 'Em aberto',
              valor: resumo.emAberto,
              ajuda: 'O tamanho da fila, para dar escala aos dois',
              alerta: false,
              ativo: false,
            },
          ].map((cartao) => {
            // O terceiro é escala, não recorte: não há filtro "em aberto" na
            // listagem, e um cartão que parece clicável e não filtra nada é
            // pior que um cartão que não parece clicável.
            const clicavel = cartao.chave !== 'emAberto';
            const conteudo = (
              <>
                <span className="text-xs text-tinta-2">{cartao.rotulo}</span>
                <span
                  className={`text-2xl font-bold ${
                    cartao.alerta ? 'text-erro' : 'text-navy'
                  }`}
                >
                  {typeof cartao.valor === 'number' ? (
                  <NumeroAnimado valor={cartao.valor} />
                ) : (
                  (cartao.valor ?? '—')
                )}
                </span>
                <span className="text-xs text-tinta-2">{cartao.ajuda}</span>
              </>
            );

            const base =
              'flex flex-col gap-0.5 rounded-lg border bg-superficie p-4 text-left shadow-sm';

            return clicavel ? (
              <button
                key={cartao.chave}
                data-anim
                type="button"
                onClick={() => focar(cartao.ativo ? null : cartao.chave)}
                aria-pressed={cartao.ativo}
                className={`${base} transition-colors hover:border-navy ${
                  cartao.ativo ? 'border-navy ring-1 ring-navy' : 'border-borda'
                }`}
              >
                {conteudo}
              </button>
            ) : (
              <div key={cartao.chave} data-anim className={`${base} border-borda`}>
                {conteudo}
              </div>
            );
          })}
        </div>
      )}

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

      <Regiao carregando={carregando} refRegiao={refLista}>
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
        {/* O cartão saiu daqui para components/chamados/CartaoDeChamado: as
            três telas por perfil listam chamados, e o desenho copiado em três
            lugares diverge na primeira correção que entrar em só um deles. */}
        {!carregando && chamados.length > 0 && (
          <ul className="grid gap-3">
            {chamados.map((c) => (
              <CartaoDeChamado key={c.id} chamado={c} mostrarPrazo />
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

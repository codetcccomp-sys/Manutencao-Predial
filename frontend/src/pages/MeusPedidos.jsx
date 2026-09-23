import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import CabecalhoDePagina from '../components/ui/CabecalhoDePagina';
import Aviso from '../components/ui/Aviso';
import Botao from '../components/ui/Botao';
import { EstadoVazio, Esqueleto, Regiao } from '../components/ui/Estados';
import Icone from '../components/ui/Icone';
import CartaoDeChamado from '../components/chamados/CartaoDeChamado';
import { estadoEmPalavras } from '../dominio/prazo';

/**
 * A tela de quem pede.
 *
 * Antes desta separação, um solicitante abria o sistema e recebia a mesma tela
 * de quem distribui trabalho: um seletor com os sete estados do fluxo — onde
 * "em triagem" e "aguardando material" são vocabulário interno —, uma caixa
 * "somente atrasados" e paginação de vinte em vinte.
 *
 * Quem pede tem dois ou três chamados e uma pergunta só: **e aí, o que houve
 * com o que eu pedi?** Nada daquele maquinário respondia isso; ele codificava
 * a resposta num badge e deixava a tradução por conta de quem lesse.
 *
 * Três decisões, e o que cada uma deixou de fora:
 *
 * 1. **Não há filtro por estado.** Filtrar três itens por sete categorias é
 *    trabalho sem retorno. No lugar entra o recorte que a pessoa de fato faz:
 *    o que ainda está correndo e o que já terminou.
 * 2. **Não há "somente atrasados".** O atraso aparece no cartão quando existe,
 *    mas não vira filtro: é informação que o solicitante não pode acionar, e
 *    promovê-la a controle é oferecer um botão para a ansiedade.
 * 3. **Cada cartão diz o estado em português comum**, além do badge. O badge
 *    continua porque é o termo que a equipe da manutenção vai usar ao
 *    conversar, e reconhecer a palavra importa.
 *
 * O que ficou, e por quê: **a busca**. A primeira versão desta tela tirou a
 * caixa de busca junto com os filtros, sem decisão nenhuma — ela simplesmente
 * não foi copiada. Os testes de ponta a ponta do RF03 pegaram: quem anotou o
 * protocolo ao abrir o chamado e quer reencontrá-lo é justamente quem pede.
 * Filtro por categoria interna é ruído para o solicitante; busca pelo número
 * que ele mesmo recebeu não é.
 *
 * Buscando, as abas são ignoradas. Quem digita um protocolo quer achar o
 * chamado, e não achá-lo só se ele estiver na aba que por acaso está aberta —
 * um pedido encerrado sumiria da busca feita na aba "em andamento", e a tela
 * diria "nenhum chamado encontrado" para um chamado que existe.
 */

const RECORTES = [
  { chave: 'abertos', rotulo: 'Em andamento' },
  { chave: 'concluidos', rotulo: 'Encerrados' },
];

// O backend filtra por um estado de cada vez. "Em andamento" é tudo que não
// terminou, então o recorte é feito aqui, sobre a página recebida — e o
// limite é alto o bastante para que a conta feche para quem abre chamado.
const LIMITE = 100;

function MeusPedidos() {
  const [chamados, setChamados] = useState([]);
  const [recorte, setRecorte] = useState('abertos');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  // Mesma espera do painel da gestão: uma consulta por tecla faria a lista
  // piscar a cada letra do protocolo.
  useEffect(() => {
    const id = setTimeout(() => setBuscaAplicada(busca.trim()), 400);
    return () => clearTimeout(id);
  }, [busca]);

  const carregar = useCallback(() => {
    setCarregando(true);
    setErro('');
    api
      // A busca vai ao servidor, e não é feita sobre a lista já carregada:
      // quem pede há anos pode ter mais chamados do que cabem numa página, e
      // o protocolo procurado estaria justamente no que ficou de fora.
      .get('/chamados', {
        params: { limite: LIMITE, ...(buscaAplicada ? { busca: buscaAplicada } : {}) },
      })
      .then(({ data }) => setChamados(data.chamados))
      .catch(() => setErro('Não foi possível carregar seus chamados.'))
      .finally(() => setCarregando(false));
  }, [buscaAplicada]);

  useEffect(carregar, [carregar]);

  const buscando = Boolean(buscaAplicada);
  const encerrado = (c) => c.estado === 'concluido' || c.estado === 'cancelado';
  const visiveis = buscando
    ? chamados
    : chamados.filter((c) => (recorte === 'abertos' ? !encerrado(c) : encerrado(c)));
  const abertos = chamados.filter((c) => !encerrado(c)).length;

  return (
    <div className="grid gap-6">
      <CabecalhoDePagina
        titulo="Meus pedidos"
        acao={
          <Link
            to="/chamados/novo"
            className="alvo-toque inline-flex items-center justify-center gap-2 rounded bg-navy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-2"
          >
            + Abrir chamado
          </Link>
        }
      />

      <div className="relative">
        <label className="sr-only" htmlFor="busca-pedidos">
          Buscar
        </label>
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tinta-2">
          <Icone nome="busca" />
        </span>
        <input
          id="busca-pedidos"
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar pelo protocolo ou título"
          className="w-full min-w-0 rounded border border-borda-forte bg-superficie py-2 pl-9 pr-3 text-sm placeholder:text-tinta-2"
        />
      </div>

      {/* `tablist` e não botões soltos: o teclado percorre o grupo com as setas
          e o leitor de tela anuncia "aba 1 de 2", em vez de dois botões sem
          relação aparente. */}
      {!buscando && (
      <div role="tablist" aria-label="Situação dos pedidos" className="flex gap-2">
        {RECORTES.map(({ chave, rotulo }) => {
          const ativo = recorte === chave;
          return (
            <button
              key={chave}
              role="tab"
              aria-selected={ativo}
              onClick={() => setRecorte(chave)}
              className={`alvo-toque rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                ativo
                  ? 'bg-navy text-white'
                  : 'border border-borda-forte bg-superficie text-tinta-2 hover:border-navy'
              }`}
            >
              {rotulo}
              {chave === 'abertos' && abertos > 0 && ` (${abertos})`}
            </button>
          );
        })}
      </div>
      )}

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Regiao carregando={carregando}>
        {carregando && <Esqueleto linhas={3} altura="h-[5.5rem]" />}

        {!carregando && visiveis.length === 0 && buscando && (
          // Diz o que foi procurado: "nenhum encontrado" sem o termo deixa a
          // pessoa sem saber se digitou errado ou se o chamado não existe.
          <EstadoVazio
            titulo={`Nenhum chamado encontrado para "${buscaAplicada}".`}
            descricao="Confira o protocolo. Ele aparece no e-mail de confirmação e no topo da página do chamado."
            acao={
              <Botao variante="secundaria" tamanho="sm" onClick={() => setBusca('')}>
                Limpar busca
              </Botao>
            }
          />
        )}

        {!carregando && visiveis.length === 0 && !buscando && (
          <EstadoVazio
            titulo={
              recorte === 'abertos'
                ? 'Você não tem pedidos em andamento.'
                : 'Você ainda não tem pedidos encerrados.'
            }
            descricao={
              recorte === 'abertos'
                ? 'Quando algo precisar de conserto, abra um chamado e acompanhe por aqui.'
                : 'Os pedidos atendidos ou cancelados aparecem nesta aba.'
            }
            acao={
              recorte === 'abertos' ? (
                <Link to="/chamados/novo">
                  <Botao>Abrir chamado</Botao>
                </Link>
              ) : null
            }
          />
        )}

        {!carregando && visiveis.length > 0 && (
          <ul className="grid gap-3">
            {visiveis.map((c) => (
              <CartaoDeChamado
                key={c.id}
                chamado={c}
                linhaExtra={estadoEmPalavras(c.estado)}
              />
            ))}
          </ul>
        )}
      </Regiao>
    </div>
  );
}

export default MeusPedidos;

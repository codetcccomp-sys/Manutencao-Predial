import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import CabecalhoDePagina from '../components/ui/CabecalhoDePagina';
import Aviso from '../components/ui/Aviso';
import { EstadoVazio, Esqueleto, Regiao } from '../components/ui/Estados';
import CartaoDeChamado from '../components/chamados/CartaoDeChamado';

/**
 * A tela de quem executa.
 *
 * A lista antiga vinha ordenada por data de abertura, mais novo primeiro. Mas
 * a pergunta de um técnico com a tela aberta não é "o que chegou por último" —
 * é **o que eu faço agora**, e a resposta é o que está mais perto de estourar
 * o prazo. Esse costuma ser o chamado mais ANTIGO, ou seja, exatamente o
 * último da ordenação anterior: a informação certa estava no fim da página,
 * ou na página seguinte.
 *
 * Pior que a ordem era a mistura. O que está travado esperando material
 * aparecia entre o que podia ser atacado, com o mesmo peso visual. Quem varre
 * a lista precisa reler item a item para separar o que depende dele do que
 * depende de terceiro.
 *
 * Daí os três grupos, nesta ordem:
 *
 * 1. **Em execução** — o que já foi começado. Fica no topo porque trabalho
 *    aberto e esquecido é o desperdício mais caro: o tempo já foi gasto.
 * 2. **A fazer** — ordenado por prazo, o mais apertado primeiro.
 * 3. **Aguardando material** — separado embaixo. Continua visível, porque o
 *    material pode chegar e ninguém avisa, mas não disputa atenção com o que
 *    dá para fazer agora.
 *
 * O prazo aparece em palavras ("vence em 3 horas") e não como data: converter
 * carimbo em tempo restante era conta que o leitor fazia de cabeça, item por
 * item, e errava quando a data virava o dia.
 */

const GRUPOS = [
  {
    chave: 'execucao',
    titulo: 'Em execução',
    descricao: 'Você começou e ainda não encerrou.',
    estados: ['em_andamento'],
    vazio: 'Nada em execução no momento.',
  },
  {
    chave: 'afazer',
    titulo: 'A fazer',
    descricao: 'Do prazo mais apertado para o mais folgado.',
    estados: ['aberto', 'em_triagem', 'atribuido'],
    vazio: 'Nada esperando por você. Fila limpa.',
  },
  {
    chave: 'material',
    titulo: 'Aguardando material',
    descricao: 'Parados por falta de material — o prazo fica suspenso.',
    estados: ['aguardando_material'],
    vazio: null, // Sem pendência de material, o grupo some em vez de ocupar espaço.
  },
];

const LIMITE = 100;

function MinhaFila() {
  const [chamados, setChamados] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(() => {
    setCarregando(true);
    setErro('');
    api
      // `ordenar=prazo` é o ponto inteiro desta tela. Sem ele a página chega
      // na ordem errada e nenhum agrupamento daqui conserta, porque o que
      // ficou de fora da página não tem como ser reordenado no navegador.
      // `situacao=abertos` no servidor, e não o corte no navegador que havia
      // antes: ordenados por prazo, os encerrados (prazos mais antigos) vinham
      // primeiro e ocupavam a página de cem — com histórico longo, a fila
      // aparecia vazia com chamados em aberto designados.
      .get('/chamados', { params: { ordenar: 'prazo', situacao: 'abertos', limite: LIMITE } })
      .then(({ data }) => setChamados(data.chamados))
      .catch(() => setErro('Não foi possível carregar sua fila.'))
      .finally(() => setCarregando(false));
  }, []);

  useEffect(carregar, [carregar]);

  const abertos = chamados.filter((c) => c.estado !== 'concluido' && c.estado !== 'cancelado');
  const porGrupo = GRUPOS.map((grupo) => ({
    ...grupo,
    itens: abertos.filter((c) => grupo.estados.includes(c.estado)),
  }));

  const vazia = abertos.length === 0;

  return (
    <div className="grid gap-6">
      <CabecalhoDePagina
        titulo="Minha fila"
        descricao={
          vazia || carregando
            ? undefined
            : `${abertos.length} ${abertos.length === 1 ? 'chamado' : 'chamados'} com você.`
        }
      />

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Regiao carregando={carregando}>
        {carregando && <Esqueleto linhas={4} altura="h-[5.5rem]" />}

        {!carregando && vazia && (
          <EstadoVazio
            titulo="Nenhum chamado designado a você."
            descricao="Quando a gestão designar um chamado, ele aparece aqui, com o prazo mais apertado no topo."
          />
        )}

        {!carregando && !vazia && (
          <div className="grid gap-8">
            {porGrupo.map((grupo) => {
              // Grupo sem itens e sem texto de vazio não vira seção nenhuma:
              // três cabeçalhos onde há uma lista só transformam a tela em
              // índice de si mesma.
              if (grupo.itens.length === 0 && !grupo.vazio) return null;

              return (
                <section key={grupo.chave}>
                  <div className="mb-3">
                    <h2 className="font-medium text-navy">
                      {grupo.titulo}
                      {grupo.itens.length > 0 && (
                        <span className="ml-2 text-sm font-normal text-tinta-2">
                          {grupo.itens.length}
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-tinta-2">{grupo.descricao}</p>
                  </div>

                  {grupo.itens.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-borda p-4 text-sm text-tinta-2">
                      {grupo.vazio}
                    </p>
                  ) : (
                    <ul className="grid gap-3">
                      {grupo.itens.map((c) => (
                        <CartaoDeChamado
                          key={c.id}
                          chamado={c}
                          // O prazo não aparece no grupo de material: ali ele
                          // está suspenso, e mostrar contagem regressiva de um
                          // relógio parado seria apressar quem não pode agir.
                          mostrarPrazo={grupo.chave !== 'material'}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </Regiao>
    </div>
  );
}

export default MinhaFila;

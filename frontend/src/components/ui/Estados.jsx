import Icone from './Icone';

/**
 * Estado vazio e estado de carregamento.
 *
 * O sistema tinha doze variações de `<p class="text-sm text-gray-500">Nenhum
 * ...</p>` e cinco de `<p>Carregando...</p>`. Nenhuma das duas dizia à pessoa
 * o que fazer a seguir nem quanto conteúdo esperar.
 */

/**
 * Nada encontrado — e o que dá para fazer sobre isso.
 *
 * "Nenhum chamado encontrado" respondido sozinho deixa a pessoa parada. A
 * distinção entre "não há nada ainda" e "o filtro não achou nada" importa: no
 * primeiro caso a saída é criar, no segundo é limpar o filtro.
 */
export function EstadoVazio({ icone = 'busca', titulo, descricao, acao, className = '' }) {
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-lg border border-dashed border-borda-forte px-6 py-10 text-center ${className}`}
    >
      <Icone nome={icone} classe="h-6 w-6 text-tinta-2" />
      <p className="font-medium text-tinta">{titulo}</p>
      {descricao && <p className="text-sm text-tinta-2 max-w-sm">{descricao}</p>}
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  );
}

/**
 * Esqueleto de carregamento.
 *
 * Tem a forma do que vai chegar, e essa é a razão de existir: "Carregando..."
 * não diz se vem uma linha ou trinta, e a tela salta quando o conteúdo entra.
 * Com o esqueleto no formato certo, o layout já está montado quando os dados
 * chegam.
 *
 * A animação some sozinha para quem pediu menos movimento — a regra global de
 * prefers-reduced-motion em index.css cobre isto.
 */
export function Esqueleto({ linhas = 3, altura = 'h-20', className = '' }) {
  return (
    <div
      className={`grid gap-3 ${className}`}
      // Quem usa leitor de tela não ganha nada ouvindo a descrição de um
      // retângulo cinza: o aviso de carregamento é dado por quem chama, com
      // aria-busy na região.
      aria-hidden="true"
    >
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className={`${altura} animate-pulse rounded-lg bg-borda/60`} />
      ))}
    </div>
  );
}

/**
 * Região que troca "carregando" por conteúdo sem sumir do leitor de tela.
 *
 * `aria-busy` diz que a região está sendo preenchida; o texto reservado só
 * para leitor de tela é o que anuncia o carregamento, já que o esqueleto é
 * puramente visual.
 */
export function Regiao({ carregando, rotuloCarregando = 'Carregando...', children, refRegiao }) {
  return (
    <div ref={refRegiao} aria-busy={carregando || undefined}>
      {carregando && <p className="sr-only">{rotuloCarregando}</p>}
      {children}
    </div>
  );
}

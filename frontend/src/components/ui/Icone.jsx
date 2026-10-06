/**
 * Ícones, em SVG dentro do próprio arquivo.
 *
 * Uma biblioteca de ícones (lucide-react, heroicons) resolveria isto com uma
 * dependência. Para os poucos símbolos que o sistema usa, não compensa: o
 * projeto inteiro tem quatro dependências de runtime, e o que se ganharia em
 * conveniência se pagaria em peso e em mais uma coisa para manter atualizada.
 *
 * Todos herdam `currentColor` e o tamanho vem da classe — quem usa o ícone
 * controla os dois pelo texto em volta, sem props de cor.
 */

const CAMINHOS = {
  // Estados do chamado
  circulo: <circle cx="12" cy="12" r="8" />,
  funil: <path d="M4 5h16l-6 7v6l-4 2v-8L4 5z" />,
  pessoa: <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM5 20a7 7 0 0114 0" />,
  chave: <path d="M14.5 6.5a4 4 0 105.2 5.2L21 11l-8 8-2 2-3-3 2-2 8-8-1.3-1.3z" />,
  caixa: <path d="M4 8l8-4 8 4v8l-8 4-8-4V8zM4 8l8 4m0 0l8-4m-8 4v8" />,
  check: <path d="M4 12.5l5 5L20 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,

  // Uso geral
  alerta: <path d="M12 3l9 16H3l9-16zM12 9v5M12 17.5v.5" />,
  info: <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5v.5" />,
  relogio: <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2" />,
  local: <path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />,
  busca: <path d="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3" />,
  sino: <path d="M18 16V11a6 6 0 10-12 0v5l-2 3h16l-2-3zM10 22h4" />,
  painel: <path d="M4 5h16v14H4V5zM14.5 5v14" />,
};

/**
 * @param {string} nome    chave em CAMINHOS
 * @param {string} classe  tamanho e cor, via utilitários
 */
function Icone({ nome, classe = 'h-4 w-4' }) {
  const desenho = CAMINHOS[nome];
  if (!desenho) return null;

  return (
    <svg
      className={`shrink-0 ${classe}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorativo por definição: o significado está sempre no texto ao lado.
      // Sem isto, o leitor de tela anunciaria "imagem" antes de cada rótulo.
      aria-hidden="true"
      focusable="false"
    >
      {desenho}
    </svg>
  );
}

/**
 * Escada de barras para prioridade: uma barra para baixa, quatro para crítica.
 *
 * A quantidade carrega a informação sem depender de cor e sem depender do
 * texto — e mantém a ordem legível num badge pequeno, o que um símbolo
 * (chama, exclamação) não faria: "chama" não diz se é mais ou menos que
 * "exclamação".
 */
export function BarrasDePrioridade({ nivel, classe = 'h-4 w-4' }) {
  return (
    <svg
      className={`shrink-0 ${classe}`}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={1 + i * 4}
          y={13 - (i + 1) * 3}
          width="2.5"
          height={(i + 1) * 3}
          rx="0.75"
          fill="currentColor"
          // As barras acima do nível ficam esmaecidas em vez de sumirem: a
          // escala inteira continua visível, então dá para ver que "alta" é
          // três de quatro, e não três de três.
          opacity={i < nivel ? 1 : 0.25}
        />
      ))}
    </svg>
  );
}

export default Icone;

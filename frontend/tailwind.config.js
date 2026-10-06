/**
 * Tokens do sistema.
 *
 * Todo valor de cor aqui foi medido contra o fundo em que é usado, e nenhum
 * par de texto fica abaixo de 4,5:1 (WCAG 2.1 AA para texto normal). Os
 * comentários trazem a razão medida porque é o que impede a próxima pessoa de
 * "só escurecer um pouquinho" e derrubar o contraste sem perceber.
 *
 * As cores são declaradas como variáveis CSS em index.css e referenciadas aqui
 * em canais, dentro de `rgb(... / <alpha-value>)`: é o que permite trocar um
 * token em um lugar só E manter funcionando os modificadores de opacidade
 * (`bg-amber/20`) que as telas já usam. É também o vocabulário do ecossistema
 * Tailwind/shadcn, então importar um tema de fora um dia fica viável.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // --- Marca -------------------------------------------------------
        // 11,62:1 com branco por cima. É a ação primária e o título.
        navy: 'rgb(var(--cor-navy) / <alpha-value>)',
        'navy-2': 'rgb(var(--cor-navy-2) / <alpha-value>)',

        /**
         * O âmbar era um token só, usado sobre branco E sobre o navy do
         * cabeçalho. Nenhum valor serve aos dois: escurecer até passar no
         * branco (6,33:1) derruba o contraste sobre o navy para 1,84:1, e
         * clarear faz o contrário. Por isso agora são dois.
         *
         * `amber` é para superfície clara; `amber-claro`, para superfície
         * escura. Quem usar o errado vai ver — a diferença é grande.
         */
        amber: 'rgb(var(--cor-ambar) / <alpha-value>)', // 6,33:1 sobre branco · 5,85:1 sobre o fundo
        'amber-claro': 'rgb(var(--cor-ambar-claro) / <alpha-value>)', // 6,54:1 sobre o navy

        // --- Superfícies e texto ----------------------------------------
        fundo: 'rgb(var(--cor-fundo) / <alpha-value>)',
        superficie: 'rgb(var(--cor-superficie) / <alpha-value>)',
        'superficie-2': 'rgb(var(--cor-superficie-2) / <alpha-value>)',
        borda: 'rgb(var(--cor-borda) / <alpha-value>)',
        'borda-forte': 'rgb(var(--cor-borda-forte) / <alpha-value>)',
        tinta: 'rgb(var(--cor-tinta) / <alpha-value>)', // 14,45:1 sobre cartão
        'tinta-2': 'rgb(var(--cor-tinta-2) / <alpha-value>)', // 6,13:1 sobre cartão — texto auxiliar
        'tinta-clara': 'rgb(var(--cor-tinta-clara) / <alpha-value>)', // 9,89:1 sobre o navy

        // --- Semânticos --------------------------------------------------
        // Cada um com a tinta clara correspondente para fundo de faixa e badge.
        erro: 'rgb(var(--cor-erro) / <alpha-value>)', // 6,57:1 sobre branco
        'erro-tenue': 'rgb(var(--cor-erro-tenue) / <alpha-value>)',
        sucesso: 'rgb(var(--cor-sucesso) / <alpha-value>)', // 6,51:1 sobre branco
        'sucesso-tenue': 'rgb(var(--cor-sucesso-tenue) / <alpha-value>)',
        atencao: 'rgb(var(--cor-atencao) / <alpha-value>)', // 6,33:1 sobre branco
        'atencao-tenue': 'rgb(var(--cor-atencao-tenue) / <alpha-value>)',
        info: 'rgb(var(--cor-info) / <alpha-value>)', // 6,70:1 sobre branco
        'info-tenue': 'rgb(var(--cor-info-tenue) / <alpha-value>)',
        neutro: 'rgb(var(--cor-neutro) / <alpha-value>)',
        'neutro-tenue': 'rgb(var(--cor-neutro-tenue) / <alpha-value>)',
        andamento: 'rgb(var(--cor-andamento) / <alpha-value>)', // 4,64:1 sobre a própria tinta
        'andamento-tenue': 'rgb(var(--cor-andamento-tenue) / <alpha-value>)',
      },

      // Pilha do sistema, sem fonte remota: a tela precisa abrir rápido num
      // celular de obra, e uma fonte externa adia o primeiro texto legível.
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },

      // Escala curta de propósito: três raios cobrem tudo. Antes `rounded` e
      // `rounded-lg` se alternavam sem critério.
      borderRadius: {
        DEFAULT: '0.25rem', // controles
        md: '0.375rem',
        lg: '0.5rem', // cartões
      },

      // Duas sombras, e só. Cartão não é objeto flutuante; o que separa um
      // cartão do fundo é a borda, não a sombra.
      boxShadow: {
        sm: '0 1px 2px 0 rgb(22 41 75 / 0.05)',
        md: '0 4px 12px -2px rgb(22 41 75 / 0.10)',
        none: 'none',
      },

      /**
       * Movimento. Todas usam `backwards`, nunca `both`/`forwards`: o quadro final
       * ficaria aplicado depois do fim, e um `filter` ou `transform` residual
       * cria um bloco de contenção novo — `position: fixed` (o painel de avisos,
       * os modais) passaria a se ancorar no elemento animado em vez da janela.
       * A regra de prefers-reduced-motion em index.css zera a duração de todas.
       */
      keyframes: {
        'pagina-in': {
          from: { opacity: '0', transform: 'translateY(10px)', filter: 'blur(6px)' },
          to: { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
        },
        'fundo-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'modal-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.96)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'aviso-in': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pagina-in': 'pagina-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards',
        'fundo-in': 'fundo-in 0.2s ease-out backwards',
        'modal-in': 'modal-in 0.25s cubic-bezier(0.22, 1, 0.36, 1) backwards',
        'aviso-in': 'aviso-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) backwards',
      },

      // Altura mínima de alvo tocável (WCAG 2.5.8 pede 24px; 44px é o
      // confortável em campo, com luva).
      minHeight: {
        toque: '2.75rem',
      },
      minWidth: {
        toque: '2.75rem',
      },
    },
  },
  plugins: [],
};

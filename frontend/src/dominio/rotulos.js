/**
 * Estado e prioridade do chamado: nome, forma e cor, num lugar só.
 *
 * Antes isto estava espalhado: ESTADO_LABEL aparecia em Dashboard.jsx,
 * ChamadoDetalhe.jsx e Relatorios.jsx, e PRIORIDADE_LABEL em dois deles — com
 * ordens diferentes entre si. Pior que a repetição era a divergência de
 * desenho: o painel mostrava estado como badge colorido, o detalhe como texto
 * em negrito e o relatório como rótulo de barra. O mesmo campo, três idiomas,
 * conforme a tela.
 *
 * Duas regras que este módulo existe para garantir:
 *
 * 1. COR NUNCA É O ÚNICO CANAL. Cada estado tem ícone e texto além da cor.
 *    Quem não distingue as cores lê o rótulo e reconhece a forma; quem imprime
 *    em preto e branco também.
 *
 * 2. ESTADOS DIFERENTES SÃO DISTINGUÍVEIS. `atribuido` e `em_andamento` usavam
 *    o mesmo par de cor — literalmente indistinguíveis, mesmo para quem enxerga
 *    cor perfeitamente. Aqui triagem e aguardando material compartilham o âmbar
 *    de propósito (ambos são espera), mas ícone e texto os separam; nenhum
 *    outro par repete cor.
 */

/**
 * A ordem é a do fluxo do §2.4 do Termo de Abertura, não alfabética: quem lê
 * um seletor de estado está percorrendo o caminho do chamado.
 */
export const ESTADOS = {
  aberto: {
    rotulo: 'Aberto',
    icone: 'circulo',
    cor: 'bg-neutro-tenue text-neutro',
  },
  em_triagem: {
    rotulo: 'Em triagem',
    icone: 'funil',
    cor: 'bg-atencao-tenue text-atencao',
  },
  atribuido: {
    rotulo: 'Atribuído',
    icone: 'pessoa',
    cor: 'bg-info-tenue text-info',
  },
  em_andamento: {
    rotulo: 'Em andamento',
    icone: 'chave',
    cor: 'bg-andamento-tenue text-andamento',
  },
  aguardando_material: {
    rotulo: 'Aguardando material',
    icone: 'caixa',
    cor: 'bg-atencao-tenue text-atencao',
  },
  concluido: {
    rotulo: 'Concluído',
    icone: 'check',
    cor: 'bg-sucesso-tenue text-sucesso',
  },
  cancelado: {
    rotulo: 'Cancelado',
    icone: 'x',
    cor: 'bg-erro-tenue text-erro',
  },
};

/**
 * Prioridade em ordem crescente de gravidade.
 *
 * O ícone é uma escada de barras — uma para baixa, quatro para crítica. A
 * quantidade de barras carrega a informação sozinha: não depende de cor, e
 * mantém a ordem legível mesmo num badge minúsculo, o que um ícone simbólico
 * (chama, exclamação) não faria.
 */
export const PRIORIDADES = {
  baixa: { rotulo: 'Baixa', nivel: 1, cor: 'bg-neutro-tenue text-neutro' },
  media: { rotulo: 'Média', nivel: 2, cor: 'bg-info-tenue text-info' },
  alta: { rotulo: 'Alta', nivel: 3, cor: 'bg-atencao-tenue text-atencao' },
  critica: { rotulo: 'Crítica', nivel: 4, cor: 'bg-erro-tenue text-erro' },
};

/** Chaves na ordem de declaração, para seletores e listas. */
export const ORDEM_ESTADOS = Object.keys(ESTADOS);
export const ORDEM_PRIORIDADES = Object.keys(PRIORIDADES);

/**
 * Nome legível, com recuo seguro.
 *
 * Se o backend passar a devolver um estado que o front ainda não conhece, a
 * tela mostra a chave crua em vez de vazio — feio, mas diagnosticável. Um
 * espaço em branco no lugar do estado seria pior: ninguém sabe se o chamado
 * está sem estado ou se a tela está quebrada.
 */
export function rotuloEstado(estado) {
  return ESTADOS[estado]?.rotulo ?? estado;
}

export function rotuloPrioridade(prioridade) {
  return PRIORIDADES[prioridade]?.rotulo ?? prioridade;
}

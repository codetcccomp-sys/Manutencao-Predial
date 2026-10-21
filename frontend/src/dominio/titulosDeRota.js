import { matchPath } from 'react-router';

export const NOME_DO_SISTEMA = 'Conserva Predial';

/**
 * O título de cada tela, na ordem em que as rotas de `App.jsx` são conferidas.
 *
 * O `<title>` era um só para o sistema inteiro. Quem usa leitor de tela ouve o
 * título ao chegar numa página e é por ele que reconhece, na lista de abas e no
 * histórico, onde está; com o mesmo texto em todas as telas, a troca de rota
 * passava em silêncio (WCAG 2.4.2). "Novo chamado" vem antes de "Chamado" porque
 * `/chamados/:id` também casaria com `/chamados/novo`.
 */
export const TITULOS = [
  ['/login', 'Entrar'],
  ['/cadastro', 'Cadastro'],
  ['/recuperar-senha', 'Recuperar senha'],
  ['/redefinir-senha', 'Redefinir senha'],
  ['/privacidade', 'Privacidade'],
  ['/', 'Início'],
  ['/chamados/novo', 'Novo chamado'],
  ['/chamados/:id', 'Chamado'],
  ['/relatorios', 'Relatórios'],
  ['/usuarios', 'Usuários'],
  ['/cadastros', 'Cadastros'],
  ['/preventiva', 'Preventiva'],
  ['/equipamentos/:id', 'Equipamento'],
  ['/etiquetas', 'Etiquetas'],
  ['/conta', 'Minha conta'],
];

/** "Relatórios — Conserva Predial"; rota desconhecida fica só com o nome do sistema. */
export function tituloDaRota(pathname) {
  const achada = TITULOS.find(([caminho]) => matchPath({ path: caminho, end: true }, pathname));
  return achada ? `${achada[1]} — ${NOME_DO_SISTEMA}` : NOME_DO_SISTEMA;
}

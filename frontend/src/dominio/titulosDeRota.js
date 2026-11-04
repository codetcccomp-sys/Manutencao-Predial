import { matchPath } from 'react-router';

export const NOME_DO_SISTEMA = 'Conserva Predial';

/**
 * O título e a descrição de cada tela, na ordem em que as rotas de `App.jsx` são conferidas.
 *
 * O `<title>` era um só para o sistema inteiro. Quem usa leitor de tela ouve o
 * título ao chegar numa página e é por ele que reconhece, na lista de abas e no
 * histórico, onde está; com o mesmo texto em todas as telas, a troca de rota
 * passava em silêncio (WCAG 2.4.2). "Novo chamado" vem antes de "Chamado" porque
 * `/chamados/:id` também casaria com `/chamados/novo`.
 *
 * A descrição (`<meta name="description">`) vai pelo mesmo caminho. As telas
 * internas dizem só que são de acesso restrito: o que elas mostram é dado da
 * instituição, e nem a descrição de uma aba que um mecanismo de busca por acaso
 * leia deve antecipá-lo. Nenhuma tela é indexada (`noindex` no `index.html` e no
 * cabeçalho `X-Robots-Tag`, em `vercel.json`): a descrição serve a quem
 * compartilha o endereço e aos leitores de tela.
 */
const RESTRITA = 'Área restrita do Conserva Predial, para usuários autenticados.';

export const TITULOS = [
  ['/login', 'Entrar', 'Entre no Conserva Predial para abrir e acompanhar pedidos de manutenção predial.'],
  ['/cadastro', 'Cadastro', 'Crie uma conta no Conserva Predial para abrir e acompanhar pedidos de manutenção predial.'],
  ['/recuperar-senha', 'Recuperar senha', 'Peça um link para criar uma nova senha de acesso ao Conserva Predial.'],
  ['/redefinir-senha', 'Redefinir senha', 'Crie uma nova senha de acesso ao Conserva Predial.'],
  ['/privacidade', 'Privacidade', 'Quais dados pessoais o Conserva Predial guarda, para quê, por quanto tempo e como pedir acesso, correção ou remoção.'],
  ['/termos', 'Termos de uso', 'Condições para usar o Conserva Predial: para que serve, o que se espera de quem usa e o que o sistema não promete.'],
  ['/cookies', 'Cookies e armazenamento', 'O que o Conserva Predial guarda no seu aparelho (cookies e armazenamento do navegador), para quê e como apagar.'],
  ['/suporte', 'Ajuda e suporte', 'Como relatar um problema técnico ou pedir ajuda para usar o Conserva Predial.'],
  ['/', 'Início', RESTRITA],
  ['/chamados/novo', 'Novo chamado', RESTRITA],
  ['/chamados/:id', 'Chamado', RESTRITA],
  ['/relatorios', 'Relatórios', RESTRITA],
  ['/usuarios', 'Usuários', RESTRITA],
  ['/cadastros', 'Cadastros', RESTRITA],
  ['/preventiva', 'Preventiva', RESTRITA],
  ['/equipamentos/:id', 'Equipamento', RESTRITA],
  ['/etiquetas', 'Etiquetas', RESTRITA],
  ['/conta', 'Minha conta', RESTRITA],
];

const NAO_ENCONTRADA = ['Página não encontrada', 'O endereço que você abriu não existe ou foi movido.'];

function achar(pathname) {
  return TITULOS.find(([caminho]) => matchPath({ path: caminho, end: true }, pathname));
}

/** "Relatórios — Conserva Predial"; endereço que não existe é a página "não encontrada". */
export function tituloDaRota(pathname) {
  const achada = achar(pathname);
  return `${achada ? achada[1] : NAO_ENCONTRADA[0]} — ${NOME_DO_SISTEMA}`;
}

/**
 * O MODELO da rota (`/chamados/:id`), ou `outra` para o que não existe. É o que a telemetria registra
 * no lugar do caminho: o endereço real de um chamado ou de um equipamento carrega o identificador dele.
 */
export function padraoDaRota(pathname) {
  return achar(pathname)?.[0] ?? 'outra';
}

/** O texto de `<meta name="description">` da rota. */
export function descricaoDaRota(pathname) {
  const achada = achar(pathname);
  return achada ? achada[2] : NAO_ENCONTRADA[1];
}

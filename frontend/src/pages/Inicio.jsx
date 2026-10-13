import { lazy } from 'react';
import { useAuth } from '../context/AuthContext';
import MeusPedidos from './MeusPedidos';
import MinhaFila from './MinhaFila';

// O painel é só da gestão: quem pede e quem executa não precisa do código dele
// (nem dos gráficos) para ver a própria tela. O Suspense está no Layout.
const Dashboard = lazy(() => import('./Dashboard'));

/**
 * Qual tela inicial cada perfil recebe.
 *
 * Até aqui os quatro perfis caíam na mesma lista de chamados — a mesma ordem,
 * os mesmos filtros, o mesmo vocabulário. O backend já entregava dados
 * diferentes para cada um (solicitante só vê o que abriu, técnico só o que
 * lhe foi designado), mas a tela tratava os três como a mesma pessoa fazendo
 * a mesma pergunta, e eles fazem perguntas diferentes:
 *
 *   quem pede      → "e aí, o que houve com o que eu pedi?"
 *   quem executa   → "o que eu faço agora?"
 *   quem distribui → "onde está o problema?"
 *
 * A separação é de COMPOSIÇÃO, não de permissão. Nenhuma destas telas concede
 * acesso a nada: quem decide o que cada perfil pode ver é o backend, e ele
 * continua decidindo igual. Se um técnico chegasse à tela da gestão, receberia
 * dela exatamente os chamados que já recebe — a diferença seria de arranjo,
 * não de alcance. Segurança que dependesse deste arquivo seria segurança na
 * tela, que é o mesmo que nenhuma.
 *
 * O perfil desconhecido cai na tela de quem pede, e não numa tela de erro: é a
 * mais restrita das três e a que não pressupõe papel nenhum. Um perfil novo
 * mal cadastrado deve ver de menos, nunca de mais.
 */
function Inicio() {
  const { usuario } = useAuth();

  if (usuario?.perfil === 'tecnico') return <MinhaFila />;
  if (usuario?.perfil === 'gestor' || usuario?.perfil === 'administrador') return <Dashboard />;
  return <MeusPedidos />;
}

export default Inicio;

import Aviso from '../components/ui/Aviso';
import PaginaDeTexto, { LINK, LISTA, Secao } from '../components/ui/PaginaDeTexto';
import { CONTATO } from '../dominio/contato';

/**
 * Aviso de privacidade: o que o sistema guarda sobre a pessoa, para quê, por
 * quanto tempo e como pedir a remoção.
 *
 * É pública (fica fora do login) porque o aviso precisa estar ao alcance de
 * quem ainda vai se cadastrar, e porque é no cadastro e na tela de entrada
 * que ele é apontado.
 *
 * O texto descreve o que o sistema FAZ, conferido no código e nas tabelas, e
 * por isso é parente próximo de docs/lgpd.md: quem muda um muda o outro. Três
 * coisas estão ditas de propósito e não devem ser "melhoradas" sem que a
 * realidade mude antes:
 *
 * - Não há controlador nomeado. A instituição ainda não foi definida
 *   (docs/lgpd.md, seção 4), e inventar um nome seria pior que a lacuna.
 * - Não há base legal citada. Ela depende de a instituição ser pública ou
 *   privada, e escolher errado é pior que não escolher.
 * - Os prazos de 5 e 2 anos aparecem como PREVISTOS. O sistema não apaga nem
 *   anonimiza nada sozinho além do que está listado em "Por quanto tempo".
 */

const ATUALIZADO_EM = '4 de novembro de 2026';

function Privacidade() {
  return (
    <PaginaDeTexto
      titulo="Aviso de privacidade"
      atual="/privacidade"
      introducao={`Este aviso explica quais dados pessoais o Conserva Predial guarda, para quê, por quanto tempo e como você pode pedir a remoção. Atualizado em ${ATUALIZADO_EM}.`}
    >
      <Aviso tipo="info">
        O Conserva Predial é um projeto de conclusão de curso, em fase de piloto. A instituição que
        atuará como controladora dos dados ainda não foi formalizada; quando for, o nome dela passa a
        constar aqui.
      </Aviso>

      <Secao titulo="Que dados guardamos">
        <ul className={LISTA}>
          <li>
            <strong>Sua conta:</strong> nome, e-mail, perfil de acesso e a data em que foi criada. A
            senha não é guardada: fica só uma versão embaralhada, que não permite descobri-la.
          </li>
          <li>
            <strong>Seus chamados:</strong> o que você escrever (título, descrição e comentários), as
            fotos e os arquivos que anexar, quem mudou o estado de cada chamado e quando, e a nota e o
            comentário da avaliação. Uma foto pode mostrar pessoas que estavam por perto; evite
            enquadrá-las.
          </li>
          <li>
            <strong>Tentativas de entrar:</strong> o e-mail e o endereço de rede (IP) de cada
            tentativa, inclusive de quem errou a senha, para barrar quem tenta adivinhá-la. No pedido
            de troca de senha, também o IP. Em cada pedido de cadastro, só o IP (sem o e-mail), para
            barrar cadastros em massa.
          </li>
          <li>
            <strong>Erros do sistema:</strong> quando algo falha por defeito nosso, no servidor ou na
            sua tela, guardamos a rota, o código e a mensagem técnica do erro, sem nome, e-mail nem IP,
            para corrigir o defeito.
          </li>
          <li>
            <strong>Uso e desempenho:</strong> contadores por dia de quantas vezes cada tela abre, de
            quais ações são feitas e de quanto a página leva para carregar. São números, sem o seu nome,
            sem IP e sem cookie: não dá para saber quem fez o quê. Se você ligou “Não rastrear” no
            navegador, nada disso é medido.
          </li>
          <li>
            <strong>Verificação em duas etapas, se você ligar:</strong> a chave do aplicativo
            autenticador e os códigos de recuperação (estes, embaralhados).
          </li>
          <li>
            <strong>Entrar com o Google:</strong> usamos só o nome e o e-mail que o Google informa,
            para achar ou criar a sua conta. Não guardamos foto, credencial nem token de acesso do
            Google. O botão carrega um componente do Google na tela de entrada.
          </li>
        </ul>
        <p>
          Não pedimos documento, telefone nem endereço residencial, e não coletamos dado sensível. Mas
          o que você escreve num chamado é texto livre: não inclua informação pessoal que não seja
          necessária para o conserto.
        </p>
      </Secao>

      <Secao titulo="Para que usamos">
        <p>
          Para receber, distribuir e acompanhar pedidos de manutenção: saber quem pediu, avisar você
          sobre o andamento e saber quem atendeu. Também usamos os registros para medir o atendimento
          (prazos, tempos e volume de chamados), que é o objetivo do projeto. Não usamos seus dados
          para publicidade nem para traçar o perfil de quem abre chamados.
        </p>
      </Secao>

      <Secao titulo="Quem pode ver">
        <p>
          Quem pede vê só os chamados que abriu. O técnico vê só os chamados designados a ele. A gestão
          e a administração veem todos os chamados, os relatórios e os cadastros.
        </p>
      </Secao>

      <Secao titulo="Onde os dados ficam">
        <p>
          O banco de dados fica em São Paulo (Supabase). O aplicativo é hospedado na Vercel, e os
          servidores que executam o sistema também ficam em São Paulo. Os e-mails de aviso e de troca
          de senha saem por uma conta do Gmail. Fora esses serviços, não enviamos seus dados a
          terceiros.
        </p>
      </Secao>

      <Secao titulo="Por quanto tempo">
        <ul className={LISTA}>
          <li>Tentativas de entrar e pedidos de cadastro (o IP): apagadas em 24 horas. Pedidos de troca de senha: em 7 dias.</li>
          <li>Pedido de cadastro recusado: apagado na hora da recusa.</li>
          <li>Erros técnicos do sistema: apagados em 30 dias. Contadores de uso e desempenho: em 90 dias.</li>
          <li>
            Contas e chamados (com histórico, comentários, fotos e avaliações): ficam guardados. O
            projeto prevê guardar os chamados por 5 anos depois de concluídos e anonimizar as contas 2
            anos depois do desligamento, mas o sistema ainda não faz isso sozinho.
          </li>
        </ul>
      </Secao>

      <Secao titulo="Seus direitos">
        <p>
          Você pode pedir acesso aos seus dados, correção ou a remoção da sua conta, escrevendo para{' '}
          <a href={`mailto:${CONTATO}`} className={`${LINK} break-all`}>
            {CONTATO}
          </a>
          .
        </p>
        <p>
          A remoção é feita por anonimização: seu nome vira “Usuário removido”, seu e-mail e sua senha
          deixam de existir, o acesso é encerrado e seus avisos e tentativas de entrada são apagados.
          Os chamados continuam registrados, sem o seu nome, porque são o registro da manutenção do
          prédio. Se outra pessoa citou seu nome no texto de um comentário, esse trecho precisa ser
          revisado à mão.
        </p>
      </Secao>

      <Secao titulo="Segurança">
        <p>
          O acesso é por perfil, a senha é guardada embaralhada e a conexão com o banco é protegida e
          verificada. Se houver um vazamento que afete você, avisamos as pessoas atingidas.
        </p>
      </Secao>
    </PaginaDeTexto>
  );
}

export default Privacidade;

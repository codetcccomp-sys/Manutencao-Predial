import Aviso from '../components/ui/Aviso';
import PaginaDeTexto, { LISTA, LINK, Secao } from '../components/ui/PaginaDeTexto';
import { Link } from 'react-router';

/**
 * Termos de uso: o que o sistema é, quem o usa, o que se espera de cada pessoa
 * e o que ele NÃO promete.
 *
 * Como o aviso de privacidade, este texto descreve o projeto como ele é, e não
 * como gostaríamos que fosse. Três coisas estão ditas de propósito:
 *
 * - Não há instituição nomeada. Ela ainda não foi formalizada (docs/lgpd.md,
 *   seção 4); quando for, o nome entra aqui e nos termos que ela aprovar.
 * - Não há foro, multa nem cláusula de responsabilidade. Isso é texto jurídico
 *   que depende de quem for o responsável pelo sistema, e inventá-lo agora seria
 *   pior que a lacuna.
 * - O sistema não é canal de emergência. O alerta de chamado crítico sem
 *   atendimento só dispara depois de 15 minutos, e dizer isto aqui evita que
 *   alguém espere socorro de uma fila de chamados.
 */

const ATUALIZADO_EM = '4 de novembro de 2026';

function TermosDeUso() {
  return (
    <PaginaDeTexto
      titulo="Termos de uso"
      atual="/termos"
      introducao={`Estas são as condições para usar o Conserva Predial, o sistema de pedidos de manutenção predial. Atualizado em ${ATUALIZADO_EM}.`}
    >
      <Aviso tipo="info">
        O Conserva Predial é um projeto de conclusão de curso, em fase de piloto. Estes termos foram
        escritos para esse piloto e serão revistos quando a instituição que vai operar o sistema for
        formalizada.
      </Aviso>

      <Secao titulo="Para que serve">
        <p>
          Para registrar, distribuir e acompanhar pedidos de manutenção de um prédio: quem pediu, o
          que foi pedido, quem atende, em que estado está e quando foi concluído. Também guarda o
          histórico dos serviços, a manutenção preventiva e os relatórios que a gestão usa para
          acompanhar o atendimento.
        </p>
      </Secao>

      <Secao titulo="Quem pode usar">
        <p>
          Quem tem uma conta. A conta é pessoal e tem um perfil: quem pede um serviço (solicitante),
          quem o executa (técnico), quem distribui e acompanha (gestor) e quem administra o sistema
          (administrador). O que cada pessoa vê e faz depende do perfil, e a gestão pode exigir
          aprovação antes de liberar um cadastro novo.
        </p>
      </Secao>

      <Secao titulo="O que esperamos de você">
        <ul className={LISTA}>
          <li>Informar dados verdadeiros e descrever o problema com clareza, no local certo.</li>
          <li>
            Não escrever informação pessoal desnecessária nos chamados, e evitar enquadrar pessoas nas
            fotos (veja o{' '}
            <Link to="/privacidade" className={LINK}>
              aviso de privacidade
            </Link>
            ).
          </li>
          <li>
            Guardar a sua senha e o código de verificação só para você, e não entrar com a conta de
            outra pessoa. O que for feito com a sua conta fica registrado em seu nome.
          </li>
          <li>
            Não tentar ver ou alterar o que o seu perfil não permite, nem sobrecarregar o sistema ou
            testar a sua segurança sem autorização por escrito.
          </li>
          <li>
            Quem executa um serviço só confirma o uso de equipamento de proteção (EPI) se ele foi
            usado. A confirmação fica registrada com o nome e a hora.
          </li>
        </ul>
      </Secao>

      <Secao titulo="O que o sistema registra">
        <p>
          Cada mudança de estado, comentário e avaliação fica no histórico do chamado, com quem a fez e
          quando. Esse histórico é o registro da manutenção do prédio e por isso não é apagado a pedido
          de uma pessoa; o que se pode pedir sobre os dados pessoais está no aviso de privacidade.
        </p>
      </Secao>

      <Secao titulo="Emergências">
        <p>
          <strong>O Conserva Predial não é um canal de emergência.</strong> Em caso de risco à vida,
          incêndio, vazamento de gás, choque elétrico ou desabamento, use o procedimento de emergência
          do prédio e os serviços públicos (192, 193 e 190), e só depois registre o chamado. Um
          chamado marcado como crítico gera um alerta para a gestão, mas só depois de 15 minutos sem
          atendimento.
        </p>
      </Secao>

      <Secao titulo="Disponibilidade e prazos">
        <p>
          Por estar em piloto, o sistema não garante funcionamento ininterrupto e pode sair do ar para
          manutenção. Os prazos que aparecem nos chamados são metas de acompanhamento definidas pela
          instituição, e não uma promessa de conserto na data. Sem conexão, a tela mostra o que foi
          consultado da última vez, mas o que você tentar registrar não é salvo: a tela avisa, e é
          preciso repetir quando a conexão voltar.
        </p>
      </Secao>

      <Secao titulo="Contas e suspensão">
        <p>
          A administração pode desativar contas que descumpram estes termos, que estejam sem uso ou
          cujo dono tenha se desligado. Chamados e histórico continuam registrados.
        </p>
      </Secao>

      <Secao titulo="Instalações de demonstração">
        <p>
          Um endereço marcado como demonstração só tem dados fictícios e serve para conhecer o
          sistema. Não registre nele nenhum pedido real nem dado pessoal verdadeiro.
        </p>
      </Secao>

      <Secao titulo="Mudanças e contato">
        <p>
          Quando estes termos mudarem, a data de atualização, no alto, muda junto. Para dúvidas sobre
          eles ou sobre o uso do sistema, veja a página de{' '}
          <Link to="/suporte" className={LINK}>
            ajuda e suporte
          </Link>
          .
        </p>
      </Secao>
    </PaginaDeTexto>
  );
}

export default TermosDeUso;

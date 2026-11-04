import Aviso from '../components/ui/Aviso';
import PaginaDeTexto, { LISTA, LINK, Secao } from '../components/ui/PaginaDeTexto';
import { Link } from 'react-router';
import { CONTATO, linkDeSuporte } from '../dominio/contato';

/**
 * Ajuda e suporte: a quem escrever, o que dizer e o que tentar antes.
 *
 * O canal é um e-mail, e de propósito nada além disso: sem chat, sem formulário
 * que envie dado a um serviço de terceiros, sem botão de mensagem instantânea.
 * O link já abre o rascunho com o roteiro do que contar, mas o texto só sai do
 * aparelho quando a pessoa envia.
 *
 * Não há prazo de resposta aqui porque não há quem o garanta: o projeto está em
 * piloto e a instituição ainda não existe. Prometer um prazo seria pior que
 * dizer isso.
 */

function Suporte() {
  return (
    <PaginaDeTexto
      titulo="Ajuda e suporte"
      atual="/suporte"
      introducao="Aqui você encontra como relatar um problema técnico ou pedir ajuda para usar o sistema."
    >
      <Aviso tipo="atencao">
        Isto não é um canal de emergência. Em caso de risco à vida, incêndio ou vazamento de gás, use o
        procedimento de emergência do prédio e os serviços públicos (192, 193 e 190).
      </Aviso>

      <Secao titulo="Fale com a gente">
        <p>
          Escreva para{' '}
          <a href={linkDeSuporte()} className={`${LINK} break-all`}>
            {CONTATO}
          </a>
          . O link abre o seu programa de e-mail com um roteiro do que contar. Por ser um projeto em
          piloto, não há prazo garantido de resposta.
        </p>
      </Secao>

      <Secao titulo="O que contar">
        <ul className={LISTA}>
          <li>O que você estava tentando fazer e o que aconteceu no lugar.</li>
          <li>A mensagem que apareceu na tela, se houve, e em que tela foi.</li>
          <li>O dia e a hora aproximados, e o número do chamado (protocolo), se for sobre um.</li>
          <li>O aparelho e o navegador que você usava.</li>
        </ul>
        <p>
          <strong>Nunca envie a sua senha nem o código de verificação.</strong> Ninguém do projeto vai
          pedi-los.
        </p>
      </Secao>

      <Secao titulo="Antes de escrever">
        <ul className={LISTA}>
          <li>
            <strong>Esqueceu a senha:</strong> use{' '}
            <Link to="/recuperar-senha" className={LINK}>
              Recuperar senha
            </Link>{' '}
            na tela de entrada.
          </li>
          <li>
            <strong>Sem conexão:</strong> o aviso aparece no alto da tela. Você pode consultar o que
            abriu da última vez, mas o que tentar registrar não é salvo: a tela avisa, e é preciso
            repetir quando a conexão voltar.
          </li>
          <li>
            <strong>Página em branco ou tela travada:</strong> recarregue a página. Se o problema
            continuar, conte como acima.
          </li>
          <li>
            <strong>Dúvida sobre um pedido:</strong> escreva um comentário no próprio chamado; ele
            chega a quem está atendendo.
          </li>
          <li>
            <strong>Pedido sobre os seus dados pessoais</strong> (acesso, correção ou remoção): veja
            &ldquo;Seus direitos&rdquo; no{' '}
            <Link to="/privacidade" className={LINK}>
              aviso de privacidade
            </Link>
            .
          </li>
        </ul>
      </Secao>
    </PaginaDeTexto>
  );
}

export default Suporte;

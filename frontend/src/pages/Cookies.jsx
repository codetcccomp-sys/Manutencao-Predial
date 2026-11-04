import { useState } from 'react';
import Aviso from '../components/ui/Aviso';
import Botao from '../components/ui/Botao';
import PaginaDeTexto, { LINK, Secao } from '../components/ui/PaginaDeTexto';
import { Link } from 'react-router';
import { limparDadosOffline } from '../pwa';

/**
 * Cookies e armazenamento: o que o sistema guarda NO APARELHO, e como apagar.
 *
 * A lista é a do código, conferida: um cookie de sessão, duas chaves de
 * armazenamento do navegador e o cache do service worker. Nada de análise de
 * audiência, publicidade ou rastreamento. Por isso não há banner de
 * consentimento: tudo o que existe é estritamente necessário ao serviço que a
 * pessoa pediu ao entrar, e pedir "aceite" por algo que não tem como recusar
 * seria um falso controle. Se um dia entrar qualquer ferramenta que não seja
 * estritamente necessária, este texto e o controle de consentimento passam a ser
 * obrigatórios ANTES de ela ser ligada (docs/lgpd.md).
 *
 * O único controle real é apagar as consultas guardadas, útil num aparelho
 * compartilhado. O cookie de sessão é HttpOnly: a tela não o enxerga nem o
 * apaga; quem o encerra é "Sair" (o servidor o invalida) ou o navegador.
 */

const ARMAZENAMENTOS = [
  {
    nome: 'conserva_sessao',
    tipo: 'Cookie',
    para: 'Mantém você conectado. É HttpOnly e Secure: nenhum script da página consegue lê-lo.',
    prazo: 'Algumas horas (8, no padrão do sistema), ou até você sair.',
  },
  {
    nome: 'smp_usuario',
    tipo: 'Armazenamento local',
    para: 'Seu nome e perfil, só para desenhar a tela. Não é prova de identidade: quem vale é o cookie.',
    prazo: 'Até você sair.',
  },
  {
    nome: 'smp_recarga_de_tela',
    tipo: 'Armazenamento da aba',
    para: 'Lembra que a página já foi recarregada uma vez depois de uma atualização do sistema.',
    prazo: 'Até fechar a aba.',
  },
  {
    nome: 'Cópia do aplicativo e das últimas consultas',
    tipo: 'Cache do navegador (service worker)',
    para: 'Deixa abrir o aplicativo e rever a fila e o chamado consultados por último, sem conexão.',
    prazo: 'As consultas são apagadas ao entrar e ao sair.',
  },
];

function Cookies() {
  const [apagado, setApagado] = useState(false);

  function apagar() {
    limparDadosOffline();
    setApagado(true);
  }

  return (
    <PaginaDeTexto
      titulo="Cookies e armazenamento"
      atual="/cookies"
      introducao="Esta página diz o que o Conserva Predial guarda no seu aparelho enquanto você o usa, para quê e por quanto tempo."
    >
      <Aviso tipo="info">
        Usamos só o que o sistema precisa para funcionar. <strong>Não há cookie de publicidade, de
        análise de audiência nem de rastreamento</strong>, e não usamos o Google Analytics. Por isso não
        há faixa de consentimento: não há nada que dê para aceitar ou recusar sem desligar o próprio
        sistema.
      </Aviso>

      <Secao titulo="O que fica no seu aparelho">
        <ul className="grid gap-3">
          {ARMAZENAMENTOS.map((item) => (
            <li key={item.nome} className="grid gap-0.5 rounded border border-borda p-3">
              <p className="font-medium text-tinta">
                {item.nome} <span className="text-xs font-normal text-tinta-2">({item.tipo})</span>
              </p>
              <p>{item.para}</p>
              <p className="text-tinta-2">{item.prazo}</p>
            </li>
          ))}
        </ul>
      </Secao>

      <Secao titulo="Entrar com o Google">
        <p>
          Quando o acesso pelo Google está ligado, a tela de entrada carrega um componente de{' '}
          <span className="break-all">accounts.google.com</span>. Ele pertence ao Google, que pode
          gravar os cookies dele conforme a política dele. Só a tela de entrada o carrega; as telas
          internas não. Se você prefere não carregá-lo, entre com e-mail e senha.
        </p>
      </Secao>

      <Secao titulo="Apagar o que foi guardado">
        <p>
          Num aparelho compartilhado, você pode apagar agora as consultas guardadas para uso sem
          conexão. Elas também são apagadas quando você entra e quando sai. Para encerrar a sessão
          (o cookie), use <strong>Sair</strong> no alto da tela; apagar os dados do site, nas
          configurações do navegador, também remove tudo o que foi listado acima.
        </p>
        <div>
          <Botao onClick={apagar}>Apagar as consultas guardadas neste aparelho</Botao>
        </div>
        {apagado && (
          <Aviso tipo="sucesso">
            Pronto. As consultas guardadas neste aparelho foram apagadas.
          </Aviso>
        )}
      </Secao>

      <Secao titulo="Mais informações">
        <p>
          O que o sistema guarda sobre você nos servidores está no{' '}
          <Link to="/privacidade" className={LINK}>
            aviso de privacidade
          </Link>
          .
        </p>
      </Secao>
    </PaginaDeTexto>
  );
}

export default Cookies;

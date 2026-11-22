import { useEffect, useState } from 'react';
import api from '../api/client';
import Aviso from './ui/Aviso';

/**
 * Avisa a gestão quando o agendador parou.
 *
 * O aviso de atraso e a preventiva dependem de um serviço externo chamando a
 * API. Quando ele para, nada quebra na tela: os chamados continuam abrindo e
 * fechando, só que ninguém é avisado de atraso e nenhuma preventiva nasce. O
 * silêncio parece saúde — e é aqui, na tela de quem decide, que ele vira aviso.
 *
 * Sem nada a dizer (tudo em dia, ou a consulta falhou), não ocupa espaço.
 */
const FRASES = {
  parada: (t) => `${t.rotulo}: a última passagem com sucesso foi ${quando(t.ultimo_sucesso)}.`,
  falhando: (t) =>
    `${t.rotulo}: a última passagem falhou${t.ultimo_erro ? ` (${t.ultimo_erro})` : ''}.`,
  nunca: (t) => `${t.rotulo}: nenhuma passagem registrada — o agendamento foi criado?`,
};

function quando(instante) {
  if (!instante) return 'nunca';
  return new Date(instante).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// O login no servidor de e-mail entra na lista das tarefas, mas o aviso é outro: o que falta não é
// o agendador, é a senha. Só a falha conta: parada quer dizer que o agendador parou, e isso o aviso
// de cima já diz. Recusado três vezes até 16/11/2026, sempre descoberto por quem não recebeu o
// link de "esqueci minha senha".
const EMAIL = 'conferir-email';

function AvisoDoAgendador() {
  const [problemas, setProblemas] = useState([]);
  const [falhaDoEmail, setFalhaDoEmail] = useState(null);

  useEffect(() => {
    let ativo = true;
    api
      .get('/operacao/agendador')
      .then(({ data }) => {
        if (!ativo) return;
        const tarefas = data?.tarefas ?? [];
        setProblemas(tarefas.filter((t) => t.tarefa !== EMAIL && FRASES[t.situacao]));
        setFalhaDoEmail(tarefas.find((t) => t.tarefa === EMAIL && t.situacao === 'falhando') ?? null);
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);

  if (problemas.length === 0 && !falhaDoEmail) return null;

  return (
    <>
      {falhaDoEmail && (
        <Aviso tipo="erro" titulo="E-mails do sistema não estão saindo" className="mb-4">
          <p>
            O servidor de e-mail recusou o envio
            {falhaDoEmail.ultimo_erro ? ` (${falhaDoEmail.ultimo_erro})` : ''}. Links de recuperação de senha
            e avisos por e-mail não chegam; o sino continua funcionando.
          </p>
          <p className="mt-1 text-xs">
            Com o Gmail, é a senha de app que caiu (ela cai quando a senha da conta muda): gere outra e troque
            SMTP_PASSWORD na Vercel, com novo deploy (docs/piloto.md, seção 2.2). O aviso some na passagem seguinte
            do agendador.
          </p>
        </Aviso>
      )}
      {problemas.length > 0 && <AvisoDeTarefas problemas={problemas} />}
    </>
  );
}

function AvisoDeTarefas({ problemas }) {
  return (
    <Aviso tipo="atencao" titulo="Tarefas automáticas paradas" className="mb-4">
      <ul className="list-disc pl-5">
        {problemas.map((t) => (
          <li key={t.tarefa}>{FRASES[t.situacao](t)}</li>
        ))}
      </ul>
      <p className="mt-1 text-xs">
        Enquanto isso, avisos de atraso não saem e preventivas não são geradas. Confira o
        agendamento (docs/piloto.md, seção 2.1).
      </p>
    </Aviso>
  );
}

export default AvisoDoAgendador;

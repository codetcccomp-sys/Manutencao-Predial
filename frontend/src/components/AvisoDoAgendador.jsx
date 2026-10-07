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

function AvisoDoAgendador() {
  const [problemas, setProblemas] = useState([]);

  useEffect(() => {
    let ativo = true;
    api
      .get('/operacao/agendador')
      .then(({ data }) => {
        if (!ativo) return;
        setProblemas((data?.tarefas ?? []).filter((t) => FRASES[t.situacao]));
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);

  if (problemas.length === 0) return null;

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

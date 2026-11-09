import { useEffect, useState } from 'react';
import api from '../api/client';
import { rotuloPrioridade } from '../dominio/rotulos';

/**
 * RN12: as versões da política de prazos, com vigência e autor.
 *
 * Fica recolhido: quem ajusta um prazo quer os campos, e o histórico é para o
 * dia em que alguém pergunta "desde quando a alta é 16 horas, e quem mudou?".
 * Só busca quando é aberto, e de novo quando um prazo muda com ele aberto
 * (`versao` troca a cada alteração feita na tela).
 */
const CONTAGEM = { corridas: 'corridas', uteis: 'úteis' };
const dataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function HistoricoDoSla({ versao }) {
  const [aberto, setAberto] = useState(false);
  const [versoes, setVersoes] = useState(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (!aberto) return undefined;
    let vivo = true;
    setErro(false);
    api
      .get('/sla/historico')
      .then(({ data }) => vivo && setVersoes(data.versoes))
      .catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
    };
  }, [aberto, versao]);

  return (
    <details className="mt-3 text-sm" onToggle={(e) => setAberto(e.currentTarget.open)}>
      <summary className="alvo-toque inline-flex cursor-pointer items-center text-navy underline">
        Histórico de alterações dos prazos
      </summary>
      {erro && <p className="mt-2 text-erro">Não foi possível carregar o histórico.</p>}
      {!erro && versoes === null && <p className="mt-2 text-tinta-2">Carregando…</p>}
      {!erro && versoes?.length === 0 && <p className="mt-2 text-tinta-2">Nenhuma alteração registrada.</p>}
      {!erro && versoes?.length > 0 && (
        <ul className="mt-2 grid gap-2">
          {versoes.map((v) => (
            <li key={v.id} className="rounded border border-borda px-3 py-2">
              <strong className="text-tinta">
                {rotuloPrioridade(v.prioridade)}: {v.prazo_horas} h {CONTAGEM[v.contagem] ?? v.contagem}
              </strong>
              <span className="block text-xs text-tinta-2">
                {v.vigente_ate
                  ? `De ${dataHora(v.vigente_desde)} a ${dataHora(v.vigente_ate)}`
                  : `Em vigor desde ${dataHora(v.vigente_desde)}`}
                {v.alterado_por ? `, por ${v.alterado_por}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export default HistoricoDoSla;

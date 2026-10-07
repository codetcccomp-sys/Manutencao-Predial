import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import Aviso from './ui/Aviso';
import Botao from './ui/Botao';
import Cartao from './ui/Cartao';
import { Campo } from './ui/Campo';
import { formatarDia } from '../dominio/preventiva';

/**
 * A régua das horas úteis: o expediente da semana e os feriados.
 *
 * Só vale para as prioridades configuradas com "horas úteis" (em Relatórios,
 * nos prazos por prioridade). A semana é salva inteira de uma vez, como a API
 * espera: quem edita o expediente está olhando para a semana.
 */
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function semanaDe(expediente) {
  return DIAS.map((_, dia) => {
    const linha = expediente.find((e) => e.dia_semana === dia);
    return { dia_semana: dia, ativo: Boolean(linha), inicio: linha?.inicio ?? '08:00', fim: linha?.fim ?? '18:00' };
  });
}

function ExpedienteEFeriados() {
  const [semana, setSemana] = useState(semanaDe([]));
  const [feriados, setFeriados] = useState([]);
  const [novo, setNovo] = useState({ data: '', descricao: '' });
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(() => {
    Promise.all([api.get('/sla/expediente'), api.get('/sla/feriados')])
      .then(([e, f]) => {
        setSemana(semanaDe(e.data.expediente ?? []));
        setFeriados(f.data.feriados ?? []);
      })
      .catch(() => setErro('Não foi possível carregar o expediente.'));
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function executar(acao, mensagem) {
    setErro('');
    setAviso('');
    try {
      await acao();
      setAviso(mensagem);
      carregar();
      return true;
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível salvar.');
      return false;
    }
  }

  function mudarDia(dia, campos) {
    setSemana((atual) => atual.map((d) => (d.dia_semana === dia ? { ...d, ...campos } : d)));
  }

  const salvarSemana = () =>
    executar(
      () =>
        api.put('/sla/expediente', {
          dias: semana
            .filter((d) => d.ativo)
            .map(({ dia_semana, inicio, fim }) => ({ dia_semana, inicio, fim })),
        }),
      'Expediente salvo. Vale para os prazos em horas úteis calculados daqui em diante.'
    );

  const semExpediente = semana.every((d) => !d.ativo);

  return (
    <div className="grid gap-6">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}

      <Cartao
        titulo="Expediente"
        descricao="Os prazos em horas úteis só correm dentro destes horários. Dia desmarcado é dia sem expediente."
      >
        <ul className="grid gap-2">
          {semana.map((d) => (
            <li key={d.dia_semana} className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex w-28 items-center gap-2">
                <input
                  type="checkbox"
                  checked={d.ativo}
                  onChange={(e) => mudarDia(d.dia_semana, { ativo: e.target.checked })}
                />
                {DIAS[d.dia_semana]}
              </label>
              <input
                type="time"
                aria-label={`Início do expediente: ${DIAS[d.dia_semana]}`}
                value={d.inicio}
                disabled={!d.ativo}
                onChange={(e) => mudarDia(d.dia_semana, { inicio: e.target.value })}
                className="rounded border border-borda-forte bg-superficie px-2 py-1 disabled:opacity-50"
              />
              <span className="text-tinta-2">às</span>
              <input
                type="time"
                aria-label={`Fim do expediente: ${DIAS[d.dia_semana]}`}
                value={d.fim}
                disabled={!d.ativo}
                onChange={(e) => mudarDia(d.dia_semana, { fim: e.target.value })}
                className="rounded border border-borda-forte bg-superficie px-2 py-1 disabled:opacity-50"
              />
            </li>
          ))}
        </ul>
        {semExpediente && (
          <p className="mt-3 text-xs text-atencao">
            Sem nenhum dia de expediente não há hora útil para contar: os prazos em horas úteis passam a
            correr como horas corridas.
          </p>
        )}
        <Botao variante="primaria" onClick={salvarSemana} className="mt-4">
          Salvar expediente
        </Botao>
      </Cartao>

      <Cartao titulo="Feriados" descricao="Dias sem expediente, mesmo caindo em dia de semana.">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await executar(() => api.post('/sla/feriados', novo), 'Feriado cadastrado.');
            if (ok) setNovo({ data: '', descricao: '' });
          }}
          className="mb-4 grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
        >
          <Campo
            rotulo="Data"
            type="date"
            value={novo.data}
            onChange={(e) => setNovo({ ...novo, data: e.target.value })}
          />
          <Campo
            rotulo="Descrição"
            value={novo.descricao}
            minLength={3}
            onChange={(e) => setNovo({ ...novo, descricao: e.target.value })}
            placeholder="Proclamação da República"
          />
          <Botao type="submit">Adicionar</Botao>
        </form>
        {feriados.length === 0 ? (
          <p className="text-sm text-tinta-2">Nenhum feriado cadastrado.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {feriados.map((f) => (
              <li key={f.data} className="flex items-center justify-between gap-3 rounded border border-borda px-3 py-1.5">
                <span>
                  <strong>{formatarDia(f.data)}</strong> · {f.descricao}
                </span>
                <Botao
                  tamanho="sm"
                  variante="discreta"
                  aria-label={`Remover feriado de ${formatarDia(f.data)}`}
                  onClick={() => executar(() => api.delete(`/sla/feriados/${f.data}`), 'Feriado removido.')}
                >
                  Remover
                </Botao>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </div>
  );
}

export default ExpedienteEFeriados;

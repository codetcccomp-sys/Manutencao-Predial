import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

const PRIORIDADE_LABEL = {
  critica: 'Crítica',
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
};

const ESTADO_LABEL = {
  aberto: 'Aberto',
  em_triagem: 'Em triagem',
  atribuido: 'Atribuído',
  em_andamento: 'Em andamento',
  aguardando_material: 'Aguardando material',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

// O backend devolve segundos; quem lê o relatório pensa em horas e dias.
function formatarDuracao(segundos) {
  if (segundos === null || segundos === undefined) return '—';
  const s = Number(segundos);
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} dias`;
}

function Cartao({ rotulo, valor, destaque }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{rotulo}</p>
      <p className={`text-2xl font-bold ${destaque || 'text-navy'}`}>{valor}</p>
    </div>
  );
}

function Barra({ rotulo, valor, total }) {
  const porcento = total > 0 ? Math.round((valor / total) * 100) : 0;
  return (
    <div className="grid gap-1">
      <div className="flex justify-between text-sm">
        <span className="text-gray-700">{rotulo}</span>
        <span className="text-gray-500">
          {valor} ({porcento}%)
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded overflow-hidden">
        <div className="h-full bg-navy rounded" style={{ width: `${porcento}%` }} />
      </div>
    </div>
  );
}

function Relatorios() {
  const { usuario } = useAuth();
  const podeVer = ['administrador', 'gestor'].includes(usuario.perfil);

  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(() => {
    setCarregando(true);
    setErro('');
    const params = { ...(de ? { de } : {}), ...(ate ? { ate } : {}) };

    Promise.all([
      api.get('/relatorios/resumo', { params }),
      api.get('/relatorios/desempenho', { params }),
      api.get('/relatorios/tecnicos', { params }),
      api.get('/sla'),
    ])
      .then(([resumo, desempenho, tecnicos, sla]) =>
        setDados({
          resumo: resumo.data,
          desempenho: desempenho.data,
          tecnicos: tecnicos.data.tecnicos,
          sla: sla.data.sla,
        })
      )
      .catch((err) =>
        setErro(err.response?.data?.erro?.mensagem || 'Não foi possível carregar os relatórios.')
      )
      .finally(() => setCarregando(false));
  }, [de, ate]);

  useEffect(() => {
    if (podeVer) carregar();
  }, [carregar, podeVer]);

  // Salva no blur, e só quando o valor mudou de fato: sem essa comparação
  // qualquer passagem pelo campo dispararia um PATCH sem alteração nenhuma.
  async function salvarPrazo(prioridade, valor, anterior) {
    const horas = Number(valor);
    if (!Number.isInteger(horas) || horas === anterior) return;

    setErro('');
    try {
      await api.patch(`/sla/${prioridade}`, { prazo_horas: horas });
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível alterar o prazo.');
      carregar();
    }
  }

  if (!podeVer) return <Navigate to="/" replace />;

  return (
    <div className="grid gap-6">
      <h2 className="text-lg font-bold text-navy">Relatórios</h2>

      <div className="bg-white rounded-lg shadow-sm p-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="grid gap-1">
          <label className="text-xs text-gray-600" htmlFor="de">
            De
          </label>
          <input
            id="de"
            type="date"
            value={de}
            onChange={(e) => setDe(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-gray-600" htmlFor="ate">
            Até
          </label>
          <input
            id="ate"
            type="date"
            value={ate}
            onChange={(e) => setAte(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          />
        </div>
        {(de || ate) && (
          <button
            onClick={() => {
              setDe('');
              setAte('');
            }}
            className="text-sm text-navy underline self-center sm:self-end sm:pb-2"
          >
            Limpar período
          </button>
        )}
      </div>

      {erro && <div className="bg-red-50 text-red-700 text-sm rounded p-3">{erro}</div>}
      {carregando && <p className="text-gray-500 text-sm">Carregando...</p>}

      {!carregando && dados && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Cartao rotulo="Total" valor={dados.resumo.totais.total} />
            <Cartao rotulo="Em aberto" valor={dados.resumo.totais.em_aberto} destaque="text-amber" />
            <Cartao
              rotulo="Concluídos"
              valor={dados.resumo.totais.concluidos}
              destaque="text-green-700"
            />
            <Cartao rotulo="Cancelados" valor={dados.resumo.totais.cancelados} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="bg-white rounded-lg shadow-sm p-6 grid gap-3">
              <h3 className="font-medium text-navy">Por estado</h3>
              {dados.resumo.por_estado.length === 0 && (
                <p className="text-sm text-gray-500">Nenhum chamado no período.</p>
              )}
              {dados.resumo.por_estado.map((l) => (
                <Barra
                  key={l.estado}
                  rotulo={ESTADO_LABEL[l.estado] || l.estado}
                  valor={l.total}
                  total={dados.resumo.totais.total}
                />
              ))}
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 grid gap-3">
              <h3 className="font-medium text-navy">Por categoria</h3>
              {dados.resumo.por_categoria.length === 0 && (
                <p className="text-sm text-gray-500">Nenhum chamado no período.</p>
              )}
              {dados.resumo.por_categoria.map((l) => (
                <Barra
                  key={l.categoria}
                  rotulo={l.categoria}
                  valor={l.total}
                  total={dados.resumo.totais.total}
                />
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 grid gap-4">
            <div>
              <h3 className="font-medium text-navy">Tempo de atendimento</h3>
              <p className="text-xs text-gray-500">
                Descontado o tempo em &ldquo;aguardando material&rdquo;, que é espera por insumo e não
                trabalho da equipe.
              </p>
            </div>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Cartao
                rotulo="Concluídos"
                valor={dados.desempenho.geral.chamados_concluidos}
              />
              <Cartao
                rotulo="Médio"
                valor={formatarDuracao(dados.desempenho.geral.tempo_medio_segundos)}
              />
              <Cartao
                rotulo="Mediano"
                valor={formatarDuracao(dados.desempenho.geral.tempo_mediano_segundos)}
              />
              <Cartao
                rotulo="Nota média"
                valor={
                  dados.desempenho.avaliacoes.nota_media
                    ? `${Number(dados.desempenho.avaliacoes.nota_media).toFixed(1)} / 5`
                    : '—'
                }
              />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 grid gap-4">
            <div>
              <h3 className="font-medium text-navy">Cumprimento de prazo</h3>
              <p className="text-xs text-gray-500">
                O prazo é contado a partir da abertura e empurrado pelo tempo em &ldquo;aguardando
                material&rdquo;, pelo mesmo motivo que o tempo de atendimento o desconta.
              </p>
            </div>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Cartao
                rotulo="Concluídos no prazo"
                valor={
                  dados.desempenho.prazo.percentual_no_prazo === null
                    ? '—'
                    : `${dados.desempenho.prazo.percentual_no_prazo}%`
                }
                destaque={
                  dados.desempenho.prazo.percentual_no_prazo === null
                    ? undefined
                    : dados.desempenho.prazo.percentual_no_prazo >= 80
                      ? 'text-green-700'
                      : 'text-red-700'
                }
              />
              <Cartao
                rotulo="Dentro / total"
                valor={`${dados.desempenho.prazo.concluidos_no_prazo} / ${dados.desempenho.prazo.concluidos_com_prazo}`}
              />
              <Cartao rotulo="Em aberto" valor={dados.desempenho.prazo.em_aberto} />
              <Cartao
                rotulo="Atrasados agora"
                valor={dados.desempenho.prazo.em_aberto_atrasados}
                destaque={dados.desempenho.prazo.em_aberto_atrasados > 0 ? 'text-red-700' : 'text-green-700'}
              />
            </div>

            <div>
              <h4 className="text-sm font-medium text-navy mb-2">Prazos por prioridade</h4>
              <div className="flex flex-wrap gap-4">
                {dados.sla.map((s) => (
                  <label key={s.prioridade} className="text-sm grid gap-1">
                    <span className="text-gray-600">
                      {PRIORIDADE_LABEL[s.prioridade] ?? s.prioridade}
                    </span>
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        max={8760}
                        defaultValue={s.prazo_horas}
                        onBlur={(e) => salvarPrazo(s.prioridade, e.target.value, s.prazo_horas)}
                        className="border rounded px-2 py-1 w-24"
                      />
                      <span className="text-gray-500 text-xs">horas</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Alterar o prazo vale para chamados abertos daqui em diante; os já existentes mantêm o
                prazo com que nasceram.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="font-medium text-navy mb-3">Carga por técnico</h3>
            {dados.tecnicos.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhum chamado atribuído no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-4 font-medium">Técnico</th>
                      <th className="py-2 pr-4 font-medium">Atribuídos</th>
                      <th className="py-2 pr-4 font-medium">Concluídos</th>
                      <th className="py-2 pr-4 font-medium">Em aberto</th>
                      <th className="py-2 font-medium">Tempo médio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.tecnicos.map((t) => (
                      <tr key={t.tecnico_id} className="border-b last:border-0">
                        <td className="py-2 pr-4 text-navy">{t.nome}</td>
                        <td className="py-2 pr-4">{t.atribuidos}</td>
                        <td className="py-2 pr-4">{t.concluidos}</td>
                        <td className="py-2 pr-4">{t.em_aberto}</td>
                        <td className="py-2">{formatarDuracao(t.tempo_medio_segundos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default Relatorios;

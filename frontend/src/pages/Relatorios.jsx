import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import api, { baixarArquivo } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { registrarAcao } from '../monitoramento';
import { useEntrada } from '../animacao/useEntrada';
import NumeroAnimado from '../animacao/NumeroAnimado';
import { reduzMovimento } from '../animacao/movimento';
import GraficoDeLinhas from '../components/ui/GraficoDeLinhas';
import { rotuloEstado, rotuloPrioridade } from '../dominio/rotulos';
import Tabela from '../components/ui/Tabela';
import Aviso from '../components/ui/Aviso';
import CabecalhoDePagina from '../components/ui/CabecalhoDePagina';
import HistoricoDoSla from '../components/HistoricoDoSla';
import { formatarDia } from '../dominio/preventiva';

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
    <div data-anim className="bg-superficie rounded-lg border border-borda shadow-sm p-4">
      <p className="text-xs uppercase tracking-wide text-tinta-2">{rotulo}</p>
      <p className={`text-2xl font-bold ${destaque || 'text-navy'}`}>
        {typeof valor === 'number' ? <NumeroAnimado valor={valor} /> : valor}
      </p>
    </div>
  );
}

function Barra({ rotulo, valor, total }) {
  const porcento = total > 0 ? Math.round((valor / total) * 100) : 0;

  // A barra nasce vazia e cresce até o valor: a largura muda por transição de CSS
  // (e a regra de prefers-reduced-motion a torna instantânea). `requestAnimationFrame`
  // garante um quadro pintado com 0% antes de mudar — sem ele o navegador junta os
  // dois estilos e a transição nunca acontece. Sem `matchMedia` (jsdom) vai direto.
  const [largura, setLargura] = useState(() => (reduzMovimento() ? porcento : 0));
  useEffect(() => {
    const quadro = requestAnimationFrame(() => setLargura(porcento));
    return () => cancelAnimationFrame(quadro);
  }, [porcento]);

  return (
    <div className="grid gap-1">
      <div className="flex justify-between text-sm">
        <span className="text-tinta">{rotulo}</span>
        <span className="text-tinta-2">
          {valor} ({porcento}%)
        </span>
      </div>
      <div className="h-2 bg-neutro-tenue rounded overflow-hidden">
        <div
          className="h-full bg-navy rounded transition-[width] duration-700 ease-out"
          style={{ width: `${largura}%` }}
        />
      </div>
    </div>
  );
}

// Fora do componente: é a identidade do array que o gráfico usa para saber se
// precisa recalcular a escala.
const SERIES_POR_DIA = [
  { chave: 'abertos', rotulo: 'Abertos', cor: 'navy' },
  { chave: 'concluidos', rotulo: 'Concluídos', cor: 'sucesso' },
];

function Relatorios() {
  const { usuario } = useAuth();
  const podeVer = ['administrador', 'gestor'].includes(usuario.perfil);

  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [dados, setDados] = useState(null);
  // A série tem carga e falha próprias: um erro no gráfico não derruba os relatórios
  // que já chegaram, e um relatório lento não segura o gráfico.
  const [serie, setSerie] = useState(null);
  // Separado do resto, como a série: um relatório de preventiva que falha não
  // derruba os números de chamados, que são o que a tela existe para mostrar.
  const [preventiva, setPreventiva] = useState(null);
  const [erroSerie, setErroSerie] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const refPagina = useRef(null);
  useEntrada(refPagina, [dados]);
  const [erro, setErro] = useState('');
  // Troca a cada alteração de prazo, para o histórico aberto se atualizar (RN12).
  const [alteracoesDeSla, setAlteracoesDeSla] = useState(0);
  const [baixando, setBaixando] = useState('');

  const carregar = useCallback(() => {
    setCarregando(true);
    setErro('');
    const params = { ...(de ? { de } : {}), ...(ate ? { ate } : {}) };

    setErroSerie(false);
    api
      .get('/relatorios/serie', { params })
      .then(({ data }) => setSerie(data))
      .catch(() => {
        setSerie(null);
        setErroSerie(true);
      });

    api
      .get('/relatorios/preventiva', { params })
      .then(({ data }) => setPreventiva(data))
      .catch(() => setPreventiva(null));

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
    await alterarSla(prioridade, { prazo_horas: horas });
  }

  async function alterarSla(prioridade, campos) {
    setErro('');
    try {
      await api.patch(`/sla/${prioridade}`, campos);
      setAlteracoesDeSla((n) => n + 1);
      // Só os prazos, sem recarregar a tela: `carregar()` troca tudo por
      // "Carregando..." e desmonta os campos, e quem saía de um prazo com Tab
      // para o seguinte perdia o foco e a posição da página a cada alteração.
      // Os números do relatório não mudam com o SLA (o prazo de cada chamado
      // foi gravado na abertura).
      const { data } = await api.get('/sla');
      setDados((atual) => (atual ? { ...atual, sla: data.sla } : atual));
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível alterar o prazo.');
      carregar();
    }
  }

  // A exportação respeita o mesmo período da tela: um relatório baixado com
  // recorte diferente do que está à vista seria a pior surpresa possível.
  async function exportar(formato, caminho) {
    setErro('');
    setBaixando(formato);
    try {
      await baixarArquivo(caminho, { ...(de ? { de } : {}), ...(ate ? { ate } : {}) });
      registrarAcao('relatorio_baixado');
    } catch (err) {
      setErro(err.message);
    } finally {
      setBaixando('');
    }
  }

  if (!podeVer) return <Navigate to="/" replace />;

  return (
    <div ref={refPagina} className="grid gap-6">
      <CabecalhoDePagina
        titulo="Relatórios"
        descricao="Os recortes respeitam o período selecionado — inclusive as exportações."
        className="mb-0"
      />

      <div className="bg-superficie rounded-lg border border-borda shadow-sm p-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="grid gap-1">
          <label className="text-xs text-tinta-2" htmlFor="de">
            De
          </label>
          <input
            id="de"
            type="date"
            value={de}
            onChange={(e) => setDe(e.target.value)}
            className="min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
          />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-tinta-2" htmlFor="ate">
            Até
          </label>
          <input
            id="ate"
            type="date"
            value={ate}
            onChange={(e) => setAte(e.target.value)}
            className="min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
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

        <div className="flex gap-2 sm:ml-auto">
          <button
            onClick={() => exportar('pdf', '/relatorios/exportar/resumo.pdf')}
            disabled={Boolean(baixando)}
            className="alvo-toque inline-flex items-center justify-center rounded bg-navy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-2 disabled:opacity-60"
          >
            {baixando === 'pdf' ? 'Gerando...' : 'Baixar PDF'}
          </button>
          <button
            onClick={() => exportar('csv', '/relatorios/exportar/chamados.csv')}
            disabled={Boolean(baixando)}
            className="alvo-toque inline-flex items-center justify-center rounded border border-borda-forte bg-superficie px-4 py-2.5 text-sm font-medium text-navy transition-colors hover:bg-fundo disabled:opacity-60"
          >
            {baixando === 'csv' ? 'Gerando...' : 'Baixar planilha'}
          </button>
        </div>
      </div>

      <p className="text-xs text-tinta-2 -mt-4">
        O PDF traz este relatório consolidado, pronto para arquivar. A planilha traz uma linha por
        chamado, para cruzamentos que a tela não prevê. Os dois respeitam o período selecionado.
      </p>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && <p className="text-tinta-2 text-sm">Carregando...</p>}

      {!carregando && dados && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Cartao rotulo="Total" valor={dados.resumo.totais.total} />
            <Cartao rotulo="Em aberto" valor={dados.resumo.totais.em_aberto} destaque="text-amber" />
            <Cartao
              rotulo="Concluídos"
              valor={dados.resumo.totais.concluidos}
              destaque="text-sucesso"
            />
            <Cartao rotulo="Cancelados" valor={dados.resumo.totais.cancelados} />
          </div>

          <div
            data-anim
            className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid min-w-0 gap-3"
          >
            <div>
              <h2 className="font-medium text-navy">Chamados por dia</h2>
              <p className="text-xs text-tinta-2 mt-0.5">
                Abertos no período e, entre eles, os concluídos — contados no dia em que terminaram.
              </p>
            </div>

            {erroSerie && <Aviso tipo="atencao">Não foi possível carregar o gráfico por dia.</Aviso>}
            {!erroSerie && !serie && <p className="text-sm text-tinta-2">Carregando o gráfico...</p>}
            {serie && (
              <>
                <GraficoDeLinhas
                  dias={serie.dias}
                  series={SERIES_POR_DIA}
                  titulo="Chamados abertos e concluídos por dia"
                />
                {serie.truncado && (
                  <p className="text-xs text-tinta-2">
                    O período é maior que um ano: o gráfico mostra os últimos {serie.dias.length} dias.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3">
              <h2 className="font-medium text-navy">Por estado</h2>
              {dados.resumo.por_estado.length === 0 && (
                <p className="text-sm text-tinta-2">Nenhum chamado no período.</p>
              )}
              {dados.resumo.por_estado.map((l) => (
                <Barra
                  key={l.estado}
                  rotulo={rotuloEstado(l.estado)}
                  valor={l.total}
                  total={dados.resumo.totais.total}
                />
              ))}
            </div>

            <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3">
              <h2 className="font-medium text-navy">Por categoria</h2>
              {dados.resumo.por_categoria.length === 0 && (
                <p className="text-sm text-tinta-2">Nenhum chamado no período.</p>
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

          <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6 min-w-0">
            <div className="mb-3">
              <h2 className="font-medium text-navy">Por local</h2>
              <p className="text-xs text-tinta-2">
                Os 20 locais com mais chamados no período. O recorte responde onde a demanda se
                concentra e onde ela está vencendo o prazo.
              </p>
            </div>
            <Tabela
              legenda="Chamados por local no período"
              ordenavel
              chaveDaLinha={(l) => l.local}
              linhas={dados.resumo.por_local}
              vazio={<p className="text-sm text-tinta-2">Nenhum chamado no período.</p>}
              colunas={[
                { chave: 'local', rotulo: 'Local', principal: true },
                { chave: 'total', rotulo: 'Total', numerica: true },
                { chave: 'em_aberto', rotulo: 'Em aberto', numerica: true },
                {
                  chave: 'atrasados',
                  rotulo: 'Atrasados',
                  numerica: true,
                  // Zero atrasado não precisa gritar; o que precisa saltar é o
                  // local que está vencendo prazo.
                  conteudo: (l) => (
                    <span className={l.atrasados > 0 ? 'font-medium text-erro' : ''}>
                      {l.atrasados}
                    </span>
                  ),
                },
              ]}
            />
          </div>

          <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-4">
            <div>
              <h2 className="font-medium text-navy">Tempo de atendimento</h2>
              <p className="text-xs text-tinta-2">
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

          <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-4">
            <div>
              <h2 className="font-medium text-navy">Marcos do atendimento</h2>
              <p className="text-xs text-tinta-2">
                Os três intervalos que o processo distingue, para que &ldquo;tempo de
                atendimento&rdquo; não signifique coisas diferentes em análises diferentes.
              </p>
            </div>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
              <Cartao
                rotulo="Triagem"
                valor={formatarDuracao(dados.desempenho.marcos.tempo_triagem_segundos)}
              />
              <Cartao
                rotulo="Até atendimento"
                valor={formatarDuracao(dados.desempenho.marcos.tempo_ate_atendimento_segundos)}
              />
              <Cartao
                rotulo="Execução"
                valor={formatarDuracao(dados.desempenho.marcos.tempo_execucao_segundos)}
              />
            </div>
            <p className="text-xs text-tinta-2">
              Abertura → início da triagem · abertura → início efetivo da execução · início efetivo →
              conclusão. Baseados em {dados.desempenho.marcos.chamados_triados} chamados triados e{' '}
              {dados.desempenho.marcos.chamados_iniciados} iniciados no período.
            </p>
          </div>

          <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-4">
            <div>
              <h2 className="font-medium text-navy">Cumprimento de prazo</h2>
              <p className="text-xs text-tinta-2">
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
                      ? 'text-sucesso'
                      : 'text-erro'
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
                destaque={dados.desempenho.prazo.em_aberto_atrasados > 0 ? 'text-erro' : 'text-sucesso'}
              />
            </div>

            <div>
              <h3 className="text-sm font-medium text-navy mb-2">Prazos por prioridade</h3>
              <div className="flex flex-wrap gap-4">
                {dados.sla.map((s) => (
                  <label key={s.prioridade} className="text-sm grid gap-1">
                    <span className="text-tinta-2">
                      {rotuloPrioridade(s.prioridade)}
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
                      <select
                        aria-label={`Contagem do prazo ${rotuloPrioridade(s.prioridade)}`}
                        value={s.contagem ?? 'corridas'}
                        onChange={(e) => alterarSla(s.prioridade, { contagem: e.target.value })}
                        className="border rounded px-2 py-1 text-xs"
                      >
                        <option value="corridas">horas corridas</option>
                        <option value="uteis">horas úteis</option>
                      </select>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-tinta-2 mt-2">
                Alterar o prazo vale para chamados abertos daqui em diante; os já existentes mantêm o
                prazo com que nasceram. Horas úteis contam só o expediente, fora dos feriados —{' '}
                <Link to="/cadastros?aba=expediente" className="text-navy underline">
                  ajustar expediente e feriados
                </Link>
                .
              </p>
              <HistoricoDoSla versao={alteracoesDeSla} />
            </div>
          </div>

          {preventiva && preventiva.totais.previstas > 0 && (
            <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-4 min-w-0">
              <div>
                <h2 className="font-medium text-navy">Manutenção preventiva</h2>
                <p className="text-xs text-tinta-2">
                  O período aqui é o da data prevista pelo plano. O cumprimento conta só o que já pode
                  ser julgado: concluídas e vencidas; as que ainda estão no prazo ficam de fora.
                </p>
              </div>
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                <Cartao
                  rotulo="Cumprimento do plano"
                  valor={
                    preventiva.percentual_cumprimento === null
                      ? '—'
                      : `${preventiva.percentual_cumprimento}%`
                  }
                  destaque={
                    preventiva.percentual_cumprimento === null
                      ? undefined
                      : preventiva.percentual_cumprimento >= 80
                        ? 'text-sucesso'
                        : 'text-erro'
                  }
                />
                <Cartao rotulo="Previstas" valor={preventiva.totais.previstas} />
                <Cartao
                  rotulo="Feitas em dia"
                  valor={preventiva.totais.concluidas_no_prazo}
                  destaque="text-sucesso"
                />
                <Cartao
                  rotulo="Vencidas sem fazer"
                  valor={preventiva.totais.vencidas_pendentes}
                  destaque={preventiva.totais.vencidas_pendentes > 0 ? 'text-erro' : 'text-sucesso'}
                />
              </div>
              {preventiva.planos_com_atraso.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-navy mb-2">Planos com execução vencida</h3>
                  <ul className="grid gap-1 text-sm">
                    {preventiva.planos_com_atraso.map((p) => (
                      <li key={p.id} className="flex flex-wrap justify-between gap-2">
                        <span>{p.titulo}</span>
                        <span className="text-erro text-xs">
                          {p.vencidas_pendentes} vencida(s), desde {formatarDia(p.mais_antiga)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {preventiva.equipamentos_com_mais_corretivos.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-navy mb-2">
                    Equipamentos com mais corretivos no período
                  </h3>
                  <ul className="grid gap-1 text-sm">
                    {preventiva.equipamentos_com_mais_corretivos.map((e) => (
                      <li key={e.id} className="flex flex-wrap justify-between gap-2">
                        <Link to={`/equipamentos/${e.id}`} className="text-navy hover:underline">
                          {e.codigo} — {e.nome}
                        </Link>
                        <span className="text-xs text-tinta-2">
                          {e.corretivos} corretivo(s)
                          {!e.tem_plano && ' · sem plano preventivo'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* min-w-0: o cartão é item de grid, e sem isso a tabela larga
              vazava para fora em vez de rolar dentro do overflow-x-auto,
              levando a página inteira junto no celular. */}
          <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6 min-w-0">
            <h2 className="font-medium text-navy mb-3">Carga por técnico</h2>
            <Tabela
              legenda="Carga de chamados por técnico no período"
              ordenavel
              chaveDaLinha={(t) => t.tecnico_id}
              linhas={dados.tecnicos}
              vazio={
                <p className="text-sm text-tinta-2">Nenhum chamado atribuído no período.</p>
              }
              colunas={[
                { chave: 'nome', rotulo: 'Técnico', principal: true },
                { chave: 'atribuidos', rotulo: 'Atribuídos', numerica: true },
                { chave: 'concluidos', rotulo: 'Concluídos', numerica: true },
                { chave: 'em_aberto', rotulo: 'Em aberto', numerica: true },
                {
                  chave: 'tempo_medio_segundos',
                  rotulo: 'Tempo médio',
                  numerica: true,
                  conteudo: (t) => formatarDuracao(t.tempo_medio_segundos),
                },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default Relatorios;

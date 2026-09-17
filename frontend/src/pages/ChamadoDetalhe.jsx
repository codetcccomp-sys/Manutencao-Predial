import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

// Escalas e perguntas orientadoras conforme o §2.5 do Termo de Abertura. As
// perguntas ficam visíveis de propósito: são elas que tornam a nota menos
// subjetiva e comparável entre gestores diferentes.
const FATORES = [
  {
    campo: 'urgencia',
    rotulo: 'Urgência',
    pergunta: 'Quanto tempo a demanda pode aguardar sem agravar o problema?',
    escala: ['1 — baixa', '2 — moderada', '3 — alta', '4 — imediata'],
  },
  {
    campo: 'impacto',
    rotulo: 'Impacto',
    pergunta: 'Quantos ambientes, usuários ou atividades são afetados?',
    escala: ['1 — localizado', '2 — setorial', '3 — amplo no bloco', '4 — amplo'],
  },
  {
    campo: 'risco',
    rotulo: 'Risco',
    pergunta: 'Há risco relevante à segurança, operação ou patrimônio?',
    escala: ['1 — mínimo', '2 — moderado', '3 — alto', '4 — grave'],
  },
];

const PRIORIDADE_LABEL = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  critica: 'Crítica',
};

const PRIORIDADES = Object.keys(PRIORIDADE_LABEL);

const ESTADO_LABEL = {
  aberto: 'Aberto',
  em_triagem: 'Em triagem',
  atribuido: 'Atribuído',
  em_andamento: 'Em andamento',
  aguardando_material: 'Aguardando material',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

const PROXIMOS_ESTADOS = {
  aberto: ['em_triagem', 'cancelado'],
  em_triagem: ['atribuido', 'cancelado'],
  atribuido: ['em_andamento', 'cancelado'],
  em_andamento: ['aguardando_material', 'concluido', 'cancelado'],
  aguardando_material: ['em_andamento', 'cancelado'],
  concluido: [],
  cancelado: [],
};

function ChamadoDetalhe() {
  const { id } = useParams();
  const { usuario } = useAuth();
  const [chamado, setChamado] = useState(null);
  const [erro, setErro] = useState('');
  const [tecnicoId, setTecnicoId] = useState('');
  const [tecnicos, setTecnicos] = useState([]);
  const [nota, setNota] = useState(5);
  const [anexos, setAnexos] = useState([]);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [fatores, setFatores] = useState({ urgencia: '', impacto: '', risco: '' });
  const [sugestao, setSugestao] = useState(null);
  const [prioridadeEscolhida, setPrioridadeEscolhida] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [diagnostico, setDiagnostico] = useState('');
  const [tempoEmpregado, setTempoEmpregado] = useState('');
  const [concluindo, setConcluindo] = useState(false);
  const [servicoRealizado, setServicoRealizado] = useState('');

  const podeGerenciar = ['administrador', 'gestor'].includes(usuario.perfil);

  const carregar = useCallback(() => {
    api
      .get(`/chamados/${id}`)
      .then(({ data }) => {
        setChamado(data.chamado);
        // Reabre o painel já preenchido quando o chamado foi priorizado antes:
        // repriorizar é revisar a avaliação anterior, não começar do zero.
        if (data.chamado.urgencia) {
          setFatores({
            urgencia: String(data.chamado.urgencia),
            impacto: String(data.chamado.impacto),
            risco: String(data.chamado.risco),
          });
        }
        setDiagnostico(data.chamado.diagnostico ?? '');
        setTempoEmpregado(
          data.chamado.tempo_empregado_minutos ? String(data.chamado.tempo_empregado_minutos) : ''
        );
      })
      .catch(() => setErro('Não foi possível carregar o chamado.'));
  }, [id]);

  const carregarAnexos = useCallback(() => {
    api
      .get(`/chamados/${id}/anexos`)
      .then(({ data }) => setAnexos(data.anexos))
      .catch(() => setErro('Não foi possível carregar os anexos.'));
  }, [id]);

  useEffect(() => {
    carregar();
    carregarAnexos();
  }, [carregar, carregarAnexos]);

  // Só administrador e gestor atribuem chamados — e só eles têm permissão de
  // listar usuários, então a busca fica condicionada ao perfil.
  useEffect(() => {
    if (!podeGerenciar) return;
    api
      .get('/usuarios', { params: { perfil: 'tecnico' } })
      .then(({ data }) => setTecnicos(data.usuarios))
      .catch(() => setErro('Não foi possível carregar a lista de técnicos.'));
  }, [podeGerenciar]);

  async function mudarEstado(estado, extras = {}) {
    setErro('');
    try {
      await api.patch(`/chamados/${id}/estado`, { estado, ...extras });
      setConcluindo(false);
      setServicoRealizado('');
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível atualizar o estado.');
    }
  }

  // Concluir não é um botão só: a RN07 exige a descrição do serviço, então a
  // ação abre o campo em vez de tentar fechar o chamado e falhar no servidor.
  function acionarEstado(estado) {
    if (estado === 'concluido') {
      setConcluindo(true);
      return;
    }
    mudarEstado(estado);
  }

  async function salvarExecucao(e) {
    e.preventDefault();
    setErro('');
    try {
      await api.patch(`/chamados/${id}/execucao`, {
        diagnostico: diagnostico.trim(),
        ...(tempoEmpregado ? { tempo_empregado_minutos: Number(tempoEmpregado) } : {}),
      });
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível registrar a execução.');
    }
  }

  async function atribuir(e) {
    e.preventDefault();
    setErro('');
    try {
      await api.patch(`/chamados/${id}/atribuir`, { tecnico_id: Number(tecnicoId) });
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível atribuir o chamado.');
    }
  }

  async function avaliar(e) {
    e.preventDefault();
    setErro('');
    try {
      await api.post(`/chamados/${id}/avaliacao`, { nota: Number(nota) });
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível registrar a avaliação.');
    }
  }

  // A sugestão é calculada no servidor, com a regra vigente: reproduzir a
  // fórmula aqui criaria duas verdades que divergem na primeira recalibração.
  useEffect(() => {
    const completos = FATORES.every((f) => fatores[f.campo] !== '');
    if (!podeGerenciar || !completos) {
      setSugestao(null);
      return;
    }

    let cancelado = false;
    api
      .post('/regras-priorizacao/simular', {
        urgencia: Number(fatores.urgencia),
        impacto: Number(fatores.impacto),
        risco: Number(fatores.risco),
      })
      .then(({ data }) => {
        if (cancelado) return;
        setSugestao(data);
        setPrioridadeEscolhida(data.prioridade);
      })
      .catch(() => {
        if (!cancelado) setSugestao(null);
      });

    return () => {
      cancelado = true;
    };
  }, [fatores, podeGerenciar]);

  async function priorizar(e) {
    e.preventDefault();
    setErro('');
    try {
      await api.patch(`/chamados/${id}/priorizacao`, {
        urgencia: Number(fatores.urgencia),
        impacto: Number(fatores.impacto),
        risco: Number(fatores.risco),
        prioridade: prioridadeEscolhida,
        ...(justificativa.trim() ? { justificativa: justificativa.trim() } : {}),
      });
      setJustificativa('');
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível registrar a priorização.');
    }
  }

  async function enviarAnexo(e) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;

    setErro('');
    setEnviandoAnexo(true);
    const dados = new FormData();
    dados.append('arquivo', arquivo);

    try {
      await api.post(`/chamados/${id}/anexos`, dados);
      carregarAnexos();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível enviar o anexo.');
    } finally {
      setEnviandoAnexo(false);
      // Limpa o input para que escolher o mesmo arquivo de novo dispare
      // outro onChange.
      e.target.value = '';
    }
  }

  // O download precisa do cabeçalho de autorização, então não dá para usar um
  // link direto: busca pelo axios e entrega o blob ao navegador.
  async function baixarAnexo(anexo) {
    setErro('');
    try {
      const { data } = await api.get(`/chamados/${id}/anexos/${anexo.id}/conteudo`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = anexo.nome_arquivo;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setErro('Não foi possível baixar o anexo.');
    }
  }

  async function removerAnexo(anexoId) {
    setErro('');
    try {
      await api.delete(`/chamados/${id}/anexos/${anexoId}`);
      carregarAnexos();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível remover o anexo.');
    }
  }

  function formatarTamanho(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  if (!chamado) {
    return erro ? (
      <div className="bg-red-50 text-red-700 text-sm rounded p-3">{erro}</div>
    ) : (
      <p className="text-gray-500 text-sm">Carregando...</p>
    );
  }

  const podeMudarEstado = podeGerenciar || chamado.tecnico_id === usuario.id;
  const podeAvaliar = usuario.perfil === 'solicitante' && chamado.estado === 'concluido';

  return (
    <div className="grid gap-6">
      {erro && <div className="bg-red-50 text-red-700 text-sm rounded p-3">{erro}</div>}

      <div className="bg-white rounded-lg shadow-sm p-6">
        <p className="text-xs text-gray-500">{chamado.protocolo}</p>
        <h2 className="text-lg font-bold text-navy mb-2">{chamado.titulo}</h2>
        <p className="text-sm text-gray-700 mb-4">{chamado.descricao}</p>
        <div className="text-sm grid grid-cols-2 gap-2 text-gray-600">
          <span>
            Estado: <strong>{ESTADO_LABEL[chamado.estado] ?? chamado.estado}</strong>
          </span>
          <span>
            Prioridade: <strong>{PRIORIDADE_LABEL[chamado.prioridade] ?? chamado.prioridade}</strong>
          </span>
          {chamado.prazo_estimado && (
            <span className="col-span-2">
              Prazo:{' '}
              <strong className={chamado.em_atraso ? 'text-red-700' : ''}>
                {new Date(chamado.prazo_estimado).toLocaleString('pt-BR')}
              </strong>
              {chamado.em_atraso && (
                <span className="ml-2 text-xs font-medium px-2 py-1 rounded bg-red-100 text-red-700">
                  Em atraso
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Chamado encerrado vira registro: o que foi apurado e feito precisa
          continuar visível para quem consultar o histórico depois. */}
      {(chamado.diagnostico || chamado.servico_realizado) && (
        <div className="bg-white rounded-lg shadow-sm p-6 grid gap-3 text-sm">
          <h3 className="font-medium text-navy">Registro do atendimento</h3>
          {chamado.diagnostico && (
            <div>
              <p className="text-gray-600 text-xs uppercase tracking-wide">Diagnóstico</p>
              <p className="text-gray-800 whitespace-pre-line">{chamado.diagnostico}</p>
            </div>
          )}
          {chamado.servico_realizado && (
            <div>
              <p className="text-gray-600 text-xs uppercase tracking-wide">Serviço executado</p>
              <p className="text-gray-800 whitespace-pre-line">{chamado.servico_realizado}</p>
            </div>
          )}
          {chamado.tempo_empregado_minutos && (
            <p className="text-gray-600">
              Tempo empregado: <strong>{chamado.tempo_empregado_minutos} min</strong>
            </p>
          )}
        </div>
      )}

      {podeGerenciar && !['concluido', 'cancelado'].includes(chamado.estado) && (
        <form onSubmit={priorizar} className="bg-white rounded-lg shadow-sm p-6 grid gap-4">
          <div>
            <h3 className="font-medium text-navy">Priorização</h3>
            <p className="text-xs text-gray-500">
              Registre os três fatores; o sistema sugere a prioridade pela regra vigente. Você pode
              decidir diferente, mas aí a exceção precisa ser justificada.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {FATORES.map((f) => (
              <label key={f.campo} className="grid gap-1 text-sm">
                <span className="text-gray-700 font-medium">{f.rotulo}</span>
                <span className="text-xs text-gray-500 min-h-[2.5rem]">{f.pergunta}</span>
                <select
                  required
                  value={fatores[f.campo]}
                  onChange={(e) => setFatores({ ...fatores, [f.campo]: e.target.value })}
                  className="border rounded px-3 py-2"
                >
                  <option value="">Selecione</option>
                  {f.escala.map((rotulo, i) => (
                    <option key={rotulo} value={i + 1}>
                      {rotulo}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {sugestao && (
            <div className="bg-[#EEF1F5] rounded p-3 text-sm grid gap-1">
              <span>
                Sugestão:{' '}
                <strong>{PRIORIDADE_LABEL[sugestao.prioridade] ?? sugestao.prioridade}</strong>{' '}
                <span className="text-gray-500">(pontuação {sugestao.pontuacao})</span>
              </span>
              <span className="text-xs text-gray-600">{sugestao.motivo}</span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-gray-700 font-medium">Prioridade registrada</span>
              <select
                value={prioridadeEscolhida}
                onChange={(e) => setPrioridadeEscolhida(e.target.value)}
                disabled={!sugestao}
                className="border rounded px-3 py-2 disabled:opacity-50"
              >
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORIDADE_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>

            {sugestao && prioridadeEscolhida !== sugestao.prioridade && (
              <label className="grid gap-1 text-sm">
                <span className="text-gray-700 font-medium">Justificativa da exceção</span>
                <textarea
                  required
                  minLength={10}
                  rows={2}
                  value={justificativa}
                  onChange={(e) => setJustificativa(e.target.value)}
                  placeholder="Por que a prioridade difere da sugerida?"
                  className="border rounded px-3 py-2"
                />
              </label>
            )}
          </div>

          <button
            disabled={!sugestao}
            className="bg-navy text-white rounded py-2 font-medium hover:bg-navy-2 disabled:opacity-50 justify-self-start px-6"
          >
            Registrar priorização
          </button>

          {chamado.priorizado_em && (
            <p className="text-xs text-gray-500">
              Última priorização em {new Date(chamado.priorizado_em).toLocaleString('pt-BR')}
              {chamado.prioridade_sugerida &&
                chamado.prioridade !== chamado.prioridade_sugerida &&
                ` — sugerida "${PRIORIDADE_LABEL[chamado.prioridade_sugerida]}", registrada "${PRIORIDADE_LABEL[chamado.prioridade]}"`}
              .
            </p>
          )}
        </form>
      )}

      {podeGerenciar && chamado.estado === 'em_triagem' && (
        <form onSubmit={atribuir} className="bg-white rounded-lg shadow-sm p-6 grid gap-3">
          <h3 className="font-medium text-navy">Atribuir técnico</h3>
          {tecnicos.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nenhum técnico cadastrado. Cadastre um usuário com perfil técnico para poder atribuir.
            </p>
          ) : (
            <>
              <select
                required
                value={tecnicoId}
                onChange={(e) => setTecnicoId(e.target.value)}
                className="border rounded px-3 py-2"
              >
                <option value="">Selecione o técnico</option>
                {tecnicos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome} — {t.email}
                  </option>
                ))}
              </select>
              <button className="bg-navy text-white rounded py-2 font-medium hover:bg-navy-2">
                Atribuir
              </button>
            </>
          )}
        </form>
      )}

      {podeMudarEstado && !['concluido', 'cancelado'].includes(chamado.estado) && (
        <form onSubmit={salvarExecucao} className="bg-white rounded-lg shadow-sm p-6 grid gap-3">
          <h3 className="font-medium text-navy">Execução</h3>

          <label className="grid gap-1 text-sm">
            <span className="text-gray-600">Diagnóstico</span>
            <textarea
              rows={3}
              value={diagnostico}
              onChange={(e) => setDiagnostico(e.target.value)}
              placeholder="O que foi constatado no local"
              className="border rounded px-3 py-2"
            />
          </label>

          <label className="grid gap-1 text-sm max-w-xs">
            <span className="text-gray-600">Tempo empregado (minutos)</span>
            <input
              type="number"
              min={1}
              value={tempoEmpregado}
              onChange={(e) => setTempoEmpregado(e.target.value)}
              className="border rounded px-3 py-2"
            />
          </label>

          <button className="bg-navy text-white rounded py-2 font-medium hover:bg-navy-2 justify-self-start px-6">
            Salvar execução
          </button>
        </form>
      )}

      {podeMudarEstado && PROXIMOS_ESTADOS[chamado.estado]?.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm p-6 grid gap-3">
          <h3 className="font-medium text-navy">Mudar estado</h3>
          <div className="flex flex-wrap gap-2">
            {PROXIMOS_ESTADOS[chamado.estado].map((estado) => (
              <button
                key={estado}
                onClick={() => acionarEstado(estado)}
                className="bg-amber text-white text-sm rounded px-3 py-2 hover:opacity-90"
              >
                {ESTADO_LABEL[estado] ?? estado}
              </button>
            ))}
          </div>

          {concluindo && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                mudarEstado('concluido', { servico_realizado: servicoRealizado.trim() });
              }}
              className="grid gap-2 border-t pt-3"
            >
              <label className="grid gap-1 text-sm">
                <span className="text-gray-700 font-medium">Descrição do serviço executado</span>
                <span className="text-xs text-gray-500">
                  Obrigatória para concluir (RN07). Registre o que foi feito, não apenas que foi
                  resolvido.
                </span>
                <textarea
                  required
                  minLength={10}
                  rows={3}
                  autoFocus
                  value={servicoRealizado}
                  onChange={(e) => setServicoRealizado(e.target.value)}
                  className="border rounded px-3 py-2"
                />
              </label>
              <div className="flex gap-2">
                <button className="bg-navy text-white rounded px-4 py-2 text-sm font-medium hover:bg-navy-2">
                  Concluir chamado
                </button>
                <button
                  type="button"
                  onClick={() => setConcluindo(false)}
                  className="text-sm text-gray-600 hover:underline"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {podeAvaliar && (
        <form onSubmit={avaliar} className="bg-white rounded-lg shadow-sm p-6 grid gap-3">
          <h3 className="font-medium text-navy">Avaliar atendimento</h3>
          <select value={nota} onChange={(e) => setNota(e.target.value)} className="border rounded px-3 py-2">
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>{n} estrela(s)</option>
            ))}
          </select>
          <button className="bg-navy text-white rounded py-2 font-medium hover:bg-navy-2">
            Enviar avaliação
          </button>
        </form>
      )}

      <div className="bg-white rounded-lg shadow-sm p-6 grid gap-3">
        <h3 className="font-medium text-navy">Anexos</h3>

        {anexos.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum anexo neste chamado.</p>
        ) : (
          <ul className="grid gap-2">
            {anexos.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 border rounded px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <button
                    onClick={() => baixarAnexo(a)}
                    className="text-navy font-medium hover:underline truncate block max-w-full text-left"
                  >
                    {a.nome_arquivo}
                  </button>
                  <span className="text-xs text-gray-500">
                    {formatarTamanho(a.tamanho_bytes)} · {a.usuario_nome} ·{' '}
                    {new Date(a.data_upload).toLocaleString('pt-BR')}
                  </span>
                </div>
                {(podeGerenciar || a.usuario_id === usuario.id) && (
                  <button
                    onClick={() => removerAnexo(a.id)}
                    className="text-xs text-red-600 hover:underline shrink-0"
                  >
                    Remover
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <label className="text-sm">
          <span className="text-gray-600">
            {enviandoAnexo ? 'Enviando...' : 'Adicionar anexo (JPEG, PNG, WebP ou PDF, até 4 MB)'}
          </span>
          <input
            type="file"
            onChange={enviarAnexo}
            disabled={enviandoAnexo}
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="mt-1 block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-navy file:px-3 file:py-2 file:text-white hover:file:bg-navy-2 disabled:opacity-50"
          />
        </label>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="font-medium text-navy mb-3">Histórico</h3>
        <ul className="grid gap-2 text-sm text-gray-600">
          {chamado.historico?.map((h) => (
            <li key={h.id} className="border-l-2 border-amber pl-3">
              <strong>{h.estado_novo}</strong> — {new Date(h.data).toLocaleString('pt-BR')}
              {h.observacao && <p className="text-gray-500">{h.observacao}</p>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default ChamadoDetalhe;

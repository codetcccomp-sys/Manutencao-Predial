import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { BadgeAtraso, BadgeEstado, BadgePrioridade } from '../components/ui/Badge';
import Aviso from '../components/ui/Aviso';
import Confirmacao from '../components/ui/Confirmacao';
import {
  ORDEM_PRIORIDADES,
  rotuloEstado,
  rotuloPrioridade,
} from '../dominio/rotulos';
import { LIMITE_BYTES, formatarTamanho, prepararAnexo } from '../dominio/prepararAnexo';

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

// Os rótulos vinham repetidos aqui, no painel e no relatório — três cópias,
// com ordens diferentes. Agora saem de dominio/rotulos.js.
const PRIORIDADES = ORDEM_PRIORIDADES;

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
  // null, 'preparando' (reduzindo a foto) ou 'enviando'.
  const [enviandoAnexo, setEnviandoAnexo] = useState(null);
  const [fatores, setFatores] = useState({ urgencia: '', impacto: '', risco: '' });
  const [sugestao, setSugestao] = useState(null);
  const [prioridadeEscolhida, setPrioridadeEscolhida] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [diagnostico, setDiagnostico] = useState('');
  const [tempoEmpregado, setTempoEmpregado] = useState('');
  const [concluindo, setConcluindo] = useState(false);
  const [servicoRealizado, setServicoRealizado] = useState('');
  const [justificativaAtribuicao, setJustificativaAtribuicao] = useState('');
  const [justificativaReabertura, setJustificativaReabertura] = useState('');
  const [comentarios, setComentarios] = useState([]);
  const [novoComentario, setNovoComentario] = useState('');
  const [enviandoComentario, setEnviandoComentario] = useState(false);
  const [editando, setEditando] = useState(false);
  const [edicao, setEdicao] = useState(null);
  const [categorias, setCategorias] = useState([]);
  const [locais, setLocais] = useState([]);
  const [confirmacao, setConfirmacao] = useState(null);
  const [confirmando, setConfirmando] = useState(false);

  const podeGerenciar = ['administrador', 'gestor'].includes(usuario.perfil);

  const carregar = useCallback(() => {
    // Devolve a promessa: quem chama na montagem precisa saber se o chamado
    // carregou antes de pedir anexos e comentários.
    return api
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
      .then(() => true)
      .catch(() => {
        setErro('Não foi possível carregar o chamado.');
        // Devolve false em vez de rejeitar: `carregar` é chamado solto depois
        // de cada ação da tela, e uma rejeição ali viraria erro não tratado.
        return false;
      });
  }, [id]);

  const carregarAnexos = useCallback(() => {
    api
      .get(`/chamados/${id}/anexos`)
      .then(({ data }) => setAnexos(data.anexos))
      .catch(() => setErro('Não foi possível carregar os anexos.'));
  }, [id]);

  const carregarComentarios = useCallback(() => {
    api
      .get(`/chamados/${id}/comentarios`)
      .then(({ data }) => setComentarios(data.comentarios))
      .catch(() => setErro('Não foi possível carregar os comentários.'));
  }, [id]);

  useEffect(() => {
    // Anexos e comentários só depois do chamado, e não em paralelo. Quem não
    // pode ler o chamado também não pode ler o resto: as três chamadas
    // falhariam juntas, e a última a responder deixava na tela "não foi
    // possível carregar os anexos" — uma explicação errada para um acesso
    // negado ao chamado. Duas requisições a menos, de quebra.
    carregar().then((carregou) => {
      if (!carregou) return;
      carregarAnexos();
      carregarComentarios();
    });
  }, [carregar, carregarAnexos, carregarComentarios]);

  // Só administrador e gestor atribuem chamados — e só eles têm permissão de
  // listar usuários, então a busca fica condicionada ao perfil.
  useEffect(() => {
    if (!podeGerenciar) return;
    api
      .get('/usuarios', { params: { perfil: 'tecnico' } })
      .then(({ data }) => setTecnicos(data.usuarios))
      .catch(() => setErro('Não foi possível carregar a lista de técnicos.'));
  }, [podeGerenciar]);

  // Categoria e local só interessam a quem vai de fato editar: carregar as
  // duas listas em toda visita custaria duas consultas por chamado aberto.
  function abrirEdicao() {
    setErro('');
    setEdicao({
      titulo: chamado.titulo,
      descricao: chamado.descricao,
      categoria_id: String(chamado.categoria_id ?? ''),
      local_id: String(chamado.local_id ?? ''),
    });
    setEditando(true);

    if (categorias.length === 0 || locais.length === 0) {
      Promise.all([api.get('/categorias'), api.get('/locais')])
        .then(([c, l]) => {
          setCategorias(c.data.categorias);
          setLocais(l.data.locais);
        })
        .catch(() => setErro('Não foi possível carregar categorias e locais.'));
    }
  }

  async function salvarEdicao(e) {
    e.preventDefault();
    setErro('');
    try {
      await api.patch(`/chamados/${id}`, {
        titulo: edicao.titulo.trim(),
        descricao: edicao.descricao.trim(),
        categoria_id: Number(edicao.categoria_id),
        local_id: Number(edicao.local_id),
      });
      setEditando(false);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível salvar a correção.');
    }
  }

  async function comentar(e) {
    e.preventDefault();
    setErro('');
    setEnviandoComentario(true);
    try {
      const { data } = await api.post(`/chamados/${id}/comentarios`, {
        texto: novoComentario.trim(),
      });
      // Acrescenta o que voltou do servidor em vez de recarregar a lista: o
      // servidor é quem define id, data e autor, e recarregar perderia o
      // texto se a rede falhasse no meio.
      setComentarios((atuais) => [...atuais, data.comentario]);
      setNovoComentario('');
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível enviar o comentário.');
    } finally {
      setEnviandoComentario(false);
    }
  }

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
    // §2.4: "cancelado" não tem estado seguinte. Diferente de "concluído", que
    // aceita reabertura em 48h (RN09), cancelar encerra o chamado para sempre
    // — e o botão fica encostado nos outros, numa tela de celular.
    if (estado === 'cancelado') {
      setConfirmacao({
        titulo: 'Cancelar este chamado?',
        descricao:
          'O chamado sai do fluxo e não pode ser reaberto. Se o serviço ainda for necessário, será preciso abrir um chamado novo.',
        rotulo: 'Cancelar o chamado',
        executar: () => mudarEstado('cancelado'),
      });
      return;
    }
    mudarEstado(estado);
  }

  // A ação destrutiva pendente de confirmação. `null` quando não há diálogo.
  async function confirmar() {
    setConfirmando(true);
    try {
      await confirmacao.executar();
      setConfirmacao(null);
    } finally {
      setConfirmando(false);
    }
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
      await api.patch(`/chamados/${id}/atribuir`, {
        tecnico_id: Number(tecnicoId),
        ...(ehReatribuicao ? { justificativa: justificativaAtribuicao.trim() } : {}),
      });
      setJustificativaAtribuicao('');
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível atribuir o chamado.');
    }
  }

  async function reabrir(e) {
    e.preventDefault();
    setErro('');
    try {
      await api.post(`/chamados/${id}/reabertura`, { justificativa: justificativaReabertura.trim() });
      setJustificativaReabertura('');
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível reabrir o chamado.');
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
    const escolhido = e.target.files?.[0];
    if (!escolhido) return;

    setErro('');
    setEnviandoAnexo('preparando');

    try {
      const arquivo = await prepararAnexo(escolhido);
      // Só chega aqui acima do limite o que não é foto (um PDF grande) ou uma
      // foto que o navegador não conseguiu reduzir. Avisar antes de mandar
      // poupa a espera de um envio que o servidor recusaria de qualquer jeito.
      if (arquivo.size > LIMITE_BYTES) {
        setErro(
          `"${arquivo.name}" tem ${formatarTamanho(arquivo.size)}; o limite é ${formatarTamanho(LIMITE_BYTES)}.`
        );
        return;
      }

      setEnviandoAnexo('enviando');
      const dados = new FormData();
      dados.append('arquivo', arquivo);
      await api.post(`/chamados/${id}/anexos`, dados);
      carregarAnexos();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível enviar o anexo.');
    } finally {
      setEnviandoAnexo(null);
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

  if (!chamado) {
    return erro ? (
      <Aviso tipo="erro">{erro}</Aviso>
    ) : (
      <p className="text-tinta-2 text-sm">Carregando...</p>
    );
  }

  const podeMudarEstado = podeGerenciar || chamado.tecnico_id === usuario.id;
  // RN05: cancelar é da gestão. O técnico vê só os passos do próprio
  // trabalho; o servidor recusa o resto de qualquer jeito, e oferecer o botão
  // seria convidar a um 403.
  const proximosEstados = (PROXIMOS_ESTADOS[chamado.estado] || []).filter(
    (estado) => podeGerenciar || estado !== 'cancelado'
  );
  const podeAvaliar = usuario.perfil === 'solicitante' && chamado.estado === 'concluido';

  // Estados em que o chamado já tem responsável: distribuir de novo é
  // reatribuição, que a RF05 manda justificar.
  const ehReatribuicao = ['atribuido', 'em_andamento', 'aguardando_material'].includes(chamado.estado);
  const podeDistribuir = podeGerenciar && (chamado.estado === 'em_triagem' || ehReatribuicao);

  // Quem já está no chamado não é opção de reatribuição; o servidor recusa a
  // troca para o mesmo técnico, e oferecer a opção seria convidar ao erro.
  const tecnicosDisponiveis = tecnicos.filter((t) => t.id !== chamado.tecnico_id);

  // RN09: a janela de 48 horas é conferida no servidor; aqui ela apenas
  // decide se vale mostrar o formulário, para não oferecer uma ação que já
  // seria recusada.
  const horasDesdeConclusao = chamado.data_conclusao
    ? (Date.now() - new Date(chamado.data_conclusao).getTime()) / 3_600_000
    : null;
  // RN03: o solicitante corrige o que escreveu enquanto o chamado não saiu da
  // triagem; depois disso o texto já orientou a distribuição, e mudá-lo é ação
  // da gestão. O servidor confere de novo — aqui é só para não oferecer um
  // botão que seria recusado.
  const encerrado = ['concluido', 'cancelado'].includes(chamado.estado);
  const podeEditar =
    !encerrado &&
    (podeGerenciar ||
      (chamado.solicitante_id === usuario.id &&
        ['aberto', 'em_triagem'].includes(chamado.estado)));

  const podeReabrir =
    chamado.estado === 'concluido' &&
    horasDesdeConclusao !== null &&
    horasDesdeConclusao <= 48 &&
    (podeGerenciar || chamado.solicitante_id === usuario.id);

  return (
    <div className="grid gap-6">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6">
        <p className="text-xs text-tinta-2">{chamado.protocolo}</p>

        {editando && edicao ? (
          <form onSubmit={salvarEdicao} className="grid gap-3 mt-2 mb-4">
            <label className="grid gap-1 text-sm">
              <span className="text-tinta-2">Título</span>
              <input
                type="text"
                required
                minLength={5}
                value={edicao.titulo}
                onChange={(e) => setEdicao({ ...edicao, titulo: e.target.value })}
                className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-tinta-2">Descrição</span>
              <textarea
                required
                minLength={10}
                rows={4}
                value={edicao.descricao}
                onChange={(e) => setEdicao({ ...edicao, descricao: e.target.value })}
                className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-tinta-2">Categoria</span>
                <select
                  required
                  value={edicao.categoria_id}
                  onChange={(e) => setEdicao({ ...edicao, categoria_id: e.target.value })}
                  className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
                >
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-tinta-2">Local</span>
                <select
                  required
                  value={edicao.local_id}
                  onChange={(e) => setEdicao({ ...edicao, local_id: e.target.value })}
                  className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
                >
                  {locais.map((l) => (
                    <option key={l.id} value={l.id}>
                      {[l.unidade, l.bloco, l.pavimento, l.setor, l.ambiente]
                        .filter(Boolean)
                        .join(' / ')}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex gap-3 items-center">
              <button className="alvo-toque inline-flex items-center justify-center rounded bg-navy px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-2">
                Salvar correção
              </button>
              <button
                type="button"
                onClick={() => setEditando(false)}
                className="text-sm text-tinta-2 hover:underline"
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 mb-2">
              <h1 className="text-lg font-bold text-navy">{chamado.titulo}</h1>
              {podeEditar && (
                <button
                  onClick={abrirEdicao}
                  className="text-sm text-navy hover:underline shrink-0"
                >
                  Corrigir
                </button>
              )}
            </div>
            <p className="text-sm text-tinta mb-4 whitespace-pre-line">{chamado.descricao}</p>
          </>
        )}

        {/* Estado, prioridade e atraso eram texto em negrito aqui e badge no
            painel: o mesmo campo, dois desenhos, conforme a tela. Agora saem
            dos mesmos componentes — e a prioridade, que era invisível como
            informação, ganha a mesma leitura rápida do estado. */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <BadgeEstado estado={chamado.estado} />
          <BadgePrioridade prioridade={chamado.prioridade} />
          {chamado.em_atraso && <BadgeAtraso />}
        </div>

        <div className="text-sm grid grid-cols-2 gap-2 text-tinta-2">
          {/* Onde e de que tipo: é a primeira coisa que o técnico designado
              precisa saber, e era o que faltava — o local só aparecia no
              relatório e na planilha, não na tela por onde se trabalha. */}
          {chamado.local_rotulo && (
            <span className="col-span-2 min-w-0">
              Local: <strong className="text-navy">{chamado.local_rotulo}</strong>
            </span>
          )}
          {chamado.categoria_nome && (
            <span className="col-span-2">
              Categoria: <strong>{chamado.categoria_nome}</strong>
            </span>
          )}
          {chamado.total_reaberturas > 0 && (
            <span className="col-span-2 text-erro">
              Reaberto {chamado.total_reaberturas}{' '}
              {chamado.total_reaberturas === 1 ? 'vez' : 'vezes'} — está no ciclo{' '}
              {chamado.total_reaberturas + 1} de atendimento.
            </span>
          )}
          {chamado.prazo_estimado && (
            <span className="col-span-2">
              Prazo:{' '}
              {/* O badge de atraso já está no topo; aqui basta a data marcada,
                  senão a mesma informação aparece duas vezes na mesma tela. */}
              <strong className={chamado.em_atraso ? 'text-erro' : ''}>
                {new Date(chamado.prazo_estimado).toLocaleString('pt-BR')}
              </strong>
            </span>
          )}
        </div>
      </div>

      {/* Chamado encerrado vira registro: o que foi apurado e feito precisa
          continuar visível para quem consultar o histórico depois. */}
      {(chamado.diagnostico || chamado.servico_realizado) && (
        <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3 text-sm">
          <h2 className="font-medium text-navy">Registro do atendimento</h2>
          {chamado.diagnostico && (
            <div>
              <p className="text-tinta-2 text-xs uppercase tracking-wide">Diagnóstico</p>
              <p className="text-gray-800 whitespace-pre-line">{chamado.diagnostico}</p>
            </div>
          )}
          {chamado.servico_realizado && (
            <div>
              <p className="text-tinta-2 text-xs uppercase tracking-wide">Serviço executado</p>
              <p className="text-gray-800 whitespace-pre-line">{chamado.servico_realizado}</p>
            </div>
          )}
          {chamado.tempo_empregado_minutos && (
            <p className="text-tinta-2">
              Tempo empregado: <strong>{chamado.tempo_empregado_minutos} min</strong>
            </p>
          )}
        </div>
      )}

      {podeGerenciar && !['concluido', 'cancelado'].includes(chamado.estado) && (
        <form onSubmit={priorizar} className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-4">
          <div>
            <h2 className="font-medium text-navy">Priorização</h2>
            <p className="text-xs text-tinta-2">
              Registre os três fatores; o sistema sugere a prioridade pela regra vigente. Você pode
              decidir diferente, mas aí a exceção precisa ser justificada.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {FATORES.map((f) => (
              <label key={f.campo} className="grid gap-1 text-sm">
                <span className="text-tinta font-medium">{f.rotulo}</span>
                <span className="text-xs text-tinta-2 min-h-[2.5rem]">{f.pergunta}</span>
                <select
                  required
                  value={fatores[f.campo]}
                  onChange={(e) => setFatores({ ...fatores, [f.campo]: e.target.value })}
                  className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
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
            <div className="bg-fundo rounded p-3 text-sm grid gap-1">
              <span>
                Sugestão:{' '}
                <strong>{rotuloPrioridade(sugestao.prioridade)}</strong>{' '}
                <span className="text-tinta-2">(pontuação {sugestao.pontuacao})</span>
              </span>
              <span className="text-xs text-tinta-2">{sugestao.motivo}</span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-tinta font-medium">Prioridade registrada</span>
              <select
                value={prioridadeEscolhida}
                onChange={(e) => setPrioridadeEscolhida(e.target.value)}
                disabled={!sugestao}
                className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm disabled:bg-fundo"
              >
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {rotuloPrioridade(p)}
                  </option>
                ))}
              </select>
            </label>

            {sugestao && prioridadeEscolhida !== sugestao.prioridade && (
              <label className="grid gap-1 text-sm">
                <span className="text-tinta font-medium">Justificativa da exceção</span>
                <textarea
                  required
                  minLength={10}
                  rows={2}
                  value={justificativa}
                  onChange={(e) => setJustificativa(e.target.value)}
                  placeholder="Por que a prioridade difere da sugerida?"
                  className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
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
            <p className="text-xs text-tinta-2">
              Última priorização em {new Date(chamado.priorizado_em).toLocaleString('pt-BR')}
              {chamado.prioridade_sugerida &&
                chamado.prioridade !== chamado.prioridade_sugerida &&
                ` — sugerida "${rotuloPrioridade(chamado.prioridade_sugerida)}", registrada "${rotuloPrioridade(chamado.prioridade)}"`}
              .
            </p>
          )}
        </form>
      )}

      {podeReabrir && (
        <form onSubmit={reabrir} className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3">
          <div>
            <h2 className="font-medium text-navy">Reabrir chamado</h2>
            <p className="text-xs text-tinta-2">
              Disponível por 48 horas após a conclusão (RN09). A reabertura preserva todo o
              histórico e inicia um novo ciclo de atendimento, com prazo próprio.
            </p>
          </div>
          <textarea
            required
            minLength={10}
            rows={2}
            value={justificativaReabertura}
            onChange={(e) => setJustificativaReabertura(e.target.value)}
            placeholder="Por que o atendimento não resolveu?"
            className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
          />
          <button className="alvo-toque inline-flex items-center justify-center justify-self-start rounded bg-amber px-6 py-2.5 text-sm font-medium text-white transition-colors hover:opacity-90">
            Reabrir
          </button>
        </form>
      )}

      {podeDistribuir && (
        <form onSubmit={atribuir} className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3 min-w-0">
          <h2 className="font-medium text-navy">
            {ehReatribuicao ? 'Reatribuir técnico' : 'Atribuir técnico'}
          </h2>
          {ehReatribuicao && (
            <p className="text-xs text-tinta-2">
              O chamado já tem responsável. Trocar exige justificativa, e o estado do atendimento é
              preservado.
            </p>
          )}
          {tecnicosDisponiveis.length === 0 ? (
            <p className="text-sm text-tinta-2">
              {tecnicos.length === 0
                ? 'Nenhum técnico cadastrado. Cadastre um usuário com perfil técnico para poder atribuir.'
                : 'Não há outro técnico ativo para assumir este chamado. Cadastre ou reative um técnico antes de reatribuir.'}
            </p>
          ) : (
            <>
              <select
                required
                value={tecnicoId}
                onChange={(e) => setTecnicoId(e.target.value)}
                /* w-full e min-w-0: a largura natural de um select é a da
                   opção mais larga, e as opções trazem nome e e-mail. Como
                   item de grid ele não encolhia abaixo disso, e um e-mail
                   comprido esticava a página inteira no celular. */
                className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
              >
                <option value="">Selecione o técnico</option>
                {tecnicosDisponiveis.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome} — {t.email}
                  </option>
                ))}
              </select>

              {ehReatribuicao && (
                <textarea
                  required
                  minLength={10}
                  rows={2}
                  value={justificativaAtribuicao}
                  onChange={(e) => setJustificativaAtribuicao(e.target.value)}
                  placeholder="Por que o responsável está mudando?"
                  className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
                />
              )}

              <button className="alvo-toque inline-flex items-center justify-center rounded bg-navy px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-2">
                {ehReatribuicao ? 'Reatribuir' : 'Atribuir'}
              </button>
            </>
          )}
        </form>
      )}

      {podeMudarEstado && !['concluido', 'cancelado'].includes(chamado.estado) && (
        <form onSubmit={salvarExecucao} className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3">
          <h2 className="font-medium text-navy">Execução</h2>

          <label className="grid gap-1 text-sm">
            <span className="text-tinta-2">Diagnóstico</span>
            <textarea
              rows={3}
              value={diagnostico}
              onChange={(e) => setDiagnostico(e.target.value)}
              placeholder="O que foi constatado no local"
              className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
            />
          </label>

          <label className="grid gap-1 text-sm max-w-xs">
            <span className="text-tinta-2">Tempo empregado (minutos)</span>
            <input
              type="number"
              min={1}
              value={tempoEmpregado}
              onChange={(e) => setTempoEmpregado(e.target.value)}
              className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
            />
          </label>

          <button className="alvo-toque inline-flex items-center justify-center justify-self-start rounded bg-navy px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-2">
            Salvar execução
          </button>
        </form>
      )}

      {podeMudarEstado && proximosEstados.length > 0 && (
        <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3">
          <h2 className="font-medium text-navy">Mudar estado</h2>
          <div className="flex flex-wrap gap-2">
            {proximosEstados.map((estado) => (
              <button
                key={estado}
                onClick={() => acionarEstado(estado)}
                className="alvo-toque inline-flex items-center justify-center rounded bg-amber px-3 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
              >
                {rotuloEstado(estado)}
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
                <span className="text-tinta font-medium">Descrição do serviço executado</span>
                <span className="text-xs text-tinta-2">
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
                  className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
                />
              </label>
              <div className="flex gap-2">
                <button className="alvo-toque inline-flex items-center justify-center rounded bg-navy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-2">
                  Concluir chamado
                </button>
                <button
                  type="button"
                  onClick={() => setConcluindo(false)}
                  className="text-sm text-tinta-2 hover:underline"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {podeAvaliar && (
        <form onSubmit={avaliar} className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3">
          <h2 className="font-medium text-navy">Avaliar atendimento</h2>
          <select value={nota} onChange={(e) => setNota(e.target.value)} className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm">
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>{n} estrela(s)</option>
            ))}
          </select>
          <button className="alvo-toque inline-flex items-center justify-center rounded bg-navy px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-2">
            Enviar avaliação
          </button>
        </form>
      )}

      <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3">
        <h2 className="font-medium text-navy">Anexos</h2>

        {anexos.length === 0 ? (
          <p className="text-sm text-tinta-2">Nenhum anexo neste chamado.</p>
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
                  <span className="text-xs text-tinta-2">
                    {formatarTamanho(a.tamanho_bytes)} · {a.usuario_nome} ·{' '}
                    {new Date(a.data_upload).toLocaleString('pt-BR')}
                  </span>
                </div>
                {(podeGerenciar || a.usuario_id === usuario.id) && (
                  <button
                    // O arquivo é apagado, não desativado: não há de onde
                    // trazer de volta uma foto do problema que já foi
                    // resolvido.
                    onClick={() =>
                      setConfirmacao({
                        titulo: 'Remover este anexo?',
                        descricao: `"${a.nome_arquivo}" será apagado do chamado. Não há como recuperá-lo depois.`,
                        rotulo: 'Remover',
                        executar: () => removerAnexo(a.id),
                      })
                    }
                    className="text-xs text-erro hover:underline shrink-0"
                  >
                    Remover
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <label className="text-sm">
          <span className="text-tinta-2">
            {enviandoAnexo === 'preparando'
              ? 'Preparando a foto...'
              : enviandoAnexo === 'enviando'
                ? 'Enviando...'
                : 'Adicionar anexo (foto ou PDF). Fotos grandes são reduzidas antes do envio; PDF até 4 MB.'}
          </span>
          <input
            type="file"
            onChange={enviarAnexo}
            disabled={Boolean(enviandoAnexo)}
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="mt-1 block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-navy file:px-3 file:py-2 file:text-white hover:file:bg-navy-2 disabled:opacity-50"
          />
        </label>
      </div>

      <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-4">
        <div>
          <h2 className="font-medium text-navy">Comentários</h2>
          <p className="text-xs text-tinta-2">
            {encerrado
              ? 'O chamado está encerrado: a conversa fica registrada, mas não recebe novos comentários.'
              : 'É por aqui que se acrescenta informação sem mexer no que já orientou a triagem. Quem participa do chamado é avisado.'}
          </p>
        </div>

        {comentarios.length === 0 ? (
          <p className="text-sm text-tinta-2">Nenhum comentário ainda.</p>
        ) : (
          <ul className="grid gap-3">
            {comentarios.map((c) => (
              <li
                key={c.id}
                className={`border rounded px-3 py-2 ${
                  c.usuario_id === usuario.id ? 'bg-fundo' : ''
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs mb-1">
                  <span className="font-medium text-navy">
                    {c.usuario_nome}
                    <span className="text-tinta-2 font-normal"> ({c.usuario_perfil})</span>
                  </span>
                  <span className="text-tinta-2">{new Date(c.data).toLocaleString('pt-BR')}</span>
                </div>
                <p className="text-sm text-gray-800 whitespace-pre-line">{c.texto}</p>
              </li>
            ))}
          </ul>
        )}

        {!encerrado && (
          <form onSubmit={comentar} className="grid gap-2">
            <label className="grid gap-1 text-sm">
              <span className="sr-only">Novo comentário</span>
              <textarea
                required
                minLength={2}
                maxLength={4000}
                rows={3}
                value={novoComentario}
                onChange={(e) => setNovoComentario(e.target.value)}
                placeholder="Escreva um comentário"
                className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
              />
            </label>
            <button
              disabled={enviandoComentario || !novoComentario.trim()}
              className="bg-navy text-white rounded py-2 px-6 text-sm font-medium hover:bg-navy-2 disabled:opacity-50 justify-self-start"
            >
              {enviandoComentario ? 'Enviando...' : 'Comentar'}
            </button>
          </form>
        )}
      </div>

      {/*
        O histórico é o painel mais longo da tela e o menos consultado: é
        registro de auditoria, não ferramenta de trabalho. Aberto sempre, ele
        empurrava comentários e anexos — que são de uso diário — para longe do
        alcance, e num celular isso vira muita rolagem.

        <details> nativo em vez de estado em React: o navegador já sabe abrir,
        fechar, receber foco e anunciar "recolhido/expandido" ao leitor de
        tela. Reimplementar isso com um botão e um booleano seria trocar
        comportamento pronto e correto por código para manter.
      */}
      <details className="group bg-superficie rounded-lg border border-borda shadow-sm">
        <summary className="alvo-toque flex cursor-pointer items-center justify-between gap-2 rounded-lg p-6 font-medium text-navy">
          <span>
            Histórico{' '}
            <span className="font-normal text-tinta-2">
              ({chamado.historico?.length ?? 0}{' '}
              {chamado.historico?.length === 1 ? 'registro' : 'registros'})
            </span>
          </span>
          <span aria-hidden="true" className="text-tinta-2 group-open:hidden">
            mostrar
          </span>
          <span aria-hidden="true" className="hidden text-tinta-2 group-open:inline">
            ocultar
          </span>
        </summary>

        <ul className="grid gap-2 px-6 pb-6 text-sm text-tinta-2">
          {chamado.historico?.map((h) => (
            <li key={h.id} className="border-l-2 border-amber-claro pl-3">
              <strong>{rotuloEstado(h.estado_novo)}</strong> —{' '}
              {new Date(h.data).toLocaleString('pt-BR')}
              {h.observacao && <p className="text-tinta-2">{h.observacao}</p>}
            </li>
          ))}
        </ul>
      </details>

      <Confirmacao
        aberto={confirmacao !== null}
        titulo={confirmacao?.titulo}
        rotuloConfirmar={confirmacao?.rotulo}
        carregando={confirmando}
        onConfirmar={confirmar}
        onCancelar={() => setConfirmacao(null)}
      >
        {confirmacao?.descricao}
      </Confirmacao>
    </div>
  );
}

export default ChamadoDetalhe;

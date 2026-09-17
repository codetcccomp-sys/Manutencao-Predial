import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

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

  const podeGerenciar = ['administrador', 'gestor'].includes(usuario.perfil);

  const carregar = useCallback(() => {
    api
      .get(`/chamados/${id}`)
      .then(({ data }) => setChamado(data.chamado))
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

  async function mudarEstado(estado) {
    setErro('');
    try {
      await api.patch(`/chamados/${id}/estado`, { estado });
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível atualizar o estado.');
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
          <span>Estado: <strong>{chamado.estado}</strong></span>
          <span>Prioridade: <strong>{chamado.prioridade}</strong></span>
        </div>
      </div>

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

      {podeMudarEstado && PROXIMOS_ESTADOS[chamado.estado]?.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="font-medium text-navy mb-3">Mudar estado</h3>
          <div className="flex flex-wrap gap-2">
            {PROXIMOS_ESTADOS[chamado.estado].map((estado) => (
              <button
                key={estado}
                onClick={() => mudarEstado(estado)}
                className="bg-amber text-white text-sm rounded px-3 py-2 hover:opacity-90"
              >
                {estado}
              </button>
            ))}
          </div>
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

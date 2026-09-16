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
  const [nota, setNota] = useState(5);

  const carregar = useCallback(() => {
    api
      .get(`/chamados/${id}`)
      .then(({ data }) => setChamado(data.chamado))
      .catch(() => setErro('Não foi possível carregar o chamado.'));
  }, [id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

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

  if (!chamado) {
    return erro ? (
      <div className="bg-red-50 text-red-700 text-sm rounded p-3">{erro}</div>
    ) : (
      <p className="text-gray-500 text-sm">Carregando...</p>
    );
  }

  const podeGerenciar = ['administrador', 'gestor'].includes(usuario.perfil);
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
          <input
            required
            type="number"
            placeholder="ID do técnico"
            value={tecnicoId}
            onChange={(e) => setTecnicoId(e.target.value)}
            className="border rounded px-3 py-2"
          />
          <button className="bg-navy text-white rounded py-2 font-medium hover:bg-navy-2">
            Atribuir
          </button>
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

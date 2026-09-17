import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';

const ESTADO_LABEL = {
  aberto: 'Aberto',
  em_triagem: 'Em triagem',
  atribuido: 'Atribuído',
  em_andamento: 'Em andamento',
  aguardando_material: 'Aguardando material',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

const ESTADO_COR = {
  aberto: 'bg-gray-200 text-gray-800',
  em_triagem: 'bg-amber/20 text-amber',
  atribuido: 'bg-blue-100 text-blue-700',
  em_andamento: 'bg-blue-100 text-blue-700',
  aguardando_material: 'bg-yellow-100 text-yellow-700',
  concluido: 'bg-green-100 text-green-700',
  cancelado: 'bg-red-100 text-red-700',
};

function Dashboard() {
  const [chamados, setChamados] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api
      .get('/chamados')
      .then(({ data }) => setChamados(data.chamados))
      .catch(() => setErro('Não foi possível carregar os chamados.'))
      .finally(() => setCarregando(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-navy">Chamados</h2>
        <Link
          to="/chamados/novo"
          className="bg-amber text-white text-sm font-medium rounded px-4 py-2 hover:opacity-90"
        >
          + Novo chamado
        </Link>
      </div>

      {erro && <div className="bg-red-50 text-red-700 text-sm rounded p-3 mb-4">{erro}</div>}
      {carregando && <p className="text-gray-500 text-sm">Carregando...</p>}

      {!carregando && chamados.length === 0 && (
        <p className="text-gray-500 text-sm">Nenhum chamado encontrado.</p>
      )}

      <div className="grid gap-3">
        {chamados.map((c) => (
          <Link
            key={c.id}
            to={`/chamados/${c.id}`}
            className="bg-white rounded-lg shadow-sm p-4 flex items-center justify-between hover:shadow-md transition"
          >
            <div>
              <p className="font-medium text-navy">{c.titulo}</p>
              <p className="text-xs text-gray-500">{c.protocolo}</p>
            </div>
            <span className={`text-xs font-medium px-2 py-1 rounded ${ESTADO_COR[c.estado]}`}>
              {ESTADO_LABEL[c.estado]}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default Dashboard;

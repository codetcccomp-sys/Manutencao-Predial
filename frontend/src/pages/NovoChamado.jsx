import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

function NovoChamado() {
  const [categorias, setCategorias] = useState([]);
  const [locais, setLocais] = useState([]);
  const [form, setForm] = useState({
    titulo: '',
    descricao: '',
    categoria_id: '',
    local_id: '',
    prioridade: 'baixa',
  });
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/categorias').then(({ data }) => setCategorias(data.categorias));
    api.get('/locais').then(({ data }) => setLocais(data.locais));
  }, []);

  function atualizarCampo(campo, valor) {
    setForm((atual) => ({ ...atual, [campo]: valor }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const { data } = await api.post('/chamados', {
        ...form,
        categoria_id: Number(form.categoria_id),
        local_id: Number(form.local_id),
      });
      navigate(`/chamados/${data.chamado.id}`);
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível abrir o chamado.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h2 className="text-lg font-bold text-navy mb-6">Abrir novo chamado</h2>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm p-6 grid gap-4">
        {erro && <div className="bg-red-50 text-red-700 text-sm rounded p-2">{erro}</div>}

        <div>
          <label htmlFor="titulo" className="block text-sm font-medium text-gray-700 mb-1">
            Título
          </label>
          <input
            id="titulo"
            required
            value={form.titulo}
            onChange={(e) => atualizarCampo('titulo', e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor="descricao" className="block text-sm font-medium text-gray-700 mb-1">
            Descrição
          </label>
          <textarea
            id="descricao"
            required
            rows={4}
            value={form.descricao}
            onChange={(e) => atualizarCampo('descricao', e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="categoria" className="block text-sm font-medium text-gray-700 mb-1">
              Categoria
            </label>
            <select
              id="categoria"
              required
              value={form.categoria_id}
              onChange={(e) => atualizarCampo('categoria_id', e.target.value)}
              className="w-full border rounded px-3 py-2"
            >
              <option value="">Selecione</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="prioridade" className="block text-sm font-medium text-gray-700 mb-1">
              Prioridade
            </label>
            <select
              id="prioridade"
              value={form.prioridade}
              onChange={(e) => atualizarCampo('prioridade', e.target.value)}
              className="w-full border rounded px-3 py-2"
            >
              <option value="baixa">Baixa</option>
              <option value="media">Média</option>
              <option value="alta">Alta</option>
              <option value="critica">Crítica</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="local" className="block text-sm font-medium text-gray-700 mb-1">
            Local
          </label>
          <select
            id="local"
            required
            value={form.local_id}
            onChange={(e) => atualizarCampo('local_id', e.target.value)}
            className="w-full border rounded px-3 py-2"
          >
            <option value="">Selecione</option>
            {locais.map((l) => (
              <option key={l.id} value={l.id}>
                {[l.unidade, l.bloco, l.pavimento, l.setor, l.ambiente].filter(Boolean).join(' / ')}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={enviando}
          className="bg-navy text-white rounded py-2 font-medium hover:bg-navy-2 disabled:opacity-60"
        >
          {enviando ? 'Enviando...' : 'Abrir chamado'}
        </button>
      </form>
    </div>
  );
}

export default NovoChamado;

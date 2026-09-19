import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { AreaDeTexto, Campo, Selecao } from '../components/ui/Campo';
import Botao from '../components/ui/Botao';
import Aviso from '../components/ui/Aviso';
import CabecalhoDePagina from '../components/ui/CabecalhoDePagina';
import { ORDEM_PRIORIDADES, PRIORIDADES } from '../dominio/rotulos';

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
    // Formulário não acompanha a largura da tela: linha longa demais faz o
    // olho perder o começo da próxima. Os 32rem continuam valendo mesmo com o
    // invólucro agora em 1280px.
    <div className="max-w-2xl">
      <CabecalhoDePagina
        titulo="Abrir novo chamado"
        descricao="Todos os campos são obrigatórios. Quanto mais específico o título e o local, mais rápido a triagem encaminha."
      />

      <form
        onSubmit={handleSubmit}
        className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-4"
      >
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <Campo
          rotulo="Título"
          value={form.titulo}
          onChange={(e) => atualizarCampo('titulo', e.target.value)}
          ajuda="Uma frase que identifique o problema, como “Torneira vazando no banheiro masculino”."
        />

        <AreaDeTexto
          rotulo="Descrição"
          rows={4}
          value={form.descricao}
          onChange={(e) => atualizarCampo('descricao', e.target.value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Selecao
            rotulo="Categoria"
            value={form.categoria_id}
            onChange={(e) => atualizarCampo('categoria_id', e.target.value)}
          >
            <option value="">Selecione</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Selecao>

          <Selecao
            rotulo="Prioridade"
            value={form.prioridade}
            onChange={(e) => atualizarCampo('prioridade', e.target.value)}
            ajuda="A gestão revisa na triagem, com urgência, impacto e risco."
          >
            {ORDEM_PRIORIDADES.map((valor) => (
              <option key={valor} value={valor}>
                {PRIORIDADES[valor].rotulo}
              </option>
            ))}
          </Selecao>
        </div>

        <Selecao
          rotulo="Local"
          value={form.local_id}
          onChange={(e) => atualizarCampo('local_id', e.target.value)}
        >
          <option value="">Selecione</option>
          {locais.map((l) => (
            <option key={l.id} value={l.id}>
              {[l.unidade, l.bloco, l.pavimento, l.setor, l.ambiente].filter(Boolean).join(' / ')}
            </option>
          ))}
        </Selecao>

        <Botao
          type="submit"
          variante="primaria"
          carregando={enviando}
          className="justify-self-start"
        >
          {enviando ? 'Enviando...' : 'Abrir chamado'}
        </Botao>
      </form>
    </div>
  );
}

export default NovoChamado;

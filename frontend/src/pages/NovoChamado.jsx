import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import api from '../api/client';
import { AreaDeTexto, Campo, Selecao } from '../components/ui/Campo';
import Botao from '../components/ui/Botao';
import Aviso from '../components/ui/Aviso';
import CabecalhoDePagina from '../components/ui/CabecalhoDePagina';
import { ORDEM_PRIORIDADES, PRIORIDADES } from '../dominio/rotulos';
import { rotuloEquipamento, rotuloLocal } from '../dominio/preventiva';

/**
 * Abertura de chamado.
 *
 * Pode chegar com `?equipamento=CODIGO` — é o endereço que o QR Code colado no
 * equipamento leva. Aí o equipamento já vem escolhido, com o local e a
 * categoria dele, e a pessoa só escreve o que viu. Quem está na frente da
 * bomba vazando não deveria ter de descobrir em que "unidade / bloco /
 * pavimento" ela fica para pedir o conserto.
 */
function NovoChamado() {
  const [parametros] = useSearchParams();
  const codigoDoQr = parametros.get('equipamento');

  const [categorias, setCategorias] = useState([]);
  const [locais, setLocais] = useState([]);
  const [equipamentos, setEquipamentos] = useState([]);
  const [doQr, setDoQr] = useState(null);
  const [form, setForm] = useState({
    titulo: '',
    descricao: '',
    categoria_id: '',
    local_id: '',
    equipamento_id: '',
    prioridade: 'baixa',
  });
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/categorias').then(({ data }) => setCategorias(data.categorias));
    api.get('/locais').then(({ data }) => setLocais(data.locais));
  }, []);

  useEffect(() => {
    if (!codigoDoQr) return;
    api
      .get(`/equipamentos/codigo/${encodeURIComponent(codigoDoQr)}`)
      .then(({ data }) => {
        const eq = data.equipamento;
        setDoQr(eq);
        setForm((atual) => ({
          ...atual,
          local_id: String(eq.local_id),
          equipamento_id: String(eq.id),
          categoria_id: String(eq.categoria_id),
        }));
      })
      .catch(() =>
        setErro(
          `O código "${codigoDoQr}" não corresponde a nenhum equipamento ativo. Escolha o local abaixo.`
        )
      );
  }, [codigoDoQr]);

  // Os equipamentos do local escolhido. Trocar o local zera a escolha: o
  // equipamento de outro lugar seria recusado pela API, com razão.
  useEffect(() => {
    if (!form.local_id) {
      setEquipamentos([]);
      return;
    }
    api
      .get('/equipamentos', { params: { local_id: form.local_id } })
      .then(({ data }) => setEquipamentos(data.equipamentos))
      .catch(() => setEquipamentos([]));
  }, [form.local_id]);

  function atualizarCampo(campo, valor) {
    setForm((atual) => {
      const novo = { ...atual, [campo]: valor };
      if (campo === 'local_id') novo.equipamento_id = '';
      return novo;
    });
  }

  function escolherEquipamento(id) {
    const eq = equipamentos.find((e) => String(e.id) === id);
    setForm((atual) => ({
      ...atual,
      equipamento_id: id,
      // A categoria do equipamento é a sugestão óbvia; se a pessoa já tinha
      // escolhido outra, a escolha dela fica.
      categoria_id: atual.categoria_id || (eq ? String(eq.categoria_id) : ''),
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const { data } = await api.post('/chamados', {
        titulo: form.titulo,
        descricao: form.descricao,
        prioridade: form.prioridade,
        categoria_id: Number(form.categoria_id),
        local_id: Number(form.local_id),
        ...(form.equipamento_id ? { equipamento_id: Number(form.equipamento_id) } : {}),
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
        descricao="Quanto mais específico o título e o local, mais rápido a triagem encaminha."
      />

      <form
        onSubmit={handleSubmit}
        className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-4"
      >
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        {doQr && (
          <Aviso tipo="info" titulo="Chamado para este equipamento">
            {rotuloEquipamento(doQr)} · {doQr.local_rotulo}
          </Aviso>
        )}

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
              {rotuloLocal(l)}
            </option>
          ))}
        </Selecao>

        {equipamentos.length > 0 && (
          <Selecao
            rotulo="Equipamento"
            opcional
            value={form.equipamento_id}
            onChange={(e) => escolherEquipamento(e.target.value)}
            ajuda="Se o problema é num equipamento (ar-condicionado, bomba, quadro), escolher ajuda o técnico a levar a peça certa."
          >
            <option value="">Nenhum, ou não sei</option>
            {equipamentos.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {rotuloEquipamento(eq)}
              </option>
            ))}
          </Selecao>
        )}

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

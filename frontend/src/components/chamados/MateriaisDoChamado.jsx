import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import api from '../../api/client';
import Aviso from '../ui/Aviso';
import Botao from '../ui/Botao';
import { Campo, Selecao } from '../ui/Campo';

const quantidadeLegivel = (q, unidade) => `${Number(q).toLocaleString('pt-BR')} ${unidade}`;

/**
 * Materiais usados no atendimento (RF07).
 *
 * A API existia desde o início, mas nenhuma tela a oferecia: o técnico não tinha onde dizer o
 * que gastou, e o RF07 aparecia como atendido só porque os testes de API passavam (achado da
 * varredura de 13/11/2026). Quem lança é quem executa (o técnico designado ou a gestão), e só
 * enquanto o atendimento está aberto; o servidor confere as duas coisas, a tela só não oferece
 * o que seria recusado. Cada lançamento entra na linha do tempo, e por isso `aoRegistrar`
 * recarrega o chamado.
 */
function MateriaisDoChamado({ chamadoId, podeLancar, ehGestao, aoRegistrar }) {
  const [lancados, setLancados] = useState(null);
  const [catalogo, setCatalogo] = useState(null);
  const [materialId, setMaterialId] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(() => {
    api
      .get(`/chamados/${chamadoId}/materiais`)
      .then(({ data }) => setLancados(data.materiais ?? []))
      .catch(() => setErro('Não foi possível carregar os materiais.'));
  }, [chamadoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (!podeLancar) return;
    api
      .get('/materiais')
      .then(({ data }) => setCatalogo(data.materiais ?? []))
      .catch(() => setErro('Não foi possível carregar o catálogo de materiais.'));
  }, [podeLancar]);

  // Quem não pode lançar e não tem nada a ver não precisa de uma seção vazia na tela.
  if (lancados === null || (!podeLancar && lancados.length === 0)) {
    return erro ? <Aviso tipo="erro">{erro}</Aviso> : null;
  }

  const escolhido = catalogo?.find((m) => String(m.id) === materialId);
  const jaLancado = lancados.find((m) => String(m.material_id) === materialId);

  async function enviar(evento, acao) {
    evento?.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const { data } = await acao();
      setLancados(data.materiais ?? []);
      setMaterialId('');
      setQuantidade('');
      aoRegistrar?.();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível registrar o material.');
    } finally {
      setEnviando(false);
    }
  }

  const lancar = (evento) =>
    enviar(evento, () =>
      api.post(`/chamados/${chamadoId}/materiais`, {
        material_id: Number(materialId),
        quantidade: Number(quantidade),
      })
    );

  const retirar = (id) => enviar(null, () => api.delete(`/chamados/${chamadoId}/materiais/${id}`));

  return (
    <section
      aria-labelledby="titulo-materiais"
      className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3"
    >
      <h2 id="titulo-materiais" className="font-medium text-navy">
        Materiais
      </h2>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {lancados.length === 0 ? (
        <p className="text-sm text-tinta-2">Nenhum material lançado.</p>
      ) : (
        <ul className="grid gap-2">
          {lancados.map((m) => (
            <li
              key={m.material_id}
              className="flex items-center justify-between gap-3 border border-borda rounded px-3 py-2 text-sm"
            >
              <span className="min-w-0 break-words">
                {m.nome} <span className="text-tinta-2">· {quantidadeLegivel(m.quantidade, m.unidade_medida)}</span>
              </span>
              {podeLancar && (
                <Botao
                  variante="perigo"
                  tamanho="sm"
                  disabled={enviando}
                  onClick={() => retirar(m.material_id)}
                  aria-label={`Retirar ${m.nome}`}
                >
                  Retirar
                </Botao>
              )}
            </li>
          ))}
        </ul>
      )}

      {podeLancar && catalogo?.length === 0 && (
        <p className="text-sm text-tinta-2">
          {ehGestao ? (
            <>
              O catálogo de materiais está vazio.{' '}
              <Link to="/cadastros?aba=materiais" className="text-navy underline">
                Cadastrar materiais
              </Link>
            </>
          ) : (
            'O catálogo de materiais está vazio. Peça à gestão para cadastrar.'
          )}
        </p>
      )}

      {podeLancar && catalogo?.length > 0 && (
        <form onSubmit={lancar} className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <Selecao rotulo="Material" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
            <option value="">Escolha...</option>
            {catalogo.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome} ({m.unidade_medida})
              </option>
            ))}
          </Selecao>
          <Campo
            rotulo="Quantidade"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            ajuda={jaLancado ? 'Substitui a quantidade já lançada.' : escolhido ? `Em ${escolhido.unidade_medida}.` : undefined}
            required
          />
          <Botao type="submit" variante="primaria" carregando={enviando}>
            {jaLancado ? 'Corrigir' : 'Lançar'}
          </Botao>
        </form>
      )}
    </section>
  );
}

export default MateriaisDoChamado;

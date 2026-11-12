import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import Aviso from './ui/Aviso';
import Botao from './ui/Botao';
import Cartao from './ui/Cartao';
import Confirmacao from './ui/Confirmacao';

/**
 * Pedidos de cadastro esperando a gestão (RF01: autocadastro sob aprovação).
 *
 * Aparece em dois lugares. No painel da gestão, só quando há pedido: é ali
 * que gestor e administrador abrem o dia, e um pedido escondido numa tela de
 * configuração ficaria esperando para sempre. Na tela de Usuários, sempre, com
 * a chave que liga e desliga a exigência — essa só a administração vê.
 *
 * Recusar apaga o pedido e não tem volta, então pergunta antes. Aprovar não
 * pergunta: se foi engano, a conta se desativa na lista de usuários.
 */

const quando = (data) =>
  new Date(data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function CadastrosPendentes({ comConfiguracao = false }) {
  const [pedidos, setPedidos] = useState([]);
  const [exige, setExige] = useState(null);
  const [marcados, setMarcados] = useState([]);
  const [aRecusar, setARecusar] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(() => {
    api
      .get('/usuarios', { params: { situacao: 'pendentes' } })
      .then(({ data }) => {
        const lista = data.usuarios ?? [];
        setPedidos(lista);
        // Quem saiu da lista sai da seleção: aprovar "os marcados" não pode
        // levar junto um id que já foi decidido em outra aba.
        setMarcados((atuais) => atuais.filter((id) => lista.some((u) => u.id === id)));
      })
      .catch(() => setErro('Não foi possível carregar os pedidos de cadastro.'));
    if (comConfiguracao) {
      api
        .get('/configuracoes')
        .then(({ data }) => setExige(data.configuracoes?.cadastro_exige_aprovacao ?? null))
        .catch(() => {});
    }
  }, [comConfiguracao]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function decidir(acao, ids) {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      const { data } = await api.post(`/usuarios/${acao}`, { ids });
      setAviso(
        acao === 'aprovar'
          ? `${plural(data.aprovados.length, 'cadastro aprovado', 'cadastros aprovados')}. A pessoa já pode entrar.`
          : `${plural(data.recusados.length, 'pedido recusado e apagado', 'pedidos recusados e apagados')}.`
      );
      setARecusar(null);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível concluir.');
      setARecusar(null);
    } finally {
      setOcupado(false);
    }
  }

  async function mudarExigencia(valor) {
    setErro('');
    setAviso('');
    try {
      const { data } = await api.patch('/configuracoes', { cadastro_exige_aprovacao: valor });
      setExige(data.configuracoes.cadastro_exige_aprovacao);
      setAviso(
        valor
          ? 'Novos cadastros passam a esperar aprovação.'
          : 'Novos cadastros passam a entrar direto, como solicitante.'
      );
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível mudar a configuração.');
    }
  }

  // No painel, sem pedido não há o que mostrar.
  if (!comConfiguracao && pedidos.length === 0) return null;

  const todosMarcados = pedidos.length > 0 && marcados.length === pedidos.length;
  const alternar = (id) =>
    setMarcados((atuais) => (atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id]));

  return (
    <Cartao
      titulo={
        pedidos.length > 0
          ? `${plural(pedidos.length, 'cadastro aguardando', 'cadastros aguardando')} aprovação`
          : 'Pedidos de cadastro'
      }
      className={comConfiguracao ? '' : 'mb-4'}
    >
      <div className="grid gap-3">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}

        {comConfiguracao && exige !== null && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={exige}
              onChange={(e) => mudarExigencia(e.target.checked)}
            />
            <span>
              Novos cadastros precisam de aprovação
              <span className="block text-xs text-tinta-2">
                Desligado, quem se cadastra já entra como solicitante.
              </span>
            </span>
          </label>
        )}

        {pedidos.length === 0 ? (
          <p className="text-sm text-tinta-2">Nenhum pedido aguardando.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="mr-auto flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={todosMarcados}
                  onChange={() => setMarcados(todosMarcados ? [] : pedidos.map((p) => p.id))}
                />
                Selecionar todos
              </label>
              <Botao
                tamanho="sm"
                variante="primaria"
                disabled={marcados.length === 0 || ocupado}
                onClick={() => decidir('aprovar', marcados)}
              >
                Aprovar selecionados ({marcados.length})
              </Botao>
              <Botao
                tamanho="sm"
                disabled={marcados.length === 0 || ocupado}
                onClick={() => setARecusar(pedidos.filter((p) => marcados.includes(p.id)))}
              >
                Recusar selecionados
              </Botao>
            </div>

            <ul className="grid gap-2 text-sm">
              {pedidos.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-borda px-3 py-2"
                >
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${p.nome}`}
                    checked={marcados.includes(p.id)}
                    onChange={() => alternar(p.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{p.nome}</span>{' '}
                    <span className="break-all text-tinta-2">{p.email}</span>
                    <span className="block text-xs text-tinta-2">
                      pediu em {quando(p.cadastro_pendente_desde)}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <Botao
                      tamanho="sm"
                      variante="primaria"
                      disabled={ocupado}
                      aria-label={`Aprovar ${p.nome}`}
                      onClick={() => decidir('aprovar', [p.id])}
                    >
                      Aprovar
                    </Botao>
                    <Botao
                      tamanho="sm"
                      disabled={ocupado}
                      aria-label={`Recusar ${p.nome}`}
                      onClick={() => setARecusar([p])}
                    >
                      Recusar
                    </Botao>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <Confirmacao
        aberto={aRecusar !== null}
        titulo={aRecusar?.length === 1 ? 'Recusar este cadastro?' : `Recusar ${aRecusar?.length} cadastros?`}
        rotuloConfirmar="Recusar e apagar"
        carregando={ocupado}
        onConfirmar={() => decidir('recusar', aRecusar.map((p) => p.id))}
        onCancelar={() => setARecusar(null)}
      >
        <p>
          {aRecusar?.length === 1 ? `O pedido de ${aRecusar[0].nome} é apagado` : 'Os pedidos são apagados'}, sem
          guardar nome nem e-mail. Se foi engano, a pessoa pode se cadastrar de novo.
        </p>
      </Confirmacao>
    </Cartao>
  );
}

export default CadastrosPendentes;

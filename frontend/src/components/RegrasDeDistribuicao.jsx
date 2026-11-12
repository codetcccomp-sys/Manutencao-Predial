import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import Aviso from './ui/Aviso';
import Botao from './ui/Botao';
import Cartao from './ui/Cartao';
import { Selecao } from './ui/Campo';
import { ORDEM_PRIORIDADES, rotuloPrioridade } from '../dominio/rotulos';

/**
 * Distribuição automática: chamados de rotina direto para a equipe.
 *
 * Sem regra, todo chamado espera a triagem do gestor — e numa instituição com
 * muitos pedidos simples por dia, é ali que a lâmpada fica esperando. A regra
 * diz para onde vai uma categoria (num bloco, numa unidade ou em todo lugar) e
 * com que prioridade; dentro da equipe, vai para o plantonista ou para quem
 * tem menos chamados em aberto.
 *
 * Categoria e alcance não se editam: mudar o alcance de uma regra mudaria o
 * sentido dos chamados que ela já distribuiu. Desliga-se uma e cria-se outra.
 */

const NOVA = { categoria_id: '', equipe_id: '', unidade: '', bloco: '', tecnico_id: '', prioridade: 'baixa' };

const unicos = (valores) =>
  [...new Set(valores.filter(Boolean).map((v) => v.trim()))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

export function descreverAlcance(regra) {
  if (regra.bloco) return `${regra.unidade} / bloco ${regra.bloco}`;
  if (regra.unidade) return regra.unidade;
  return 'Toda a instituição';
}

function RegrasDeDistribuicao({ categorias, equipes, locais }) {
  const [regras, setRegras] = useState([]);
  const [nova, setNova] = useState(NOVA);
  const [membros, setMembros] = useState([]);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(() => {
    api
      .get('/regras-distribuicao')
      .then(({ data }) => setRegras(data.regras))
      .catch(() => setErro('Não foi possível carregar as regras de distribuição.'));
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // O plantonista sai da equipe escolhida: oferecer qualquer técnico deixaria
  // escolher um que a API recusaria.
  useEffect(() => {
    if (!nova.equipe_id) {
      setMembros([]);
      return;
    }
    api
      .get(`/equipes/${nova.equipe_id}`)
      .then(({ data }) => setMembros(data.equipe.tecnicos.filter((t) => t.ativo)))
      .catch(() => setMembros([]));
  }, [nova.equipe_id]);

  const ativos = useMemo(() => locais.filter((l) => l.ativo), [locais]);
  const unidades = useMemo(() => unicos(ativos.map((l) => l.unidade)), [ativos]);
  const blocos = useMemo(
    () =>
      nova.unidade
        ? unicos(ativos.filter((l) => l.unidade.trim() === nova.unidade).map((l) => l.bloco))
        : [],
    [ativos, nova.unidade]
  );

  async function executar(acao, mensagem) {
    setErro('');
    setAviso('');
    try {
      await acao();
      setAviso(mensagem);
      carregar();
      return true;
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível salvar.');
      return false;
    }
  }

  function mudar(campo, valor) {
    setNova((atual) => {
      const proxima = { ...atual, [campo]: valor };
      // Bloco é de uma unidade, e plantonista é de uma equipe: trocar o de
      // cima solta o de baixo.
      if (campo === 'unidade') proxima.bloco = '';
      if (campo === 'equipe_id') proxima.tecnico_id = '';
      return proxima;
    });
  }

  async function criar(e) {
    e.preventDefault();
    const corpo = {
      categoria_id: Number(nova.categoria_id),
      equipe_id: Number(nova.equipe_id),
      prioridade: nova.prioridade,
    };
    if (nova.unidade) corpo.unidade = nova.unidade;
    if (nova.bloco) corpo.bloco = nova.bloco;
    if (nova.tecnico_id) corpo.tecnico_id = Number(nova.tecnico_id);

    const ok = await executar(
      () => api.post('/regras-distribuicao', corpo),
      'Regra criada. Vale para os chamados abertos daqui em diante.'
    );
    if (ok) setNova(NOVA);
  }

  return (
    <div className="grid gap-6">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}

      <Cartao
        titulo="Nova regra"
        descricao="A mais específica vence: bloco, unidade, instituição."
      >
        <form onSubmit={criar} className="grid gap-4 sm:grid-cols-2">
          <Selecao rotulo="Categoria" value={nova.categoria_id} onChange={(e) => mudar('categoria_id', e.target.value)}>
            <option value="">Escolha...</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Selecao>

          <Selecao rotulo="Vai para a equipe" value={nova.equipe_id} onChange={(e) => mudar('equipe_id', e.target.value)}>
            <option value="">Escolha...</option>
            {equipes
              .filter((eq) => eq.ativo)
              .map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.nome}
                </option>
              ))}
          </Selecao>

          <Selecao rotulo="Unidade" opcional value={nova.unidade} onChange={(e) => mudar('unidade', e.target.value)}>
            <option value="">Toda a instituição</option>
            {unidades.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Selecao>

          <Selecao
            rotulo="Bloco"
            opcional
            value={nova.bloco}
            disabled={!nova.unidade || blocos.length === 0}
            onChange={(e) => mudar('bloco', e.target.value)}
          >
            <option value="">Todos os blocos</option>
            {blocos.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Selecao>

          <Selecao
            rotulo="Técnico de plantão"
            opcional
            ajuda="Sem plantonista, vai para o técnico da equipe com menos chamados em aberto."
            value={nova.tecnico_id}
            disabled={!nova.equipe_id}
            onChange={(e) => mudar('tecnico_id', e.target.value)}
          >
            <option value="">Dividir pela carga</option>
            {membros.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </Selecao>

          <Selecao rotulo="Prioridade" value={nova.prioridade} onChange={(e) => mudar('prioridade', e.target.value)}>
            {ORDEM_PRIORIDADES.map((p) => (
              <option key={p} value={p}>
                {rotuloPrioridade(p)}
              </option>
            ))}
          </Selecao>

          <div className="sm:col-span-2">
            <Botao type="submit" variante="primaria">
              Criar regra
            </Botao>
          </div>
        </form>
      </Cartao>

      <Cartao titulo="Regras">
        {regras.length === 0 ? (
          <p className="text-sm text-tinta-2">
            Nenhuma regra. Sem regra, todo chamado passa pela triagem do gestor.
          </p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {regras.map((r) => (
              <li
                key={r.id}
                className={`grid gap-1 rounded border border-borda px-3 py-2 ${r.ativo ? '' : 'opacity-60'}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {r.categoria_nome} → {r.equipe_nome}
                  </span>
                  <div className="flex items-center gap-2">
                    {!r.ativo && <span className="text-xs text-tinta-2">Desligada</span>}
                    <Botao
                      tamanho="sm"
                      variante="discreta"
                      aria-label={`${r.ativo ? 'Desligar' : 'Ligar'} a regra de ${r.categoria_nome} (${descreverAlcance(r)})`}
                      onClick={() =>
                        executar(
                          () => api.patch(`/regras-distribuicao/${r.id}`, { ativo: !r.ativo }),
                          r.ativo ? 'Regra desligada.' : 'Regra ligada.'
                        )
                      }
                    >
                      {r.ativo ? 'Desligar' : 'Ligar'}
                    </Botao>
                  </div>
                </div>
                <p className="text-xs text-tinta-2">
                  {descreverAlcance(r)} · prioridade {rotuloPrioridade(r.prioridade)} ·{' '}
                  {r.tecnico_nome ? `plantão: ${r.tecnico_nome}` : 'divide pela carga'}
                </p>
                {r.ativo && (!r.equipe_ativa || r.tecnicos_ativos === 0) && (
                  <p className="text-xs text-atencao">
                    {r.equipe_ativa
                      ? 'A equipe não tem técnico ativo: os chamados seguem para a triagem.'
                      : 'A equipe está desativada: os chamados seguem para a regra mais geral ou para a triagem.'}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </div>
  );
}

export default RegrasDeDistribuicao;

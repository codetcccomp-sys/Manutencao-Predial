import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Aviso from '../components/ui/Aviso';
import Botao from '../components/ui/Botao';
import Cartao from '../components/ui/Cartao';
import CabecalhoDePagina from '../components/ui/CabecalhoDePagina';
import Confirmacao from '../components/ui/Confirmacao';
import { AreaDeTexto, Campo, Selecao } from '../components/ui/Campo';
import { BadgeEstado } from '../components/ui/Badge';
import { ORDEM_PRIORIDADES, PRIORIDADES } from '../dominio/rotulos';
import {
  UNIDADES_REPETICAO,
  aberturaDaJanela,
  descreverPeriodicidade,
  formatarDia,
  hojeLocal,
  rotuloEquipamento,
  rotuloLocal,
} from '../dominio/preventiva';

/**
 * Manutenção preventiva: equipamentos e os planos que cuidam deles.
 *
 * É a parte do sistema que a NBR 5674 pede e que até aqui faltava: o que
 * verificar, a cada quanto tempo, onde e por quem. Cada plano gera o seu
 * chamado sozinho, na data, pelo agendador — e o chamado segue o fluxo de
 * qualquer outro, com a conclusão registrando o serviço feito.
 */

const ABAS = [
  { id: 'planos', rotulo: 'Planos' },
  { id: 'equipamentos', rotulo: 'Equipamentos' },
];

const PLANO_VAZIO = {
  titulo: '',
  descricao: '',
  equipamento_id: '',
  local_id: '',
  categoria_id: '',
  prioridade: 'media',
  repetir_a_cada: '1',
  unidade_repeticao: 'mes',
  proxima_execucao: '',
  antecedencia_dias: '0',
  tecnico_id: '',
};

const EQUIPAMENTO_VAZIO = {
  codigo: '',
  nome: '',
  categoria_id: '',
  local_id: '',
  fabricante: '',
  modelo: '',
  numero_serie: '',
  data_instalacao: '',
};

const numeroOuNada = (valor) => (valor === '' ? undefined : Number(valor));
const textoOuNada = (valor) => (valor.trim() === '' ? undefined : valor.trim());

function Preventiva() {
  const { usuario } = useAuth();
  const podeGerenciar = ['administrador', 'gestor'].includes(usuario.perfil);

  const [aba, setAba] = useState('planos');
  const [planos, setPlanos] = useState([]);
  const [equipamentos, setEquipamentos] = useState([]);
  const [locais, setLocais] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [tecnicos, setTecnicos] = useState([]);
  const [plano, setPlano] = useState(PLANO_VAZIO);
  const [equipamento, setEquipamento] = useState(EQUIPAMENTO_VAZIO);
  const [filtro, setFiltro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  // Qual plano está gerando agora, e qual espera a confirmação de antecipar.
  // Um clique duplo no "Gerar agora" gerava DUAS execuções (a próxima e a
  // seguinte), adiantando o calendário dois períodos sem ninguém pedir.
  const [gerando, setGerando] = useState(null);
  const [antecipar, setAntecipar] = useState(null);

  const carregar = useCallback(() => {
    setCarregando(true);
    Promise.all([
      api.get('/planos-preventivos', { params: { incluir_inativos: 'true' } }),
      api.get('/equipamentos', { params: { incluir_inativos: 'true' } }),
      api.get('/locais'),
      api.get('/categorias'),
      api.get('/usuarios', { params: { perfil: 'tecnico' } }),
    ])
      .then(([p, e, l, c, t]) => {
        setPlanos(p.data.planos);
        setEquipamentos(e.data.equipamentos);
        setLocais(l.data.locais);
        setCategorias(c.data.categorias);
        setTecnicos(t.data.usuarios.filter((u) => u.ativo !== false));
      })
      .catch(() => setErro('Não foi possível carregar a manutenção preventiva.'))
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => {
    if (podeGerenciar) carregar();
  }, [carregar, podeGerenciar]);

  if (!podeGerenciar) return <Navigate to="/" replace />;

  async function executar(acao, mensagem) {
    setErro('');
    setAviso('');
    try {
      const resultado = await acao();
      setAviso(typeof mensagem === 'function' ? mensagem(resultado) : mensagem);
      carregar();
      return true;
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível concluir a operação.');
      return false;
    }
  }

  async function gerar(p) {
    setGerando(p.id);
    await executar(
      () => api.post(`/planos-preventivos/${p.id}/gerar`),
      ({ data }) =>
        `Chamado ${data.gerado.protocolo} gerado, previsto para ${formatarDia(data.gerado.dataPrevista)}.`
    );
    setGerando(null);
    setAntecipar(null);
  }

  // Dentro da janela de antecedência o agendador já geraria hoje: "Gerar
  // agora" só adianta algumas horas. Fora dela, o chamado nasce semanas antes
  // e o plano pula para a execução seguinte — isso merece uma pergunta.
  function pedirGeracao(p) {
    if (gerando !== null) return;
    if (hojeLocal() < aberturaDaJanela(p)) setAntecipar(p);
    else gerar(p);
  }

  async function criarPlano(e) {
    e.preventDefault();
    const ok = await executar(
      () =>
        api.post('/planos-preventivos', {
          titulo: plano.titulo,
          descricao: plano.descricao,
          prioridade: plano.prioridade,
          repetir_a_cada: Number(plano.repetir_a_cada),
          unidade_repeticao: plano.unidade_repeticao,
          proxima_execucao: plano.proxima_execucao,
          antecedencia_dias: Number(plano.antecedencia_dias || 0),
          equipamento_id: numeroOuNada(plano.equipamento_id),
          local_id: plano.equipamento_id ? undefined : numeroOuNada(plano.local_id),
          categoria_id: plano.equipamento_id ? undefined : numeroOuNada(plano.categoria_id),
          tecnico_id: numeroOuNada(plano.tecnico_id),
        }),
      'Plano cadastrado. O chamado de cada execução é gerado sozinho, na data.'
    );
    if (ok) setPlano(PLANO_VAZIO);
  }

  async function criarEquipamento(e) {
    e.preventDefault();
    const ok = await executar(
      () =>
        api.post('/equipamentos', {
          codigo: equipamento.codigo,
          nome: equipamento.nome,
          categoria_id: Number(equipamento.categoria_id),
          local_id: Number(equipamento.local_id),
          fabricante: textoOuNada(equipamento.fabricante),
          modelo: textoOuNada(equipamento.modelo),
          numero_serie: textoOuNada(equipamento.numero_serie),
          data_instalacao: equipamento.data_instalacao || undefined,
        }),
      'Equipamento cadastrado.'
    );
    if (ok) setEquipamento(EQUIPAMENTO_VAZIO);
  }

  const termo = filtro.trim().toLowerCase();
  const equipamentosFiltrados = termo
    ? equipamentos.filter((eq) =>
        `${eq.codigo} ${eq.nome} ${eq.local_rotulo}`.toLowerCase().includes(termo)
      )
    : equipamentos;
  const equipamentosAtivos = equipamentos.filter((eq) => eq.ativo);

  return (
    <div className="grid gap-6">
      <CabecalhoDePagina
        titulo="Manutenção preventiva"
        descricao="O que verificar, a cada quanto tempo, onde e por quem (ABNT NBR 5674). Cada plano gera o próprio chamado na data, e o chamado segue o fluxo de qualquer outro."
        className="mb-0"
      />

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}

      <div role="tablist" aria-label="Seções da manutenção preventiva" className="flex gap-2 border-b">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => setAba(a.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              aba === a.id ? 'border-navy text-navy' : 'border-transparent text-tinta-2'
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {carregando && <p className="text-tinta-2 text-sm">Carregando...</p>}

      {!carregando && aba === 'planos' && (
        <>
          <Cartao
            titulo="Novo plano"
            descricao="Escolha o equipamento — local e categoria vêm dele — ou, para um serviço sem equipamento (pintura, telhado), o local e a categoria."
          >
            <form onSubmit={criarPlano} className="grid gap-4">
              <Campo
                rotulo="Serviço"
                value={plano.titulo}
                onChange={(e) => setPlano({ ...plano, titulo: e.target.value })}
                placeholder="Limpeza do filtro do ar-condicionado"
                minLength={3}
              />
              <AreaDeTexto
                rotulo="Roteiro"
                rows={3}
                value={plano.descricao}
                onChange={(e) => setPlano({ ...plano, descricao: e.target.value })}
                ajuda="O que verificar, trocar ou medir. Vira a descrição de cada chamado gerado: é o checklist que o técnico recebe."
                minLength={5}
              />

              <Selecao
                rotulo="Equipamento"
                opcional
                value={plano.equipamento_id}
                onChange={(e) => setPlano({ ...plano, equipamento_id: e.target.value })}
              >
                <option value="">Nenhum (serviço no local)</option>
                {equipamentosAtivos.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {rotuloEquipamento(eq)} · {eq.local_rotulo}
                  </option>
                ))}
              </Selecao>

              {!plano.equipamento_id && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Selecao
                    rotulo="Local"
                    value={plano.local_id}
                    onChange={(e) => setPlano({ ...plano, local_id: e.target.value })}
                  >
                    <option value="">Selecione</option>
                    {locais.map((l) => (
                      <option key={l.id} value={l.id}>
                        {rotuloLocal(l)}
                      </option>
                    ))}
                  </Selecao>
                  <Selecao
                    rotulo="Categoria"
                    value={plano.categoria_id}
                    onChange={(e) => setPlano({ ...plano, categoria_id: e.target.value })}
                  >
                    <option value="">Selecione</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Selecao>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-3">
                <Campo
                  rotulo="Repetir a cada"
                  type="number"
                  min={1}
                  max={366}
                  value={plano.repetir_a_cada}
                  onChange={(e) => setPlano({ ...plano, repetir_a_cada: e.target.value })}
                />
                <Selecao
                  rotulo="Unidade"
                  value={plano.unidade_repeticao}
                  onChange={(e) => setPlano({ ...plano, unidade_repeticao: e.target.value })}
                >
                  {Object.entries(UNIDADES_REPETICAO).map(([valor, [, plural]]) => (
                    <option key={valor} value={valor}>
                      {plural}
                    </option>
                  ))}
                </Selecao>
                <Campo
                  rotulo="Próxima execução"
                  type="date"
                  min={hojeLocal()}
                  value={plano.proxima_execucao}
                  onChange={(e) => setPlano({ ...plano, proxima_execucao: e.target.value })}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Campo
                  rotulo="Gerar com antecedência de (dias)"
                  type="number"
                  min={0}
                  max={60}
                  value={plano.antecedencia_dias}
                  onChange={(e) => setPlano({ ...plano, antecedencia_dias: e.target.value })}
                  ajuda="Para dar tempo de comprar material ou agendar o acesso."
                />
                <Selecao
                  rotulo="Responsável"
                  opcional
                  value={plano.tecnico_id}
                  onChange={(e) => setPlano({ ...plano, tecnico_id: e.target.value })}
                  ajuda="Com responsável, o chamado já nasce atribuído a ele."
                >
                  <option value="">Distribuir na triagem</option>
                  {tecnicos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </Selecao>
                <Selecao
                  rotulo="Prioridade"
                  value={plano.prioridade}
                  onChange={(e) => setPlano({ ...plano, prioridade: e.target.value })}
                >
                  {ORDEM_PRIORIDADES.map((valor) => (
                    <option key={valor} value={valor}>
                      {PRIORIDADES[valor].rotulo}
                    </option>
                  ))}
                </Selecao>
              </div>

              <Botao type="submit" variante="primaria" className="justify-self-start">
                Cadastrar plano
              </Botao>
            </form>
          </Cartao>

          <Cartao titulo="Planos cadastrados" descricao={`${planos.filter((p) => p.ativo).length} ativos.`}>
            {planos.length === 0 ? (
              <p className="text-sm text-tinta-2">Nenhum plano ainda.</p>
            ) : (
              <ul className="grid gap-3">
                {planos.map((p) => (
                  <li
                    key={p.id}
                    className={`grid gap-2 rounded border border-borda px-4 py-3 text-sm ${
                      p.ativo ? '' : 'opacity-60'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-navy">{p.titulo}</p>
                        <p className="text-xs text-tinta-2">
                          {p.equipamento_id ? (
                            <Link to={`/equipamentos/${p.equipamento_id}`} className="hover:underline">
                              {p.equipamento_codigo} — {p.equipamento_nome}
                            </Link>
                          ) : (
                            p.categoria_nome
                          )}
                          {' · '}
                          {p.local_rotulo}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {p.ativo && (
                          <Botao
                            tamanho="sm"
                            carregando={gerando === p.id}
                            disabled={gerando !== null}
                            onClick={() => pedirGeracao(p)}
                          >
                            Gerar agora
                          </Botao>
                        )}
                        <Botao
                          tamanho="sm"
                          variante="discreta"
                          onClick={() =>
                            executar(
                              () => api.patch(`/planos-preventivos/${p.id}`, { ativo: !p.ativo }),
                              p.ativo ? 'Plano desativado: não gera mais chamados.' : 'Plano reativado.'
                            )
                          }
                        >
                          {p.ativo ? 'Desativar' : 'Reativar'}
                        </Botao>
                      </div>
                    </div>
                    <p className="text-xs text-tinta">
                      <span className="capitalize">{descreverPeriodicidade(p.repetir_a_cada, p.unidade_repeticao)}</span>
                      {p.ativo && (
                        <>
                          {' · próxima em '}
                          <strong>{formatarDia(p.proxima_execucao)}</strong>
                          {p.antecedencia_dias > 0 && ` (gerada ${p.antecedencia_dias} dias antes)`}
                        </>
                      )}
                      {' · '}
                      {p.tecnico_nome ? `responsável: ${p.tecnico_nome}` : 'sem responsável fixo'}
                    </p>
                    {p.ultimo_chamado_id && (
                      <p className="flex flex-wrap items-center gap-2 text-xs text-tinta-2">
                        Última execução ({formatarDia(p.ultimo_chamado_data_prevista)}):
                        <Link to={`/chamados/${p.ultimo_chamado_id}`} className="text-navy hover:underline">
                          {p.ultimo_chamado_protocolo}
                        </Link>
                        <BadgeEstado estado={p.ultimo_chamado_estado} />
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        </>
      )}

      {!carregando && aba === 'equipamentos' && (
        <>
          <Cartao
            titulo="Cadastrar equipamento"
            descricao="O código é o da etiqueta (patrimônio, por exemplo). É ele que vai no QR Code colado no equipamento."
          >
            <form onSubmit={criarEquipamento} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo
                  rotulo="Código"
                  value={equipamento.codigo}
                  onChange={(e) => setEquipamento({ ...equipamento, codigo: e.target.value })}
                  placeholder="AC-204-01"
                  maxLength={40}
                  pattern="[A-Za-z0-9][A-Za-z0-9._\/\-]*"
                  title="Letras, números e . _ / - sem espaços"
                />
                <Campo
                  rotulo="Nome"
                  value={equipamento.nome}
                  onChange={(e) => setEquipamento({ ...equipamento, nome: e.target.value })}
                  placeholder="Ar-condicionado split 12.000 BTU"
                  minLength={2}
                />
                <Selecao
                  rotulo="Local"
                  value={equipamento.local_id}
                  onChange={(e) => setEquipamento({ ...equipamento, local_id: e.target.value })}
                >
                  <option value="">Selecione</option>
                  {locais.map((l) => (
                    <option key={l.id} value={l.id}>
                      {rotuloLocal(l)}
                    </option>
                  ))}
                </Selecao>
                <Selecao
                  rotulo="Categoria"
                  value={equipamento.categoria_id}
                  onChange={(e) => setEquipamento({ ...equipamento, categoria_id: e.target.value })}
                >
                  <option value="">Selecione</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Selecao>
                <Campo
                  rotulo="Fabricante"
                  opcional
                  value={equipamento.fabricante}
                  onChange={(e) => setEquipamento({ ...equipamento, fabricante: e.target.value })}
                />
                <Campo
                  rotulo="Modelo"
                  opcional
                  value={equipamento.modelo}
                  onChange={(e) => setEquipamento({ ...equipamento, modelo: e.target.value })}
                />
                <Campo
                  rotulo="Número de série"
                  opcional
                  value={equipamento.numero_serie}
                  onChange={(e) => setEquipamento({ ...equipamento, numero_serie: e.target.value })}
                />
                <Campo
                  rotulo="Instalado em"
                  opcional
                  type="date"
                  value={equipamento.data_instalacao}
                  onChange={(e) => setEquipamento({ ...equipamento, data_instalacao: e.target.value })}
                />
              </div>
              <Botao type="submit" variante="primaria" className="justify-self-start">
                Cadastrar equipamento
              </Botao>
            </form>
          </Cartao>

          <Cartao
            titulo="Equipamentos"
            descricao={<Link to="/etiquetas" className="text-navy hover:underline">Imprimir etiquetas com QR Code</Link>}
            acao={
              <input
                type="search"
                aria-label="Filtrar equipamentos"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder="Filtrar por código, nome ou local"
                className="min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm sm:w-72"
              />
            }
          >
            <p className="text-xs text-tinta-2 mb-3">
              {equipamentosFiltrados.length} de {equipamentos.length}.
            </p>
            <ul className="grid gap-2 text-sm">
              {equipamentosFiltrados.length === 0 && (
                <li className="text-tinta-2">Nenhum equipamento corresponde ao filtro.</li>
              )}
              {equipamentosFiltrados.map((eq) => (
                <li
                  key={eq.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded border border-borda px-3 py-2 ${
                    eq.ativo ? '' : 'opacity-60'
                  }`}
                >
                  <div className="min-w-0">
                    <Link to={`/equipamentos/${eq.id}`} className="font-medium text-navy hover:underline">
                      {rotuloEquipamento(eq)}
                    </Link>
                    <p className="text-xs text-tinta-2">
                      {eq.categoria_nome} · {eq.local_rotulo}
                    </p>
                  </div>
                  <Botao
                    tamanho="sm"
                    variante="discreta"
                    onClick={() =>
                      executar(
                        () => api.patch(`/equipamentos/${eq.id}`, { ativo: !eq.ativo }),
                        eq.ativo ? 'Equipamento desativado.' : 'Equipamento reativado.'
                      )
                    }
                  >
                    {eq.ativo ? 'Desativar' : 'Reativar'}
                  </Botao>
                </li>
              ))}
            </ul>
          </Cartao>
        </>
      )}

      <Confirmacao
        aberto={antecipar !== null}
        titulo="Antecipar a preventiva?"
        rotuloConfirmar="Gerar agora"
        carregando={gerando !== null}
        onConfirmar={() => gerar(antecipar)}
        onCancelar={() => setAntecipar(null)}
      >
        {antecipar && (
          <p>
            A próxima execução de “{antecipar.titulo}” é em{' '}
            <strong>{formatarDia(antecipar.proxima_execucao)}</strong>, e o agendador já criaria o chamado
            sozinho em {formatarDia(aberturaDaJanela(antecipar))}. Gerar agora cria esse chamado hoje e passa
            o plano para a execução seguinte.
          </p>
        )}
      </Confirmacao>
    </div>
  );
}

export default Preventiva;

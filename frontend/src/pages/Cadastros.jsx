import { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Aviso from '../components/ui/Aviso';
import CabecalhoDePagina from '../components/ui/CabecalhoDePagina';
import ExpedienteEFeriados from '../components/ExpedienteEFeriados';
import RegrasDeDistribuicao from '../components/RegrasDeDistribuicao';
import MostrarMais from '../components/ui/MostrarMais';

// Quantos itens uma lista longa desenha de cada vez.
const PASSO_DA_LISTA = 50;

const ABAS = [
  { id: 'locais', rotulo: 'Locais' },
  { id: 'categorias', rotulo: 'Categorias' },
  { id: 'equipes', rotulo: 'Equipes' },
  { id: 'distribuicao', rotulo: 'Distribuição' },
  { id: 'expediente', rotulo: 'Expediente' },
];

const LOCAL_VAZIO = { unidade: '', bloco: '', pavimento: '', setor: '', ambiente: '' };

// Modelo de planilha, com o ponto e vírgula que o Excel em português usa e o
// BOM que faz ele abrir o arquivo como UTF-8 — sem os dois, quem baixa o
// modelo, preenche e devolve manda de volta um arquivo que precisa de conserto.
const MODELO_CSV =
  '﻿unidade;bloco;pavimento;setor;ambiente\r\n' +
  'Prédio Central;A;Térreo;Administrativo;Recepção\r\n' +
  'Prédio Central;A;1º andar;Ensino;Sala 101\r\n' +
  'Prédio Central;B;Térreo;;Almoxarifado\r\n';

/**
 * Lê o arquivo como texto, aceitando o que o Excel de fato salva.
 *
 * O "CSV (separado por vírgulas)" do Excel no Windows sai em Windows-1252, não
 * em UTF-8. Lido como UTF-8, "Térreo" chega como caractere de substituição e o
 * local entra no banco com o nome corrompido — erro que ninguém percebe na
 * hora e que só aparece meses depois, num relatório.
 */
async function lerTexto(arquivo) {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// Os cinco níveis do local, na ordem em que o Termo de Abertura os descreve.
const NIVEIS_LOCAL = [
  { campo: 'unidade', rotulo: 'Unidade', obrigatorio: true },
  { campo: 'bloco', rotulo: 'Bloco' },
  { campo: 'pavimento', rotulo: 'Pavimento' },
  { campo: 'setor', rotulo: 'Setor' },
  { campo: 'ambiente', rotulo: 'Ambiente' },
];

function rotuloLocal(local) {
  return NIVEIS_LOCAL.map((n) => local[n.campo])
    .filter(Boolean)
    .join(' / ');
}

function Cadastros() {
  const { usuario } = useAuth();
  const podeGerenciar = ['administrador', 'gestor'].includes(usuario.perfil);

  // A aba pode vir no endereço: o link "ajustar expediente" dos relatórios
  // cai direto nela.
  const [parametros] = useSearchParams();
  const [aba, setAba] = useState(() =>
    ABAS.some((a) => a.id === parametros.get('aba')) ? parametros.get('aba') : 'locais'
  );
  const [locais, setLocais] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [equipes, setEquipes] = useState([]);
  const [tecnicos, setTecnicos] = useState([]);

  const [novoLocal, setNovoLocal] = useState(LOCAL_VAZIO);
  const [filtroLocal, setFiltroLocal] = useState('');
  // Quantos locais desenhar: uma instituição pode ter milhares, e desenhar todos de uma vez custa
  // dezenas de milhares de elementos. O filtro vale para a lista inteira.
  const [quantosLocais, setQuantosLocais] = useState(PASSO_DA_LISTA);
  const [importando, setImportando] = useState(false);
  const [relatorio, setRelatorio] = useState(null);
  const [problemas, setProblemas] = useState([]);
  const [novaCategoria, setNovaCategoria] = useState('');
  const [novaEquipe, setNovaEquipe] = useState('');
  const [equipeAberta, setEquipeAberta] = useState(null);

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(() => {
    setCarregando(true);
    Promise.all([
      api.get('/locais', { params: { incluir_inativos: 'true' } }),
      api.get('/categorias'),
      api.get('/equipes', { params: { incluir_inativas: 'true' } }),
      api.get('/usuarios', { params: { perfil: 'tecnico' } }),
    ])
      .then(([l, c, e, t]) => {
        setLocais(l.data.locais);
        setCategorias(c.data.categorias);
        setEquipes(e.data.equipes);
        setTecnicos(t.data.usuarios);
      })
      .catch(() => setErro('Não foi possível carregar os cadastros.'))
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => {
    if (podeGerenciar) carregar();
  }, [carregar, podeGerenciar]);

  if (!podeGerenciar) return <Navigate to="/" replace />;

  const termo = filtroLocal.trim().toLowerCase();
  const locaisFiltrados = termo
    ? locais.filter((l) => rotuloLocal(l).toLowerCase().includes(termo))
    : locais;
  const locaisVisiveis = locaisFiltrados.slice(0, quantosLocais);

  async function executar(acao, mensagem) {
    setErro('');
    setAviso('');
    // O relatório da importação some a cada nova ação: mantido na tela, a
    // lista de problemas apareceria junto com o erro de outra operação, como
    // se fosse dela.
    setRelatorio(null);
    setProblemas([]);
    try {
      await acao();
      if (mensagem) setAviso(mensagem);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível concluir a operação.');
    }
  }

  async function importarLocais(arquivo) {
    if (!arquivo) return;
    setErro('');
    setAviso('');
    setRelatorio(null);
    setProblemas([]);
    setImportando(true);
    try {
      const { data } = await api.post('/locais/importar', { csv: await lerTexto(arquivo) });
      setRelatorio(data.relatorio);
      carregar();
    } catch (err) {
      const corpo = err.response?.data?.erro;
      setErro(corpo?.mensagem || 'Não foi possível importar a planilha.');
      // A lista item a item é o que permite corrigir o arquivo de uma vez; a
      // frase de resumo sozinha manda quem importou procurar no escuro.
      setProblemas(corpo?.detalhes || []);
    } finally {
      setImportando(false);
    }
  }

  function baixarModelo() {
    const url = URL.createObjectURL(new Blob([MODELO_CSV], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modelo_locais.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function abrirEquipe(id) {
    setErro('');
    try {
      const { data } = await api.get(`/equipes/${id}`);
      setEquipeAberta(data.equipe);
    } catch {
      setErro('Não foi possível carregar a equipe.');
    }
  }

  return (
    <div className="grid gap-6">
      <CabecalhoDePagina
        titulo="Cadastros"
        descricao="Nada aqui é apagado: locais e equipes são desativados, e categorias são renomeadas. Os chamados antigos continuam apontando para o registro original."
        className="mb-0"
      />

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}

      {/* Rola por dentro no celular: desde a quarta aba, a fileira passa dos
          393px e levaria a página inteira junto para o lado. */}
      {/* `aria-pressed` diz qual seção está aberta: a borda azul só diz isso a
          quem enxerga (WCAG 1.4.1). */}
      <div role="group" aria-label="Seções dos cadastros" className="flex gap-2 border-b overflow-x-auto">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-pressed={aba === a.id}
            onClick={() => setAba(a.id)}
            className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              aba === a.id ? 'border-navy text-navy' : 'border-transparent text-tinta-2'
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {carregando && <p className="text-tinta-2 text-sm">Carregando...</p>}

      {!carregando && aba === 'locais' && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              executar(async () => {
                await api.post('/locais', novoLocal);
                setNovoLocal(LOCAL_VAZIO);
              }, 'Local cadastrado.');
            }}
            className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3"
          >
            <h2 className="font-medium text-navy">Cadastrar local</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {NIVEIS_LOCAL.map((n) => (
                <label key={n.campo} className="grid gap-1 text-sm">
                  <span className="text-tinta-2">
                    {n.rotulo}
                    {/* Herda o `text-tinta-2` do rótulo. O cinza 400 cru do Tailwind que havia
                        aqui dava cerca de 2,5:1, contra os 4,5:1 do WCAG AA: cor fora dos
                        tokens escapa da garantia que eles têm, e só o axe viu. */}
                    {!n.obrigatorio && <span> (opcional)</span>}
                  </span>
                  <input
                    type="text"
                    required={n.obrigatorio}
                    value={novoLocal[n.campo]}
                    onChange={(e) => setNovoLocal({ ...novoLocal, [n.campo]: e.target.value })}
                    className="w-full min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
                  />
                </label>
              ))}
            </div>
            <button className="alvo-toque inline-flex items-center justify-center justify-self-start rounded bg-navy px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-2">
              Cadastrar
            </button>
          </form>

          {/* Um prédio tem dezenas de ambientes. Cadastrá-los um a um no
              formulário acima é meia hora de digitação antes de o sistema
              servir para alguma coisa — e é exatamente o que separa uma
              demonstração de um piloto com dados de verdade. */}
          <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3 min-w-0">
            <h2 className="font-medium text-navy">Importar planilha</h2>
            <p className="text-sm text-tinta-2">
              Envie um arquivo CSV com as colunas <code>unidade</code>, <code>bloco</code>,{' '}
              <code>pavimento</code>, <code>setor</code> e <code>ambiente</code>. Só{' '}
              <code>unidade</code> é obrigatória. Locais que já existem são reconhecidos e não
              entram de novo, então dá para corrigir o arquivo e reenviá-lo inteiro.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm">
                <span className="sr-only">Planilha de locais</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={importando}
                  onChange={(e) => {
                    const arquivo = e.target.files?.[0];
                    // Zerar o campo deixa reenviar o mesmo arquivo depois de
                    // corrigi-lo; sem isso o onChange não dispara de novo.
                    e.target.value = '';
                    importarLocais(arquivo);
                  }}
                  className="text-sm"
                />
              </label>
              <button
                type="button"
                onClick={baixarModelo}
                className="text-sm text-navy hover:underline"
              >
                Baixar modelo
              </button>
            </div>

            {importando && <p className="text-sm text-tinta-2">Importando...</p>}

            {relatorio && (
              <div className="bg-sucesso-tenue text-green-800 text-sm rounded p-3 grid gap-1">
                <p>
                  {relatorio.criados} {relatorio.criados === 1 ? 'local criado' : 'locais criados'}
                  {relatorio.ja_existiam > 0 &&
                    `; ${relatorio.ja_existiam} já ${
                      relatorio.ja_existiam === 1 ? 'existia' : 'existiam'
                    }`}
                  {' de '}
                  {relatorio.linhas} {relatorio.linhas === 1 ? 'linha' : 'linhas'}.
                </p>
                {relatorio.desativados?.length > 0 && (
                  <div className="text-atencao">
                    <p>
                      {relatorio.desativados.length === 1
                        ? 'Um local do arquivo está desativado e não aparece na abertura de chamado:'
                        : `${relatorio.desativados.length} locais do arquivo estão desativados e não aparecem na abertura de chamado:`}
                    </p>
                    <ul className="list-disc pl-5">
                      {relatorio.desativados.map((l) => (
                        <li key={l.id}>{l.rotulo}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {problemas.length > 0 && (
              <Aviso tipo="erro" titulo="Nada foi importado. Corrija e envie o arquivo de novo:">
                {/* A lista rola dentro do aviso: um arquivo com cem linhas
                    erradas empurraria o formulário para fora da tela. */}
                <ul className="list-disc pl-5 mt-1 max-h-60 overflow-y-auto">
                  {problemas.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Aviso>
            )}
          </div>

          <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6">
            {/* Uma instituição tem centenas de ambientes. Sem um filtro, achar
                um local para desativar vira rolagem de página inteira. */}
            <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-medium text-navy">Cadastrados</h2>
              <input
                type="search"
                value={filtroLocal}
                onChange={(e) => {
                  setFiltroLocal(e.target.value);
                  setQuantosLocais(PASSO_DA_LISTA);
                }}
                placeholder="Filtrar locais"
                className="min-w-0 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm sm:w-64"
              />
            </div>
            <p className="text-xs text-tinta-2 mb-3">
              {locaisFiltrados.length} de {locais.length}{' '}
              {locais.length === 1 ? 'local' : 'locais'}.
            </p>
            <ul className="grid gap-2 text-sm">
              {locaisFiltrados.length === 0 && (
                <li className="text-tinta-2">Nenhum local corresponde ao filtro.</li>
              )}
              {locaisVisiveis.map((l) => (
                <li
                  key={l.id}
                  className={`flex items-center justify-between gap-3 border rounded px-3 py-2 ${
                    l.ativo ? '' : 'opacity-60'
                  }`}
                >
                  <span className="text-navy">{rotuloLocal(l)}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={l.ativo ? 'text-sucesso text-xs' : 'text-tinta-2 text-xs'}>
                      {l.ativo ? 'Ativo' : 'Desativado'}
                    </span>
                    <button
                      onClick={() =>
                        executar(() => api.patch(`/locais/${l.id}`, { ativo: !l.ativo }))
                      }
                      className="text-xs text-navy hover:underline"
                    >
                      {l.ativo ? 'Desativar' : 'Reativar'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <MostrarMais
              mostrando={locaisVisiveis.length}
              total={locaisFiltrados.length}
              passo={PASSO_DA_LISTA}
              onMais={() => setQuantosLocais((n) => n + PASSO_DA_LISTA)}
              nome="locais"
            />
          </div>
        </>
      )}

      {!carregando && aba === 'expediente' && <ExpedienteEFeriados />}

      {!carregando && aba === 'distribuicao' && (
        <RegrasDeDistribuicao categorias={categorias} equipes={equipes} locais={locais} />
      )}

      {!carregando && aba === 'categorias' && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              executar(async () => {
                await api.post('/categorias', { nome: novaCategoria });
                setNovaCategoria('');
              }, 'Categoria cadastrada.');
            }}
            className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3"
          >
            <h2 className="font-medium text-navy">Cadastrar categoria</h2>
            <div className="flex gap-2">
              <input
                type="text"
                required
                minLength={3}
                value={novaCategoria}
                onChange={(e) => setNovaCategoria(e.target.value)}
                className="min-w-0 flex-1 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
              />
              <button className="alvo-toque inline-flex items-center justify-center rounded bg-navy px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-2">
                Cadastrar
              </button>
            </div>
          </form>

          <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6">
            <h2 className="font-medium text-navy mb-3">Cadastradas</h2>
            <ul className="grid gap-2 text-sm">
              {categorias.map((c) => (
                <li key={c.id} className="flex items-center gap-2 border rounded px-3 py-2">
                  <input
                    type="text"
                    defaultValue={c.nome}
                    onBlur={(e) => {
                      const nome = e.target.value.trim();
                      if (nome && nome !== c.nome) {
                        executar(() => api.patch(`/categorias/${c.id}`, { nome }), 'Categoria renomeada.');
                      }
                    }}
                    className="min-w-0 flex-1 rounded border border-borda-forte bg-superficie px-2 py-1 text-sm"
                  />
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {!carregando && aba === 'equipes' && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              executar(async () => {
                await api.post('/equipes', { nome: novaEquipe });
                setNovaEquipe('');
              }, 'Equipe cadastrada.');
            }}
            className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3"
          >
            <h2 className="font-medium text-navy">Cadastrar equipe</h2>
            <div className="flex gap-2">
              <input
                type="text"
                required
                minLength={2}
                value={novaEquipe}
                onChange={(e) => setNovaEquipe(e.target.value)}
                className="min-w-0 flex-1 rounded border border-borda-forte bg-superficie px-3 py-2 text-sm"
              />
              <button className="alvo-toque inline-flex items-center justify-center rounded bg-navy px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-2">
                Cadastrar
              </button>
            </div>
          </form>

          <div className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3">
            <h2 className="font-medium text-navy">Cadastradas</h2>
            <ul className="grid gap-2 text-sm">
              {equipes.map((e) => (
                <li key={e.id} className={`border rounded px-3 py-2 ${e.ativo ? '' : 'opacity-60'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={() => abrirEquipe(e.id)}
                      className="text-navy font-medium hover:underline text-left"
                    >
                      {e.nome}
                    </button>
                    <div className="flex items-center gap-3 shrink-0 text-xs">
                      <span className="text-tinta-2">
                        {e.total_tecnicos} {e.total_tecnicos === 1 ? 'técnico' : 'técnicos'}
                      </span>
                      <button
                        onClick={() =>
                          executar(() => api.patch(`/equipes/${e.id}`, { ativo: !e.ativo }))
                        }
                        className="text-navy hover:underline"
                      >
                        {e.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                    </div>
                  </div>

                  {equipeAberta?.id === e.id && (
                    <div className="mt-3 border-t pt-3 grid gap-2">
                      {equipeAberta.tecnicos.length === 0 ? (
                        <p className="text-tinta-2 text-xs">Nenhum técnico nesta equipe.</p>
                      ) : (
                        equipeAberta.tecnicos.map((t) => (
                          <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                            <span>
                              {t.nome} <span className="text-tinta-2">{t.email}</span>
                            </span>
                            <button
                              onClick={() =>
                                executar(async () => {
                                  await api.delete(`/equipes/${e.id}/tecnicos/${t.id}`);
                                  abrirEquipe(e.id);
                                })
                              }
                              className="text-red-600 hover:underline"
                            >
                              Remover
                            </button>
                          </div>
                        ))
                      )}

                      <select
                        value=""
                        onChange={(ev) => {
                          if (!ev.target.value) return;
                          executar(async () => {
                            await api.post(`/equipes/${e.id}/tecnicos`, {
                              usuario_id: Number(ev.target.value),
                            });
                            abrirEquipe(e.id);
                          });
                        }}
                        className="border rounded px-2 py-1 text-xs"
                      >
                        <option value="">Adicionar técnico...</option>
                        {tecnicos
                          .filter((t) => !equipeAberta.tecnicos.some((m) => m.id === t.id))
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.nome}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export default Cadastros;

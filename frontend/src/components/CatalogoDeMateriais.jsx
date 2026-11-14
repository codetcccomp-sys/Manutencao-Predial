import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import Aviso from './ui/Aviso';
import Botao from './ui/Botao';
import { Campo } from './ui/Campo';

const CONTROLE =
  'min-w-0 rounded border border-borda-forte bg-superficie px-2 py-1.5 text-sm alvo-toque';

/**
 * Catálogo de materiais, de onde o técnico escolhe o que lançou no chamado (RF07).
 *
 * Como as categorias, nada aqui é apagado: um material já lançado num chamado antigo
 * continua apontando para o registro original. Corrige-se o nome ou a unidade.
 */
function CatalogoDeMateriais() {
  const [materiais, setMateriais] = useState(null);
  const [novo, setNovo] = useState({ nome: '', unidade_medida: '' });
  const [edicao, setEdicao] = useState({});
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(() => {
    api
      .get('/materiais')
      .then(({ data }) => setMateriais(data.materiais))
      .catch(() => setErro('Não foi possível carregar os materiais.'));
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function executar(acao, mensagem) {
    setErro('');
    setAviso('');
    setEnviando(true);
    try {
      await acao();
      setAviso(mensagem);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro?.mensagem || 'Não foi possível salvar o material.');
    } finally {
      setEnviando(false);
    }
  }

  function cadastrar(e) {
    e.preventDefault();
    executar(async () => {
      await api.post('/materiais', novo);
      setNovo({ nome: '', unidade_medida: '' });
    }, 'Material cadastrado.');
  }

  function salvar(m) {
    const mudou = edicao[m.id];
    executar(async () => {
      await api.patch(`/materiais/${m.id}`, mudou);
      setEdicao(({ [m.id]: _feito, ...resto }) => resto);
    }, 'Material atualizado.');
  }

  const valor = (m, campo) => edicao[m.id]?.[campo] ?? m[campo];
  const editar = (m, campo, v) =>
    setEdicao((atual) => ({ ...atual, [m.id]: { ...atual[m.id], [campo]: v } }));

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}

      <form onSubmit={cadastrar} className="bg-superficie rounded-lg border border-borda shadow-sm p-6 grid gap-3">
        <h2 className="font-medium text-navy">Cadastrar material</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
          <Campo
            rotulo="Nome"
            value={novo.nome}
            onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
            minLength={2}
            maxLength={150}
            required
          />
          <Campo
            rotulo="Unidade de medida"
            ajuda="m, un, kg, rolo..."
            value={novo.unidade_medida}
            onChange={(e) => setNovo({ ...novo, unidade_medida: e.target.value })}
            maxLength={30}
            required
          />
          <Botao type="submit" variante="primaria" carregando={enviando}>
            Cadastrar
          </Botao>
        </div>
      </form>

      <section aria-labelledby="titulo-catalogo" className="bg-superficie rounded-lg border border-borda shadow-sm p-6">
        <h2 id="titulo-catalogo" className="font-medium text-navy mb-3">
          Cadastrados
        </h2>
        {materiais === null ? (
          <p className="text-sm text-tinta-2">Carregando...</p>
        ) : materiais.length === 0 ? (
          <p className="text-sm text-tinta-2">Nenhum material cadastrado.</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {materiais.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 border border-borda rounded px-3 py-2">
                <input
                  type="text"
                  aria-label={`Nome de ${m.nome}`}
                  value={valor(m, 'nome')}
                  onChange={(e) => editar(m, 'nome', e.target.value)}
                  minLength={2}
                  maxLength={150}
                  className={`${CONTROLE} flex-1`}
                />
                <input
                  type="text"
                  aria-label={`Unidade de ${m.nome}`}
                  value={valor(m, 'unidade_medida')}
                  onChange={(e) => editar(m, 'unidade_medida', e.target.value)}
                  maxLength={30}
                  className={`${CONTROLE} w-24`}
                />
                <Botao
                  tamanho="sm"
                  disabled={!edicao[m.id] || enviando}
                  onClick={() => salvar(m)}
                  aria-label={`Salvar ${m.nome}`}
                >
                  Salvar
                </Botao>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default CatalogoDeMateriais;

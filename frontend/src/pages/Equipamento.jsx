import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Aviso from '../components/ui/Aviso';
import Cartao from '../components/ui/Cartao';
import CabecalhoDePagina from '../components/ui/CabecalhoDePagina';
import { BadgeEstado } from '../components/ui/Badge';
import { Esqueleto } from '../components/ui/Estados';
import { descreverPeriodicidade, formatarDia } from '../dominio/preventiva';

/**
 * A ficha de um equipamento: o cadastro e o que já aconteceu com ele.
 *
 * É a pergunta que o local sozinho não respondia — "esta bomba já quebrou
 * quantas vezes?" — e a que decide entre consertar de novo ou trocar. O
 * técnico abre antes de ir ao local; a gestão, antes de aprovar a compra.
 */
function Equipamento() {
  const { id } = useParams();
  const { usuario } = useAuth();
  const ehGestao = ['administrador', 'gestor'].includes(usuario.perfil);

  const [equipamento, setEquipamento] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    setErro('');
    api
      .get(`/equipamentos/${id}`)
      .then(({ data }) => setEquipamento(data.equipamento))
      .catch((err) =>
        setErro(err.response?.data?.erro?.mensagem || 'Não foi possível carregar o equipamento.')
      );
  }, [id]);

  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!equipamento) return <Esqueleto linhas={3} />;

  const dados = [
    ['Local', equipamento.local_rotulo],
    ['Categoria', equipamento.categoria_nome],
    ['Fabricante', equipamento.fabricante],
    ['Modelo', equipamento.modelo],
    ['Número de série', equipamento.numero_serie],
    ['Instalado em', formatarDia(equipamento.data_instalacao)],
  ].filter(([, valor]) => valor);

  const totais = equipamento.totais;

  return (
    <div className="grid gap-6">
      <CabecalhoDePagina
        titulo={equipamento.nome}
        descricao={`Código ${equipamento.codigo}${equipamento.ativo ? '' : ' · desativado'}`}
        acao={
          equipamento.ativo && (
            <Link
              to={`/chamados/novo?equipamento=${encodeURIComponent(equipamento.codigo)}`}
              className="alvo-toque inline-flex items-center justify-center gap-2 rounded bg-navy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-2"
            >
              Abrir chamado para ele
            </Link>
          )
        }
        className="mb-0"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Cartao titulo="Cadastro" className="lg:col-span-1">
          <dl className="grid gap-2 text-sm">
            {dados.map(([rotulo, valor]) => (
              <div key={rotulo}>
                <dt className="text-xs uppercase tracking-wide text-tinta-2">{rotulo}</dt>
                <dd className="text-tinta">{valor}</dd>
              </div>
            ))}
            {equipamento.observacao && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-tinta-2">Observação</dt>
                <dd className="text-tinta whitespace-pre-wrap">{equipamento.observacao}</dd>
              </div>
            )}
          </dl>
        </Cartao>

        {totais && (
          <Cartao titulo="Em números" className="lg:col-span-2">
            <dl className="grid gap-3 sm:grid-cols-3 text-sm">
              <div>
                <dt className="text-xs text-tinta-2">Corretivos nos últimos 12 meses</dt>
                <dd className={`text-2xl font-bold ${totais.corretivos_12_meses >= 3 ? 'text-erro' : 'text-navy'}`}>
                  {totais.corretivos_12_meses}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-tinta-2">Corretivos, desde sempre</dt>
                <dd className="text-2xl font-bold text-navy">{totais.corretivos}</dd>
              </div>
              <div>
                <dt className="text-xs text-tinta-2">Preventivas geradas</dt>
                <dd className="text-2xl font-bold text-navy">{totais.preventivos}</dd>
              </div>
            </dl>
            {totais.corretivos_12_meses >= 3 && (
              <p className="mt-3 text-xs text-tinta-2">
                Três ou mais corretivos em um ano: vale rever o plano preventivo deste equipamento, ou
                avaliar a troca.
              </p>
            )}
          </Cartao>
        )}
      </div>

      {equipamento.planos && (
        <Cartao
          titulo="Planos preventivos"
          descricao={
            equipamento.planos.length === 0
              ? 'Nenhum plano cobre este equipamento.'
              : undefined
          }
          acao={
            ehGestao && (
              <Link to="/preventiva" className="text-sm text-navy hover:underline">
                Gerenciar planos
              </Link>
            )
          }
        >
          {equipamento.planos.length > 0 && (
            <ul className="grid gap-2 text-sm">
              {equipamento.planos.map((p) => (
                <li key={p.id} className={`rounded border border-borda px-3 py-2 ${p.ativo ? '' : 'opacity-60'}`}>
                  <p className="font-medium text-navy">{p.titulo}</p>
                  <p className="text-xs text-tinta-2">
                    <span className="capitalize">{descreverPeriodicidade(p.repetir_a_cada, p.unidade_repeticao)}</span>
                    {p.ativo ? ` · próxima em ${formatarDia(p.proxima_execucao)}` : ' · desativado'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      )}

      {equipamento.chamados && (
        <Cartao
          titulo="Histórico de chamados"
          descricao={equipamento.chamados.length === 0 ? 'Nenhum chamado ainda.' : 'Os 50 mais recentes.'}
        >
          {equipamento.chamados.length > 0 && (
            <ul className="grid gap-2 text-sm">
              {equipamento.chamados.map((c) => (
                <li key={c.id} className="grid gap-1 rounded border border-borda px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link to={`/chamados/${c.id}`} className="font-medium text-navy hover:underline">
                      {c.titulo}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2">
                      {c.origem === 'preventiva' && (
                        <span className="rounded bg-sucesso-tenue px-2 py-0.5 text-xs font-medium text-sucesso">
                          Preventiva
                        </span>
                      )}
                      <BadgeEstado estado={c.estado} />
                    </div>
                  </div>
                  <p className="text-xs text-tinta-2">
                    {c.protocolo} · aberto em {new Date(c.data_abertura).toLocaleDateString('pt-BR')}
                    {c.data_conclusao &&
                      ` · concluído em ${new Date(c.data_conclusao).toLocaleDateString('pt-BR')}`}
                  </p>
                  {c.servico_realizado && (
                    <p className="text-xs text-tinta">Serviço: {c.servico_realizado}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      )}
    </div>
  );
}

export default Equipamento;

import { useEffect, useState } from 'react';
import api from '../api/client';
import Aviso from './ui/Aviso';
import Cartao from './ui/Cartao';

/**
 * Uso e desempenho do sistema (migração 031), para o administrador.
 *
 * Contadores por dia, sem ninguém: quantas vezes cada tela foi aberta, quão rápido ela abriu
 * (a média de cada medida e quantas passaram do limite que o Google chama de "bom") e quantas
 * vezes cada ação foi feita. Serve para decidir onde melhorar, e não para olhar pessoas: o
 * dado nem tem como dizer quem foi.
 *
 * Recolhido e só consulta ao abrir, como os erros do sistema.
 */

const ROTULO_TELA = {
  '/': 'Início',
  '/login': 'Entrar',
  '/cadastro': 'Cadastro',
  '/recuperar-senha': 'Recuperar senha',
  '/redefinir-senha': 'Redefinir senha',
  '/privacidade': 'Privacidade',
  '/termos': 'Termos de uso',
  '/cookies': 'Cookies e armazenamento',
  '/suporte': 'Ajuda e suporte',
  '/chamados/novo': 'Novo chamado',
  '/chamados/:id': 'Chamado',
  '/relatorios': 'Relatórios',
  '/usuarios': 'Usuários',
  '/cadastros': 'Cadastros',
  '/preventiva': 'Preventiva',
  '/equipamentos/:id': 'Equipamento',
  '/etiquetas': 'Etiquetas',
  '/conta': 'Minha conta',
  outra: 'Endereço inexistente',
};

const ROTULO_ACAO = {
  chamado_aberto: 'Chamados abertos',
  chamado_atribuido: 'Chamados atribuídos',
  estado_alterado: 'Estados alterados',
  chamado_concluido: 'Chamados concluídos',
  chamado_reaberto: 'Chamados reabertos',
  comentario_enviado: 'Comentários enviados',
  anexo_enviado: 'Anexos enviados',
  avaliacao_enviada: 'Avaliações enviadas',
  relatorio_baixado: 'Relatórios baixados',
  equipamento_cadastrado: 'Equipamentos cadastrados',
  plano_cadastrado: 'Planos preventivos cadastrados',
};

const UNIDADE = { LCP: 'ms', FCP: 'ms', INP: 'ms', CLS: '' };

const numero = (n) => Number(n).toLocaleString('pt-BR');

/** "1.240 ms (12% acima)": a média e quantas medidas passaram do limite. Vazio quando não houve medida. */
function medida(metricas, nome) {
  const m = metricas[nome];
  if (!m) return '—';
  const base = `${numero(m.media)}${UNIDADE[nome] ? ` ${UNIDADE[nome]}` : ''}`;
  return m.percentual_acima_do_limite > 0 ? `${base} (${m.percentual_acima_do_limite}% acima)` : base;
}

function UsoEDesempenho() {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!aberto || dados) return undefined;
    let ativo = true;
    api
      .get('/operacao/telemetria')
      .then(({ data }) => ativo && setDados(data))
      .catch(() => ativo && setErro('Não foi possível carregar o uso e o desempenho.'));
    return () => {
      ativo = false;
    };
  }, [aberto, dados]);

  return (
    <Cartao
      titulo="Uso e desempenho"
      descricao="Contadores por dia, sem dado de pessoa: quantas vezes cada tela abriu, quão rápido e o que se fez."
    >
      <details onToggle={(e) => setAberto(e.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-medium text-navy">Ver o uso dos últimos dias</summary>

        <div className="mt-3 grid gap-4">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {!erro && !dados && <p className="text-sm text-tinta-2">Carregando...</p>}
          {dados && (
            <>
              <p className="text-sm text-tinta-2">
                Últimos {dados.dias} dias. {dados.erros_da_tela_24h === 1 ? '1 erro de tela' : `${dados.erros_da_tela_24h} erros de tela`}{' '}
                nas últimas 24 horas (veja em “Erros do sistema”). Quem liga “Não rastrear” no navegador não entra na
                contagem.
              </p>

              {dados.telas.length === 0 ? (
                <p className="text-sm text-tinta-2">Ainda não há medidas neste período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-left text-sm">
                    <caption className="sr-only">Uso e desempenho de cada tela</caption>
                    <thead>
                      <tr className="border-b border-borda text-xs text-tinta-2">
                        <th scope="col" className="py-2 pr-3 font-medium">Tela</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Aberturas</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Primeiro conteúdo (FCP)</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Maior elemento (LCP)</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Pulos de layout (CLS)</th>
                        <th scope="col" className="py-2 font-medium">Resposta ao toque (INP)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.telas.map((t) => (
                        <tr key={t.tela} className="border-b border-borda/60">
                          <th scope="row" className="py-2 pr-3 font-medium text-tinta">{ROTULO_TELA[t.tela] ?? t.tela}</th>
                          <td className="py-2 pr-3">{numero(t.aberturas)}</td>
                          <td className="py-2 pr-3">{medida(t.desempenho, 'FCP')}</td>
                          <td className="py-2 pr-3">{medida(t.desempenho, 'LCP')}</td>
                          <td className="py-2 pr-3">{medida(t.desempenho, 'CLS')}</td>
                          <td className="py-2">{medida(t.desempenho, 'INP')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-tinta-2">
                “% acima” é a parte das medidas que passou do limite recomendado: {numero(dados.limites.FCP)} ms (FCP),{' '}
                {numero(dados.limites.LCP)} ms (LCP), {numero(dados.limites.CLS)} (CLS) e {numero(dados.limites.INP)} ms
                (INP). Mede a carga da página, não a troca de tela dentro do sistema.
              </p>

              {dados.acoes.length > 0 && (
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-navy">O que se fez</h3>
                  <ul className="grid gap-0.5 text-sm">
                    {dados.acoes.map((a) => (
                      <li key={a.acao}>
                        {ROTULO_ACAO[a.acao] ?? a.acao}: <strong>{numero(a.total)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </details>
    </Cartao>
  );
}

export default UsoEDesempenho;

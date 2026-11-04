import { useEffect, useState } from 'react';
import api from '../api/client';
import Aviso from './ui/Aviso';
import Cartao from './ui/Cartao';
import Tabela from './ui/Tabela';

/**
 * Os erros de servidor guardados (migração 028), para o administrador.
 *
 * Antes só existiam no console da função serverless, e na Vercel Hobby os logs
 * duram 1 hora: um erro das 2h da manhã já não existia às 9h. A tabela não tem
 * pessoa (nem usuário, nem IP, nem a query string), só rota, código e mensagem.
 *
 * Fica recolhida e só consulta ao abrir: a tela de Usuários não paga uma
 * consulta extra em toda visita para uma lista que quase sempre está vazia.
 */
function quando(instante) {
  return new Date(instante).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

const COLUNAS = [
  { chave: 'ocorrido_em', rotulo: 'Quando', conteudo: (e) => quando(e.ocorrido_em) },
  {
    chave: 'rota',
    rotulo: 'Onde',
    principal: true,
    conteudo: (e) => (
      <span className="font-mono text-xs">
        {e.metodo} {e.rota}
      </span>
    ),
  },
  { chave: 'status', rotulo: 'Código', conteudo: (e) => e.codigo ?? e.status },
  {
    chave: 'mensagem',
    rotulo: 'Mensagem',
    conteudo: (e) => (
      <div className="min-w-0">
        <p className="break-words">{e.mensagem}</p>
        {e.pilha && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-tinta-2">Ver pilha</summary>
            <pre className="mt-1 overflow-x-auto rounded bg-fundo p-2 text-xs">{e.pilha}</pre>
          </details>
        )}
      </div>
    ),
  },
];

function ErrosDoSistema() {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!aberto || dados) return undefined;
    let ativo = true;
    api
      .get('/operacao/erros')
      .then(({ data }) => ativo && setDados(data))
      .catch(() => ativo && setErro('Não foi possível carregar os erros do sistema.'));
    return () => {
      ativo = false;
    };
  }, [aberto, dados]);

  return (
    <Cartao
      titulo="Erros do sistema"
      descricao="Falhas de servidor e de tela dos últimos 30 dias. Sem dado de pessoa: só a rota, o código e a mensagem."
    >
      <details onToggle={(e) => setAberto(e.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-medium text-navy">Ver os erros recentes</summary>

        <div className="mt-3">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {!erro && !dados && <p className="text-sm text-tinta-2">Carregando...</p>}
          {dados && (
            <>
              <p className="mb-3 text-sm text-tinta-2">
                {dados.ultimas_24h === 1
                  ? '1 erro nas últimas 24 horas.'
                  : `${dados.ultimas_24h} erros nas últimas 24 horas.`}
              </p>
              <Tabela
                legenda="Erros de servidor, do mais recente para o mais antigo"
                chaveDaLinha={(e) => e.id}
                linhas={dados.erros}
                colunas={COLUNAS}
                vazio={<p className="text-sm text-tinta-2">Nenhum erro guardado nos últimos 30 dias.</p>}
              />
            </>
          )}
        </div>
      </details>
    </Cartao>
  );
}

export default ErrosDoSistema;

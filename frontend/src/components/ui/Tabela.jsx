import { useMemo, useState } from 'react';

/**
 * Tabela de dados administrativos.
 *
 * As três tabelas do sistema eram `<table>` cru dentro de um `overflow-x-auto`:
 * sem legenda, sem `scope` nas colunas, sem ordenação, e no celular viravam
 * rolagem lateral de cinco colunas — o formato mais difícil de ler que existe
 * numa tela de 393px.
 *
 * DUAS APRESENTAÇÕES DO MESMO DADO
 *
 * A partir de `sm`, tabela de verdade: é a forma certa de comparar números
 * entre linhas, que é para o que serve um relatório.
 *
 * Abaixo de `sm`, cada registro vira um bloco com rótulo ao lado do valor.
 * Não é uma tabela encolhida — é outro arranjo, porque comparar entre linhas
 * deixa de ser possível num celular de qualquer jeito, e aí o que importa é
 * ler um registro por vez sem rolar para o lado.
 *
 * SOBRE `scope`
 *
 * `scope="col"` no cabeçalho e `scope="row"` na coluna de identidade são o que
 * permitem ao leitor de tela dizer "Local: Prédio A, Atrasados: 3" ao navegar
 * célula a célula. Sem isso ele lê "3", e a pessoa não sabe 3 de quê.
 */

function ordenarPor(linhas, chave, direcao) {
  if (!chave) return linhas;

  return [...linhas].sort((a, b) => {
    const x = a[chave];
    const y = b[chave];

    // Números comparam como números; o resto compara como texto em português,
    // para "Ática" não cair depois de "Zebra".
    const comparacao =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR');

    return direcao === 'desc' ? -comparacao : comparacao;
  });
}

function Tabela({ legenda, colunas, linhas, chaveDaLinha, ordenavel = false, vazio }) {
  const [ordem, setOrdem] = useState({ chave: null, direcao: 'asc' });

  const ordenadas = useMemo(
    () => (ordenavel ? ordenarPor(linhas, ordem.chave, ordem.direcao) : linhas),
    [linhas, ordem, ordenavel]
  );

  function alternarOrdem(chave) {
    setOrdem((atual) =>
      atual.chave === chave
        ? { chave, direcao: atual.direcao === 'asc' ? 'desc' : 'asc' }
        : { chave, direcao: 'asc' }
    );
  }

  if (linhas.length === 0 && vazio) return vazio;

  const principal = colunas.find((c) => c.principal) ?? colunas[0];
  const demais = colunas.filter((c) => c !== principal);

  function conteudo(coluna, linha) {
    return coluna.conteudo ? coluna.conteudo(linha) : linha[coluna.chave];
  }

  return (
    <>
      {/* Tabela a partir de sm */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          {/* A legenda é o nome da tabela para quem não vê o título do cartão
              acima dela. Fica reservada ao leitor de tela para não repetir o
              que já está escrito logo acima. */}
          <caption className="sr-only">{legenda}</caption>

          <thead>
            <tr className="border-b border-borda text-left text-tinta-2">
              {colunas.map((coluna) => {
                const ativa = ordem.chave === coluna.chave;
                return (
                  <th
                    key={coluna.chave}
                    scope="col"
                    // aria-sort é o que anuncia a ordenação; a seta é o mesmo
                    // sinal para quem enxerga.
                    aria-sort={
                      ordenavel
                        ? ativa
                          ? ordem.direcao === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                        : undefined
                    }
                    className={`py-2 pr-4 font-medium ${coluna.numerica ? 'text-right' : ''}`}
                  >
                    {ordenavel ? (
                      <button
                        type="button"
                        onClick={() => alternarOrdem(coluna.chave)}
                        className={`inline-flex items-center gap-1 rounded font-medium hover:text-navy ${
                          coluna.numerica ? 'flex-row-reverse' : ''
                        }`}
                      >
                        {coluna.rotulo}
                        <span aria-hidden="true" className={ativa ? 'text-navy' : 'text-borda-forte'}>
                          {ativa && ordem.direcao === 'desc' ? '▾' : '▴'}
                        </span>
                      </button>
                    ) : (
                      coluna.rotulo
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {ordenadas.map((linha) => (
              <tr key={chaveDaLinha(linha)} className="border-b border-borda last:border-0">
                {colunas.map((coluna) =>
                  coluna === principal ? (
                    <th
                      key={coluna.chave}
                      scope="row"
                      className="py-2 pr-4 text-left font-medium text-navy"
                    >
                      {conteudo(coluna, linha)}
                    </th>
                  ) : (
                    <td
                      key={coluna.chave}
                      className={`py-2 pr-4 ${
                        // tabular-nums alinha os dígitos em colunas de mesma
                        // largura: sem isso, "1.204" e "999" dançam na
                        // vertical e a comparação visual se perde.
                        coluna.numerica ? 'text-right tabular-nums' : ''
                      }`}
                    >
                      {conteudo(coluna, linha)}
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Blocos abaixo de sm */}
      <ul className="grid gap-2 sm:hidden">
        {ordenadas.map((linha) => (
          <li
            key={chaveDaLinha(linha)}
            className="rounded border border-borda p-3 text-sm min-w-0"
          >
            <p className="font-medium text-navy break-words">{conteudo(principal, linha)}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              {demais.map((coluna) => (
                <div key={coluna.chave} className="flex items-baseline justify-between gap-2 min-w-0">
                  <dt className="text-xs text-tinta-2 truncate">{coluna.rotulo}</dt>
                  <dd className={`font-medium ${coluna.numerica ? 'tabular-nums' : ''}`}>
                    {conteudo(coluna, linha)}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

export default Tabela;

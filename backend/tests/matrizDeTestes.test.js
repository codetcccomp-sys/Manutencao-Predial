const fs = require('fs');
const path = require('path');

/**
 * A matriz de testes (docs/matriz-de-testes.md) liga cada regra ao teste que a prova.
 *
 * Documento que cita teste envelhece em silêncio: o teste é renomeado, o arquivo muda
 * de lugar, e a matriz segue afirmando uma prova que ninguém mais acha. Este arquivo
 * é o que impede isso, por dois lados:
 *
 * - tudo que a matriz cita existe, com o título escrito igual;
 * - todo arquivo de teste do repositório aparece na matriz, e é por isso que um teste
 *   novo vai para uma linha da seção certa ou para a tabela de "outras suítes".
 *
 * Não confere se o teste prova mesmo a regra da linha: isso é leitura de gente, e a
 * mutação (tests/mutacao.js) é quem diz se o teste pega o defeito.
 */

const RAIZ = path.join(__dirname, '..', '..');
const MATRIZ = fs.readFileSync(path.join(RAIZ, 'docs', 'matriz-de-testes.md'), 'utf8');

// Linhas de tabela com 4 colunas cuja 3ª é um caminho entre crases e cuja 4ª é o título.
function citacoes() {
  const achadas = [];
  for (const linha of MATRIZ.split('\n')) {
    if (!linha.startsWith('|')) continue;
    const celulas = linha.split('|').slice(1, -1).map((c) => c.trim());
    const caminho = celulas[2] && /^`([^`]+)`$/.exec(celulas[2]);
    if (celulas.length === 4 && caminho && celulas[3]) {
      achadas.push({ regra: celulas[0], arquivo: caminho[1], titulo: celulas[3] });
    }
  }
  return achadas;
}

const PASTAS = [
  ['backend/tests', /\.test\.js$/],
  ['frontend/testes', /\.test\.jsx?$/],
  ['frontend/e2e', /\.spec\.js$/],
];

function arquivosDeTeste() {
  return PASTAS.flatMap(([pasta, padrao]) =>
    fs
      .readdirSync(path.join(RAIZ, pasta))
      .filter((nome) => padrao.test(nome))
      .map((nome) => `${pasta}/${nome}`)
  );
}

describe('Matriz de testes', () => {
  const linhas = citacoes();

  it('tem linhas de regra, e não só a tabela de outras suítes', () => {
    expect(linhas.length).toBeGreaterThan(50);
  });

  it('todo arquivo citado existe', () => {
    const faltando = linhas.filter((l) => !fs.existsSync(path.join(RAIZ, l.arquivo)));
    expect(faltando.map((l) => `${l.regra}: ${l.arquivo}`)).toEqual([]);
  });

  it('todo título citado está escrito igual no arquivo', () => {
    const sumidos = linhas
      .filter((l) => fs.existsSync(path.join(RAIZ, l.arquivo)))
      .filter((l) => !fs.readFileSync(path.join(RAIZ, l.arquivo), 'utf8').includes(l.titulo));
    expect(sumidos.map((l) => `${l.arquivo}: "${l.titulo}"`)).toEqual([]);
  });

  it('todo arquivo de teste do repositório aparece na matriz', () => {
    const fora = arquivosDeTeste().filter((arquivo) => !MATRIZ.includes(arquivo));
    // Teste novo: ponha-o numa linha da seção da regra que ele prova, ou na tabela
    // "Outras suítes" de docs/matriz-de-testes.md.
    expect(fora).toEqual([]);
  });
});

const fs = require('fs');
const path = require('path');

/**
 * O Node que os testes rodam tem de ser o Node que vai ao ar.
 *
 * Os projetos da Vercel rodam 24.x e o CI só testava a 22: o que ia para produção
 * rodava numa versão em que nenhum teste tinha rodado. Agora os dois `package.json`
 * declaram as versões suportadas (`engines`) e o CI testa o backend e o frontend em
 * cada uma. Este arquivo impede que as duas coisas se separem: uma versão sai da
 * lista do CI, ou entra em `engines` sem ser testada.
 */

const RAIZ = path.join(__dirname, '..', '..');
const ler = (caminho) => fs.readFileSync(path.join(RAIZ, caminho), 'utf8');

const majores = (faixa) => [...faixa.matchAll(/\d+/g)].map((m) => m[0]);

describe('Versão do Node', () => {
  const engines = {
    backend: JSON.parse(ler('backend/package.json')).engines?.node,
    frontend: JSON.parse(ler('frontend/package.json')).engines?.node,
  };
  const ci = ler('.github/workflows/ci.yml');

  it('o backend e o frontend declaram as mesmas versões em engines', () => {
    expect(engines.backend).toBeTruthy();
    expect(engines.frontend).toBe(engines.backend);
  });

  it('o CI testa o backend e o frontend em cada versão declarada', () => {
    const matrizes = [...ci.matchAll(/matrix:\s*\n\s*node:\s*\[([^\]]+)\]/g)].map((m) =>
      [...m[1].matchAll(/\d+/g)].map((n) => n[0])
    );

    // Dois jobs com matriz: backend e frontend.
    expect(matrizes).toHaveLength(2);
    for (const versoes of matrizes) {
      expect(versoes.sort()).toEqual(majores(engines.backend).sort());
    }
  });

  it('os dois jobs usam a versão da matriz, não uma fixa', () => {
    expect(ci.match(/node-version:\s*\$\{\{\s*matrix\.node\s*\}\}/g) ?? []).toHaveLength(2);
  });
});

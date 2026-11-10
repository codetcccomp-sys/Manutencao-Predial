const fs = require('fs');
const path = require('path');

/**
 * A Vercel monta a função a partir do que consegue enxergar de forma ESTÁTICA no
 * código (`require('./x')` com texto literal). `require(variavel)` não entra no
 * pacote: no disco, onde os testes rodam, o arquivo existe e tudo passa; na
 * função publicada vem "Cannot find module './routes/auth.routes'" e a API inteira
 * responde 500 (10/11/2026, PR #102). Estes testes olham o que a Vercel olha.
 */
const RAIZ = path.join(__dirname, '..');
const SRC = path.join(RAIZ, 'src');

const listar = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listar(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []
  );

// Tira comentários antes de procurar, para a explicação do porquê não contar como código.
const semComentarios = (texto) => texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const REQUIRE = /\brequire\(\s*([^)]*?)\s*\)/g;

describe('Empacotamento na Vercel', () => {
  it('todo require do código da API recebe texto literal, que a Vercel consegue seguir', () => {
    const dinamicos = [];
    for (const arquivo of [path.join(RAIZ, 'api', 'index.js'), ...listar(SRC)]) {
      const codigo = semComentarios(fs.readFileSync(arquivo, 'utf8'));
      for (const m of codigo.matchAll(REQUIRE)) {
        if (!/^(['"]).*\1$/.test(m[1])) dinamicos.push(`${path.relative(RAIZ, arquivo)}: require(${m[1]})`);
      }
    }

    expect(dinamicos).toEqual([]);
  });

  it('a partir de api/index.js se chega, por require literal, a todo arquivo de rotas', () => {
    const visitados = new Set();
    const seguir = (arquivo) => {
      if (visitados.has(arquivo) || !fs.existsSync(arquivo)) return;
      visitados.add(arquivo);
      const codigo = semComentarios(fs.readFileSync(arquivo, 'utf8'));
      for (const m of codigo.matchAll(/\brequire\(\s*(['"])(\.[^'"]*)\1\s*\)/g)) {
        const alvo = path.resolve(path.dirname(arquivo), m[2]);
        seguir(alvo.endsWith('.js') ? alvo : `${alvo}.js`);
      }
    };
    seguir(path.join(RAIZ, 'api', 'index.js'));

    const fora = listar(path.join(SRC, 'routes'))
      .filter((f) => !visitados.has(f))
      .map((f) => path.relative(RAIZ, f));

    expect(fora).toEqual([]);
  });
});

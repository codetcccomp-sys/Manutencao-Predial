const fs = require('fs');
const path = require('path');

/**
 * Os projetos da Vercel deste repositório (README, "Projetos na Vercel").
 *
 * O primeiro projeto, `manutencao-predial`, aponta para a RAIZ do repositório, sem framework nem
 * build, e publicava os arquivos do repositório como estáticos a cada push. O `vercel.json` da raiz
 * desliga as implantações dele. Os outros quatro projetos têm pasta própria e leem o `vercel.json`
 * dessa pasta, não o da raiz: este teste confere as duas pontas, porque desligar o de uma pasta
 * por engano pararia a produção sem nenhum erro.
 */
const RAIZ = path.join(__dirname, '..', '..');
const ler = (...partes) => JSON.parse(fs.readFileSync(path.join(RAIZ, ...partes), 'utf8'));

describe('vercel.json', () => {
  it('o da raiz desliga as implantações do projeto legado, que não serve nada', () => {
    expect(ler('vercel.json').git.deploymentEnabled).toBe(false);
  });

  it('os das pastas dos projetos que servem o sistema e a demonstração não o desligam', () => {
    for (const pasta of ['backend', 'frontend', path.join('demo', 'frontend')]) {
      const config = ler(pasta, 'vercel.json');
      // O nome da pasta vai na própria comparação: a mensagem do Jest não aceita um segundo argumento.
      expect({ pasta, desligado: config.git?.deploymentEnabled === false }).toEqual({ pasta, desligado: false });
    }
  });
});

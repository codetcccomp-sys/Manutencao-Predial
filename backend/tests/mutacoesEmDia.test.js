const fs = require('fs');
const path = require('path');
const { MUTACOES } = require('./mutacao');

/**
 * As mutações de `tests/mutacao.js` não rodam no CI (levam o tempo das suítes
 * vezes o número de mutações). O risco de deixá-las fora é elas envelhecerem:
 * o código muda, o trecho "de" deixa de existir, e a mutação passa a responder
 * DESATUALIZADA para quem nunca mais a roda. A trava continua lá, mas sem
 * ninguém provando que a suíte a vigia. Três estavam assim em novembro de 2026.
 *
 * Este arquivo roda no CI e é barato: só confere que cada mutação ainda acha o
 * seu trecho. Não prova que a suíte a acusa (isso é `node tests/mutacao.js`).
 */
const RAIZ = path.join(__dirname, '..');
const ler = (arquivo) => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');

describe('Mutações do backend em dia', () => {
  it('toda mutação ainda encontra no código o trecho que desfaz', () => {
    const desatualizadas = MUTACOES.filter((m) => !ler(m.arquivo).includes(m.de)).map(
      (m) => `${m.descricao} (${m.arquivo})`
    );

    expect(desatualizadas).toEqual([]);
  });

  it('toda mutação muda alguma coisa e aponta para uma suíte que existe', () => {
    const invalidas = MUTACOES.filter(
      (m) => m.de === m.para || !m.spec.split(' ').every((s) => fs.existsSync(path.join(RAIZ, s)))
    ).map((m) => m.descricao);

    expect(invalidas).toEqual([]);
  });

  it('cada descrição é única, para o filtro por texto achar uma mutação só', () => {
    const descricoes = MUTACOES.map((m) => m.descricao);
    const repetidas = descricoes.filter((d, i) => descricoes.indexOf(d) !== i);

    expect(repetidas).toEqual([]);
  });
});

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { MUTACOES } from './mutacao.mjs';

/**
 * As mutações de `testes/mutacao.mjs` não rodam no CI (levam o tempo das suítes
 * vezes o número de mutações). O risco de deixá-las fora é elas envelhecerem: o
 * código muda, o trecho "de" deixa de existir, e a mutação passa a responder
 * DESATUALIZADA para quem nunca mais a roda. Nove estavam assim em novembro de
 * 2026, entre elas a do segundo fator no login e a do foco na troca de tela.
 *
 * Este arquivo roda no CI e é barato: só confere que cada mutação ainda acha o
 * seu trecho. Não prova que a suíte a acusa (isso é `npm run mutacao`).
 */
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ler = (arquivo) => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');

describe('Mutações do frontend em dia', () => {
  it('toda mutação ainda encontra no código o trecho que desfaz', () => {
    const desatualizadas = MUTACOES.filter((m) => !ler(m.arquivo).includes(m.de)).map(
      (m) => `${m.descricao} (${m.arquivo})`
    );

    expect(desatualizadas).toEqual([]);
  });

  it('toda mutação muda alguma coisa e aponta para uma suíte que existe', () => {
    const invalidas = MUTACOES.filter((m) => m.de === m.para || !fs.existsSync(path.join(RAIZ, m.spec))).map(
      (m) => m.descricao
    );

    expect(invalidas).toEqual([]);
  });

  // Sem `motor: 'playwright'` a mutação de layout roda no Vitest contra uma spec do
  // Playwright, "falha" por não achar teste nenhum e conta como acusada.
  it('mutação com spec de ponta a ponta roda no Playwright, e as demais no Vitest', () => {
    const trocadas = MUTACOES.filter((m) => m.spec.startsWith('e2e/') !== (m.motor === 'playwright')).map(
      (m) => m.descricao
    );

    expect(trocadas).toEqual([]);
  });

  it('cada descrição é única, para o filtro por texto achar uma mutação só', () => {
    const descricoes = MUTACOES.map((m) => m.descricao);
    const repetidas = descricoes.filter((d, i) => descricoes.indexOf(d) !== i);

    expect(repetidas).toEqual([]);
  });
});

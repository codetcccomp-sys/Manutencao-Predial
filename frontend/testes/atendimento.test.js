import { describe, expect, it } from 'vitest';
import { minutosSemAtendimento, tempoEmPalavras } from '../src/dominio/atendimento';

const AGORA = Date.parse('2026-10-13T12:00:00Z');
const antes = (minutos) => new Date(AGORA - minutos * 60_000).toISOString();

describe('minutosSemAtendimento', () => {
  it('conta minutos inteiros desde a abertura', () => {
    expect(minutosSemAtendimento(antes(23), AGORA)).toBe(23);
  });

  it('arredonda para baixo: 23 min e 59 s ainda são 23', () => {
    expect(minutosSemAtendimento(new Date(AGORA - (23 * 60 + 59) * 1000).toISOString(), AGORA)).toBe(23);
  });

  it('data no futuro (relógio do aparelho atrasado) não vira número negativo', () => {
    expect(minutosSemAtendimento(antes(-5), AGORA)).toBe(0);
  });

  it('data inválida ou ausente devolve null', () => {
    expect(minutosSemAtendimento('isto não é data', AGORA)).toBeNull();
    expect(minutosSemAtendimento(undefined, AGORA)).toBeNull();
  });
});

describe('tempoEmPalavras', () => {
  it.each([
    [0, '0 min'],
    [16, '16 min'],
    [59, '59 min'],
    [60, '1 h'],
    [65, '1 h 05 min'],
    [125, '2 h 05 min'],
    [1439, '23 h 59 min'],
    [1440, '1 d'],
    [1500, '1 d 1 h'],
    [4320, '3 d'],
  ])('%i minutos → %s', (minutos, esperado) => {
    expect(tempoEmPalavras(minutos)).toBe(esperado);
  });

  it('sem número, devolve texto vazio', () => {
    expect(tempoEmPalavras(null)).toBe('');
  });
});

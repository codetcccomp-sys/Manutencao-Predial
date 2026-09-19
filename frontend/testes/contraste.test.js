import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * O contraste dos tokens, como teste.
 *
 * O âmbar antigo reprovava em todo lugar onde aparecia — inclusive no botão
 * principal do sistema, com 2,71:1 — e ninguém notou por anos, porque nada
 * falha quando uma cor fica ilegível: o build passa, a tela abre, e só quem
 * tem dificuldade de enxergar descobre.
 *
 * Aqui cada par documentado é medido. Quem escurecer um token "só um pouco"
 * para melhorar a aparência vai ver a suíte reclamar antes do commit, com o
 * número exato e o mínimo exigido.
 */

// Caminho a partir da raiz do projeto: no ambiente jsdom do Vitest,
// `import.meta.url` não é uma URL de arquivo e `fileURLToPath` recusa.
const CSS = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

/** Lê `--cor-x: 138 83 0;` do index.css e devolve os canais. */
function token(nome) {
  const achado = CSS.match(new RegExp(`--cor-${nome}:\\s*([\\d\\s]+);`));
  if (!achado) throw new Error(`Token --cor-${nome} não existe em index.css.`);
  return achado[1].trim().split(/\s+/).map(Number);
}

/** Luminância relativa, conforme a definição da WCAG 2.1. */
function luminancia([r, g, b]) {
  const [vr, vg, vb] = [r, g, b].map((canal) => {
    const v = canal / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * vr + 0.7152 * vg + 0.0722 * vb;
}

function razao(frente, fundo) {
  const a = luminancia(token(frente));
  const b = luminancia(token(fundo));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Mínimos da WCAG 2.1 AA: 4,5:1 para texto normal, 3:1 para elemento gráfico
// e para texto grande (a partir de 18,66px em negrito ou 24px).
const TEXTO = 4.5;
const GRAFICO = 3;

describe('Contraste dos tokens (WCAG 2.1 AA)', () => {
  const paresDeTexto = [
    ['tinta', 'superficie', 'texto principal no cartão'],
    ['tinta', 'fundo', 'texto principal sobre o fundo da página'],
    ['tinta-2', 'superficie', 'texto auxiliar no cartão'],
    ['tinta-2', 'fundo', 'texto auxiliar sobre o fundo'],
    ['navy', 'superficie', 'título e link no cartão'],
    ['superficie', 'navy', 'texto sobre a ação primária'],
    ['superficie', 'navy-2', 'texto sobre a ação primária em hover'],
    ['tinta-clara', 'navy', 'links do cabeçalho'],
    ['navy-2', 'ambar-claro', 'contador do sino, sobre o cabeçalho'],
    ['ambar', 'superficie', 'texto de atenção no cartão'],
    ['ambar', 'fundo', 'texto de atenção sobre o fundo'],
    ['superficie', 'ambar', 'texto sobre fundo de atenção'],
    ['erro', 'superficie', 'texto de erro'],
    ['erro', 'erro-tenue', 'badge de erro'],
    ['sucesso', 'superficie', 'texto de sucesso'],
    ['sucesso', 'sucesso-tenue', 'badge de sucesso'],
    ['atencao', 'atencao-tenue', 'badge de atenção'],
    ['info', 'superficie', 'texto informativo'],
    ['info', 'info-tenue', 'badge informativo'],
    ['neutro', 'neutro-tenue', 'badge neutro'],
    ['andamento', 'andamento-tenue', 'badge de execução'],
  ];

  it.each(paresDeTexto)('%s sobre %s — %s', (frente, fundo, papel) => {
    const medido = razao(frente, fundo);
    expect(
      medido,
      `${papel}: ${medido.toFixed(2)}:1, abaixo do mínimo de ${TEXTO}:1`
    ).toBeGreaterThanOrEqual(TEXTO);
  });

  it('a borda se distingue da superfície que ela separa', () => {
    // Borda é elemento gráfico, não texto: o mínimo é 3:1 — e é o que separa
    // um campo de formulário do cartão branco atrás dele.
    expect(razao('borda-forte', 'superficie')).toBeGreaterThanOrEqual(GRAFICO);
  });

  it('o âmbar de superfície clara reprova sobre o navy, e é por isso que existe o claro', () => {
    // Guarda o motivo de haver dois tokens. Se alguém unificá-los um dia, este
    // teste explica o que se perde — e o par de cima (tinta-clara sobre navy)
    // falha junto.
    expect(razao('ambar', 'navy')).toBeLessThan(GRAFICO);
    expect(razao('ambar-claro', 'navy')).toBeGreaterThanOrEqual(TEXTO);
  });
});

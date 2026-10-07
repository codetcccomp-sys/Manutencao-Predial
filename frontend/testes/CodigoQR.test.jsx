import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import jsQR from 'jsqr';
import CodigoQR, { matrizQR } from '../src/components/ui/CodigoQR';
import { enderecoDeAbertura } from '../src/dominio/preventiva';

/**
 * Um QR que desenha mas não lê é pior que nenhum: a etiqueta vai para a
 * parede e ninguém descobre que ela não abre nada. Aqui a matriz é
 * rasterizada à mão e lida por um decodificador de verdade (o jsQR).
 */
function ler(texto) {
  const { n, escuros } = matrizQR(texto);
  const escala = 4;
  const margem = 4;
  const lado = (n + margem * 2) * escala;
  const pixels = new Uint8ClampedArray(lado * lado * 4).fill(255);
  for (const [x, y] of escuros) {
    for (let dy = 0; dy < escala; dy++) {
      for (let dx = 0; dx < escala; dx++) {
        const i = (((y + margem) * escala + dy) * lado + (x + margem) * escala + dx) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
      }
    }
  }
  return jsQR(pixels, lado, lado)?.data;
}

describe('QR Code das etiquetas', () => {
  it('o código do equipamento lê como o endereço de abertura do chamado', () => {
    const endereco = enderecoDeAbertura(
      { equipamento: { codigo: 'AC-204/BLOCO.B' } },
      'https://conserva-predial.vercel.app'
    );
    expect(endereco).toBe('https://conserva-predial.vercel.app/chamados/novo?equipamento=AC-204%2FBLOCO.B');
    expect(ler(endereco)).toBe(endereco);
  });

  it('a etiqueta da sala leva o local', () => {
    const endereco = enderecoDeAbertura({ local: { id: 42 } }, 'https://exemplo.org');
    expect(ler(endereco)).toBe('https://exemplo.org/chamados/novo?local=42');
  });

  it('o SVG tem nome acessível e desenha só com <path>, sem estilo inline', () => {
    const { container } = render(<CodigoQR texto="https://exemplo.org" rotulo="QR da bomba" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg).toHaveAttribute('aria-label', 'QR da bomba');
    expect(container.querySelector('[style]')).toBeNull();
    expect(container.querySelector('path').getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/);
  });
});

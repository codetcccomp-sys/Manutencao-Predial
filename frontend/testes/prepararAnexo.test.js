import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LADO_MAXIMO, prepararAnexo, formatarTamanho } from '../src/dominio/prepararAnexo';

/**
 * O jsdom não decodifica imagem nem desenha em canvas, então aqui os dois são
 * dublês que registram o que receberam. O que se verifica é a decisão — qual
 * arquivo reduzir, para qual tamanho, e quando desistir e mandar o original.
 * Que o navegador de verdade reduz uma foto de 4000 px está no e2e
 * (anexos.spec.js), com o Chromium decodificando um arquivo real.
 */

const MB = 1024 * 1024;

function arquivo(nome, tipo, bytes) {
  return new File([new Uint8Array(bytes)], nome, { type: tipo, lastModified: 1 });
}

let desenhado;
let fechou;

function simularImagem(largura, altura, { tamanhoDoJpeg = 300 * 1024 } = {}) {
  fechou = false;
  globalThis.createImageBitmap = vi.fn(async () => ({
    width: largura,
    height: altura,
    close: () => {
      fechou = true;
    },
  }));

  desenhado = null;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    const canvas = this;
    return {
      fillRect: vi.fn(),
      drawImage: (_img, _x, _y, l, a) => {
        desenhado = { largura: l, altura: a, canvas: { largura: canvas.width, altura: canvas.height } };
      },
      set fillStyle(_v) {},
    };
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, tipo) => {
    callback(new Blob([new Uint8Array(tamanhoDoJpeg)], { type: tipo }));
  });
}

beforeEach(() => {
  delete globalThis.createImageBitmap;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.createImageBitmap;
});

describe('prepararAnexo', () => {
  it('reduz a foto grande para o lado máximo, em JPEG, mantendo a proporção', async () => {
    simularImagem(4000, 3000);
    const original = arquivo('vazamento.png', 'image/png', 6 * MB);

    const pronto = await prepararAnexo(original);

    expect(desenhado.largura).toBe(LADO_MAXIMO);
    expect(desenhado.altura).toBe(1200);
    expect(desenhado.canvas).toEqual({ largura: LADO_MAXIMO, altura: 1200 });
    expect(pronto.type).toBe('image/jpeg');
    expect(pronto.name).toBe('vazamento.jpg');
    expect(pronto.size).toBe(300 * 1024);
    // A orientação da câmera é aplicada na decodificação: sem ela, a foto
    // tirada em pé chegava deitada.
    expect(globalThis.createImageBitmap).toHaveBeenCalledWith(original, {
      imageOrientation: 'from-image',
    });
    expect(fechou).toBe(true);
  });

  it('foto em pé fica limitada pela altura', async () => {
    simularImagem(3000, 4000);
    await prepararAnexo(arquivo('poste.jpg', 'image/jpeg', 5 * MB));
    expect(desenhado).toMatchObject({ largura: 1200, altura: LADO_MAXIMO });
  });

  it('foto pequena em pixels mas pesada é recodificada sem ser ampliada', async () => {
    simularImagem(1000, 800);
    await prepararAnexo(arquivo('placa.png', 'image/png', 2 * MB));
    expect(desenhado).toMatchObject({ largura: 1000, altura: 800 });
  });

  it('não mexe em foto que já é leve', async () => {
    simularImagem(4000, 3000);
    const leve = arquivo('ok.jpg', 'image/jpeg', 500 * 1024);
    expect(await prepararAnexo(leve)).toBe(leve);
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });

  it('não mexe em PDF, por maior que seja', async () => {
    simularImagem(4000, 3000);
    const pdf = arquivo('laudo.pdf', 'application/pdf', 9 * MB);
    expect(await prepararAnexo(pdf)).toBe(pdf);
  });

  it('se recodificar sair maior, manda o original', async () => {
    simularImagem(1200, 900, { tamanhoDoJpeg: 3 * MB });
    const original = arquivo('planta.png', 'image/png', 2 * MB);
    expect(await prepararAnexo(original)).toBe(original);
  });

  it('se o navegador não decodifica o arquivo, manda o original e deixa o servidor decidir', async () => {
    globalThis.createImageBitmap = vi.fn(async () => {
      throw new Error('formato desconhecido');
    });
    const original = arquivo('foto.webp', 'image/webp', 5 * MB);
    expect(await prepararAnexo(original)).toBe(original);
  });

  it('navegador sem createImageBitmap manda o original', async () => {
    const original = arquivo('foto.jpg', 'image/jpeg', 5 * MB);
    expect(await prepararAnexo(original)).toBe(original);
  });
});

describe('formatarTamanho', () => {
  it('escreve no formato de quem lê', () => {
    expect(formatarTamanho(3.25 * MB)).toBe('3,3 MB');
    expect(formatarTamanho(4 * MB)).toBe('4 MB');
    expect(formatarTamanho(820 * 1024)).toBe('820 KB');
    expect(formatarTamanho(512)).toBe('512 B');
  });
});

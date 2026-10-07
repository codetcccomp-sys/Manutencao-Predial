import { test, expect } from '@playwright/test';
import { montarCenario, entrar } from './apoio.js';

/**
 * A foto do celular chega ao chamado.
 *
 * O teste de componente prova a decisão (o que reduzir, para quanto) com
 * dublês; este prova que o navegador de verdade decodifica, reduz e envia uma
 * foto do tamanho que uma câmera produz — o caso que antes terminava em "maior
 * que o limite" depois de esperar o envio inteiro.
 */

const API = process.env.E2E_API ?? 'http://localhost:3333';

let cenario;

test.beforeAll(async () => {
  cenario = await montarCenario({ perfis: ['solicitante'] });
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

/**
 * Uma foto "de câmera": 4000×3000 em JPEG de alta qualidade, com ruído para
 * que a compressão não a deixe artificialmente leve. É gerada pelo próprio
 * navegador para não versionar um arquivo de vários MB no repositório.
 */
async function fotoDeCamera(page) {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4000;
    canvas.height = 3000;
    const ctx = canvas.getContext('2d');
    const faixa = ctx.createImageData(4000, 100);
    for (let y = 0; y < 3000; y += 100) {
      for (let i = 0; i < faixa.data.length; i += 4) {
        faixa.data[i] = Math.random() * 255;
        faixa.data[i + 1] = Math.random() * 255;
        faixa.data[i + 2] = Math.random() * 255;
        faixa.data[i + 3] = 255;
      }
      ctx.putImageData(faixa, 0, y);
    }
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.95));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binario = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binario);
  });
  return Buffer.from(base64, 'base64');
}

/** Largura e altura lidas do cabeçalho do JPEG (marcador SOF). */
function dimensoesDoJpeg(buffer) {
  let i = 2;
  while (i < buffer.length) {
    if (buffer[i] !== 0xff) return null;
    const marcador = buffer[i + 1];
    const tamanho = buffer.readUInt16BE(i + 2);
    if (marcador >= 0xc0 && marcador <= 0xc3) {
      return { altura: buffer.readUInt16BE(i + 5), largura: buffer.readUInt16BE(i + 7) };
    }
    i += 2 + tamanho;
  }
  return null;
}

test('foto de câmera acima de 4 MB é reduzida no navegador e entra no chamado', async ({ page }) => {
  const chamado = await cenario.abrirChamado({ titulo: `Infiltração no teto ${cenario.marca}` });
  await entrar(page, cenario.pessoas.solicitante);
  await page.goto(`/chamados/${chamado.id}`);
  await page.waitForSelector('h2:has-text("Anexos")');

  const foto = await fotoDeCamera(page);
  expect(foto.length).toBeGreaterThan(4 * 1024 * 1024);

  await page.getByLabel(/adicionar anexo/i).setInputFiles({
    name: 'IMG_2026.jpeg',
    mimeType: 'image/jpeg',
    buffer: foto,
  });

  await expect(page.getByRole('button', { name: 'IMG_2026.jpg' })).toBeVisible({ timeout: 20_000 });

  // O que o servidor guardou: JPEG, abaixo do limite, com 1600 px no lado maior.
  const { anexos } = await cenario.pessoas.solicitante.get(`/chamados/${chamado.id}/anexos`).then((r) => r.corpo);
  expect(anexos).toHaveLength(1);
  expect(anexos[0].mime_type).toBe('image/jpeg');
  expect(anexos[0].tamanho_bytes).toBeLessThan(4 * 1024 * 1024);

  const conteudo = await cenario.contexto.get(`${API}/chamados/${chamado.id}/anexos/${anexos[0].id}/conteudo`, {
    headers: { Authorization: `Bearer ${cenario.pessoas.solicitante.token}` },
  });
  expect(dimensoesDoJpeg(await conteudo.body())).toEqual({ largura: 1600, altura: 1200 });
});

test('PDF acima do limite é recusado na hora, sem esperar o envio', async ({ page }) => {
  const chamado = await cenario.abrirChamado({ titulo: `Laudo grande ${cenario.marca}` });
  await entrar(page, cenario.pessoas.solicitante);
  await page.goto(`/chamados/${chamado.id}`);
  await page.waitForSelector('h2:has-text("Anexos")');

  const envios = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/anexos')) envios.push(r.url());
  });

  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024)]);
  await page.getByLabel(/adicionar anexo/i).setInputFiles({
    name: 'laudo.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  });

  await expect(page.getByText(/"laudo\.pdf" tem 5 MB; o limite é 4 MB/)).toBeVisible();
  expect(envios).toEqual([]);
});

import { test, expect } from '@playwright/test';
import jsQR from 'jsqr';
import { montarCenario, entrar } from './apoio.js';

/**
 * Instalável, utilizável sem conexão para consultar, e com etiquetas que de
 * fato abrem o chamado.
 *
 * O "sem conexão" aqui é o do navegador de verdade (context.setOffline), com o
 * service worker da build — o mesmo arquivo que vai ao ar.
 */

let cenario;

test.beforeAll(async () => {
  cenario = await montarCenario();
});

test.afterAll(async () => {
  await cenario?.encerrar();
});

async function esperarServiceWorker(page) {
  // Registrado no `load`; `ready` resolve quando há um ativo. O controle da
  // página começa no clients.claim() da ativação.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

test('o manifesto descreve um app instalável, com ícones que existem', async ({ page, request }) => {
  await page.goto('/login');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const resposta = await request.get(href);
  expect(resposta.ok()).toBe(true);

  const manifesto = await resposta.json();
  expect(manifesto).toMatchObject({ display: 'standalone', start_url: '/', lang: 'pt-BR' });
  const tamanhos = manifesto.icons.map((i) => `${i.sizes} ${i.purpose}`);
  expect(tamanhos).toEqual(expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']));

  for (const icone of manifesto.icons) {
    const arquivo = await request.get(icone.src);
    expect(arquivo.ok(), icone.src).toBe(true);
    expect(arquivo.headers()['content-type']).toContain('image/png');
  }
});

test('sem conexão, o técnico consulta a fila e o chamado; a ação diz que nada foi registrado', async ({
  page,
  context,
}) => {
  const titulo = `Disjuntor desarmando ${cenario.marca}`;
  const chamado = await cenario.abrirChamado({ titulo });
  await cenario.atribuir(chamado.id);

  await entrar(page, cenario.pessoas.tecnico);
  await esperarServiceWorker(page);
  // Com o service worker no controle, uma passagem online pela fila e pelo
  // chamado guarda as duas leituras.
  await page.reload();
  await expect(page.getByText(titulo)).toBeVisible();
  await page.goto(`/chamados/${chamado.id}`);
  await expect(page.getByRole('heading', { name: titulo })).toBeVisible();

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: titulo })).toBeVisible();
    await expect(page.getByText(/Sem conexão\./)).toBeVisible();

    await page.goto('/');
    await expect(page.getByText(titulo)).toBeVisible();

    // Escrever sem conexão falha na hora, e diz isso.
    await page.goto(`/chamados/${chamado.id}`);
    await page.getByPlaceholder('Escreva um comentário').fill('Chegando ao local agora.');
    await page.getByRole('button', { name: 'Comentar' }).click();
    await expect(page.getByText(/nada foi registrado/)).toBeVisible();
  } finally {
    await context.setOffline(false);
  }

  // De volta à rede, o aviso some com a primeira resposta nova.
  await page.reload();
  await expect(page.getByRole('heading', { name: titulo })).toBeVisible();
  await expect(page.getByText(/Sem conexão\./)).toHaveCount(0);
});

test('sair apaga as leituras guardadas: o próximo a usar o aparelho não vê a fila de outro', async ({
  page,
}) => {
  await entrar(page, cenario.pessoas.tecnico);
  await esperarServiceWorker(page);
  await page.reload();
  await expect.poll(() => page.evaluate(() => caches.has('dados'))).toBe(true);

  await page.getByRole('button', { name: 'Sair' }).click();
  await page.waitForURL('**/login');
  await expect.poll(() => page.evaluate(() => caches.has('dados'))).toBe(false);
});

test('a etiqueta do equipamento lê como o endereço que abre o chamado dele', async ({ page }) => {
  const codigo = `QR-${cenario.marca}`;
  const { corpo } = await cenario.pessoas.gestor.post('/equipamentos', {
    codigo,
    nome: 'Quadro elétrico',
    categoria_id: cenario.categoria.id,
    local_id: cenario.local.id,
  });

  await entrar(page, cenario.pessoas.gestor);
  await page.goto(`/etiquetas?equipamento=${corpo.equipamento.id}`);
  const qr = page.getByRole('img', { name: new RegExp(`QR Code para abrir chamado: ${codigo}`) });
  await expect(qr).toBeVisible();

  // Rasteriza o SVG da própria tela num canvas e lê com um decodificador de
  // verdade: é o que a câmera do celular vai fazer com a etiqueta impressa.
  const { largura, altura, pixels } = await qr.evaluate(async (svg) => {
    const lado = 400;
    const marcacao = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([marcacao], { type: 'image/svg+xml' }));
    const imagem = new Image();
    await new Promise((ok, falha) => {
      imagem.onload = ok;
      imagem.onerror = falha;
      imagem.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = lado;
    canvas.height = lado;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(imagem, 0, 0, lado, lado);
    URL.revokeObjectURL(url);
    return { largura: lado, altura: lado, pixels: Array.from(ctx.getImageData(0, 0, lado, lado).data) };
  });

  const lido = jsQR(new Uint8ClampedArray(pixels), largura, altura);
  const esperado = new URL(`/chamados/novo?equipamento=${codigo}`, page.url()).href;
  expect(lido?.data).toBe(esperado);
});

test('quem lê a etiqueta sem estar logado passa pelo login e volta ao formulário preenchido', async ({
  page,
}) => {
  const codigo = `PORTA-${cenario.marca}`;
  await cenario.pessoas.gestor.post('/equipamentos', {
    codigo,
    nome: 'Porta corta-fogo',
    categoria_id: cenario.categoria.id,
    local_id: cenario.local.id,
  });

  await page.goto(`/chamados/novo?equipamento=${codigo}`);
  await page.waitForURL('**/login');

  await page.getByLabel(/e-?mail/i).fill(cenario.pessoas.solicitante.usuario.email);
  await page.getByLabel(/senha/i).fill(cenario.pessoas.solicitante.senha);
  await page.getByRole('button', { name: /entrar/i }).click();

  await page.waitForURL(`**/chamados/novo?equipamento=${codigo}`);
  await expect(page.getByText('Chamado para este equipamento')).toBeVisible();
  // O equipamento aparece no aviso do topo e já escolhido no seletor.
  await expect(page.getByRole('status').filter({ hasText: `${codigo} — Porta corta-fogo` })).toBeVisible();
  await expect(page.getByLabel('Equipamento').locator('option:checked')).toHaveText(
    `${codigo} — Porta corta-fogo`
  );
});

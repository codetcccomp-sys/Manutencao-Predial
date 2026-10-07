// Grava o vídeo técnico: abre slides.html, revela cada trecho junto com a fala de mesmo
// nome e espera a voz terminar antes do próximo. Normalmente é o rodar.sh que chama.
//
// Uso: node gravar.mjs [pasta-de-saida]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = process.argv[2] ?? path.join(AQUI, 'saida');
const falas = JSON.parse(fs.readFileSync(path.join(AQUI, 'falas.json'), 'utf8'));
const arquivoManifesto = path.join(SAIDA, 'manifesto.json');
const manifesto = fs.existsSync(arquivoManifesto) ? JSON.parse(fs.readFileSync(arquivoManifesto, 'utf8')) : null;

// Sem voz, o tempo de cada trecho é o de leitura da legenda (~15 caracteres por segundo).
const duracao = (chave) => (manifesto ? manifesto[chave].duracao : Math.max(3, falas[chave].length / 15));

const navegador = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
);
const contexto = await navegador.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: SAIDA, size: { width: 1280, height: 720 } },
  reducedMotion: 'no-preference',
});
const page = await contexto.newPage();
const inicio = Date.now();
const agora = () => (Date.now() - inicio) / 1000;
const emitidas = [];

try {
  await page.goto(pathToFileURL(path.join(AQUI, 'slides.html')).href);
  const ordem = await page.evaluate(() => window.__falas());
  const semTexto = ordem.filter((c) => !falas[c]);
  const semAudio = manifesto ? ordem.filter((c) => !manifesto[c]) : [];
  // A ordem do documento é a ordem em que as falas tocam; se ela divergir do roteiro,
  // a narração sai fora de sequência sem nenhum erro aparente.
  const roteiro = Object.keys(falas);
  if (ordem.join() !== roteiro.join()) {
    throw new Error(`Ordem dos slides difere de falas.json.\nslides:  ${ordem.join(' ')}\nroteiro: ${roteiro.join(' ')}`);
  }
  if (semTexto.length || semAudio.length) {
    throw new Error(`Falas faltando: ${[...semTexto, ...semAudio].join(', ')}. Confira falas.json e rode narrar.py sintetizar.`);
  }
  await page.waitForTimeout(800);
  for (const chave of ordem) {
    await page.evaluate((t) => window.__proximo(t), falas[chave]);
    emitidas.push({ chave, t: agora() });
    // Respiro depois de cada fala: tempo de olhar o slide antes do próximo trecho.
    await page.waitForTimeout(duracao(chave) * 1000 + 450);
  }
  await page.waitForTimeout(1500);
} finally {
  await contexto.close();
  await navegador.close();
}

fs.writeFileSync(path.join(SAIDA, 'legendas.json'), JSON.stringify(emitidas, null, 1));

// Legendas também em arquivo .srt, para o player mostrar ou para subir junto no YouTube.
const hms = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, z = 2) => String(n).padStart(z, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const srt = emitidas
  .map((e, n) => `${n + 1}\n${hms(e.t)} --> ${hms(e.t + duracao(e.chave))}\n${falas[e.chave]}\n`)
  .join('\n');
fs.writeFileSync(path.join(SAIDA, 'conserva-predial-tecnico.srt'), srt);
console.log(`GRAVADO: ${emitidas.length} falas, ${agora().toFixed(0)} s`);

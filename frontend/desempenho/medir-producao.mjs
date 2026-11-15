#!/usr/bin/env node
/**
 * Medida de desempenho do site PUBLICADO (RNF03), para repetir quando se quiser comparar.
 *
 * Por que existe: os números do documento de projeto vinham de um build de produção servido
 * na própria máquina, com a API e o banco ao lado. Isso mede o código, não a hospedagem. Esta
 * medida vai ao site de verdade (Vercel, API em gru1, banco em sa-east-1), nos mesmos três
 * perfis da medida local: computador em rede boa, computador em 4G lento, celular de 390 px em
 * 4G lento com CPU 4x mais lenta. Cada carga usa um contexto novo (cache frio, sem service worker).
 *
 * Roda no GitHub Actions (workflow desempenho.yml), cujo runner fica nos EUA: cada ida e volta
 * até São Paulo soma ~120 ms que um aparelho no Brasil não paga. O resultado é um teto, não o
 * tempo de quem usa; o tempo de quem usa está no painel Uso e desempenho (telemetria anônima).
 *
 * Sem login, só lê: a tela de entrada (que carrega o pacote principal) e o aviso de privacidade.
 * Com DESEMPENHO_EMAIL e DESEMPENHO_SENHA (segredos do repositório, de uma conta SEM verificação
 * em duas etapas, como a de um técnico de teste), mede também a fila e o formulário de abertura.
 * Nada é escrito: entrar e abrir telas não cria registro além do da sessão.
 *
 * Uso: node desempenho/medir-producao.mjs <url-do-site> [repetições]
 * Escreve o resumo em Markdown na saída (e em $GITHUB_STEP_SUMMARY, quando existe) e o detalhe
 * em desempenho-producao.json.
 */
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const [site = 'https://conserva-predial.vercel.app', repeticoes = '5'] = process.argv.slice(2);
const REPS = Number(repeticoes);
const QUATRO_G = { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8 };

export const PERFIS = [
  { nome: 'Computador, rede do servidor', viewport: { width: 1280, height: 800 }, rede: null, cpu: 1 },
  { nome: 'Computador, 4G lento simulado', viewport: { width: 1280, height: 800 }, rede: QUATRO_G, cpu: 1 },
  { nome: 'Celular (390 px), 4G lento, CPU 4x', viewport: { width: 390, height: 844 }, rede: QUATRO_G, cpu: 4 },
];

const PUBLICAS = [
  ['Entrada (login)', '/login'],
  ['Aviso de privacidade', '/privacidade'],
];
const COM_LOGIN = [
  ['Fila de chamados', '/'],
  ['Novo chamado', '/chamados/novo'],
];

export const mediana = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
export const percentil = (a, p) => {
  const ordenado = a.slice().sort((x, y) => x - y);
  return ordenado[Math.min(ordenado.length - 1, Math.ceil((p / 100) * ordenado.length) - 1)];
};
const s = (ms) => `${(ms / 1000).toFixed(2)} s`;

/** Endereço da API: o destino do /api no vercel.json do site, o mesmo que o navegador segue. */
function apiDoSite() {
  const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  return new URL(config.rewrites.find((r) => r.source === '/api/:path*').destination.replace('/:path*', '')).origin;
}

/** Tempo de resposta da API, direto do runner: /health não toca o banco; /health/db toca. */
async function medirApi(base, vezes = 20) {
  const linhas = [];
  for (const caminho of ['/health', '/health/db']) {
    const tempos = [];
    for (let i = 0; i < vezes; i += 1) {
      const t0 = performance.now();
      const resp = await fetch(base + caminho, { signal: AbortSignal.timeout(20000) });
      await resp.arrayBuffer();
      if (!resp.ok) throw new Error(`${caminho} respondeu ${resp.status}`);
      tempos.push(performance.now() - t0);
    }
    // A primeira pode ter partida a frio da função; fica de fora da mediana e entra no pior caso.
    linhas.push({ caminho, primeira: tempos[0], mediana: mediana(tempos.slice(1)), p95: percentil(tempos.slice(1), 95), pior: Math.max(...tempos) });
  }
  return linhas;
}

async function entrar(nav) {
  const email = process.env.DESEMPENHO_EMAIL;
  const senha = process.env.DESEMPENHO_SENHA;
  if (!email || !senha) return { estado: null, aviso: 'Sem DESEMPENHO_EMAIL/DESEMPENHO_SENHA: só as telas públicas.' };
  const ctx = await nav.newContext({ locale: 'pt-BR' });
  const page = await ctx.newPage();
  try {
    await page.goto(site + '/login');
    await page.getByLabel(/e-?mail/i).fill(email);
    await page.getByLabel(/senha/i).fill(senha);
    await page.getByRole('button', { name: /entrar/i }).click();
    await page.waitForURL(site + '/', { timeout: 20000 });
    return { estado: await ctx.storageState(), aviso: null };
  } catch {
    // Conta com verificação em duas etapas para na pergunta do código; senha errada para no erro.
    return { estado: null, aviso: 'A conta de medida não entrou (senha, ou verificação em duas etapas ligada): só as telas públicas.' };
  } finally {
    await ctx.close();
  }
}

async function medirTela(nav, perfil, rota, estado) {
  const ctx = await nav.newContext({ viewport: perfil.viewport, locale: 'pt-BR', serviceWorkers: 'block', ...(estado ? { storageState: estado } : {}) });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (perfil.rede) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: perfil.rede.latency, downloadThroughput: perfil.rede.down, uploadThroughput: perfil.rede.up });
  }
  if (perfil.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: perfil.cpu });
  const t0 = performance.now();
  await page.goto(site + rota, { waitUntil: 'commit' });
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 60000 });
  const conteudo = performance.now() - t0;
  await page.waitForLoadState('networkidle', { timeout: 60000 });
  const ociosa = performance.now() - t0;
  await ctx.close();
  return { conteudo, ociosa };
}

async function principal() {
  const nav = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  // DESEMPENHO_API só para ensaiar o script contra uma API local.
  const api = await medirApi(process.env.DESEMPENHO_API || apiDoSite());
  const { estado, aviso } = await entrar(nav);
  const telas = estado ? [...PUBLICAS, ...COM_LOGIN] : PUBLICAS;

  const resultado = [];
  for (const perfil of PERFIS) {
    for (const [nome, rota] of telas) {
      const medidas = [];
      for (let i = 0; i < REPS; i += 1) medidas.push(await medirTela(nav, perfil, rota, estado));
      resultado.push({
        perfil: perfil.nome,
        tela: nome,
        conteudo: mediana(medidas.map((m) => m.conteudo)),
        ociosa: mediana(medidas.map((m) => m.ociosa)),
        pior: Math.max(...medidas.map((m) => m.ociosa)),
      });
    }
  }
  await nav.close();

  const md = [
    `## Desempenho do site publicado (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
    '',
    `Site ${site}, ${REPS} cargas por tela e perfil, cache frio. Runner nos EUA: cada ida e volta soma ~120 ms que um aparelho no Brasil não paga.`,
    ...(aviso ? ['', `> ${aviso}`] : []),
    '',
    '### API, direto do runner',
    '',
    '| Rota | Primeira | Mediana | p95 | Pior |',
    '|---|---:|---:|---:|---:|',
    ...api.map((l) => `| \`${l.caminho}\` | ${Math.round(l.primeira)} ms | ${Math.round(l.mediana)} ms | ${Math.round(l.p95)} ms | ${Math.round(l.pior)} ms |`),
    '',
    '### Telas (mediana; "conteúdo" é o título visível, "rede ociosa" é tudo baixado)',
    '',
    '| Perfil | Tela | Conteúdo | Rede ociosa | Pior caso |',
    '|---|---|---:|---:|---:|',
    ...resultado.map((r) => `| ${r.perfil} | ${r.tela} | ${s(r.conteudo)} | ${s(r.ociosa)} | ${s(r.pior)} |`),
    '',
  ].join('\n');

  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  fs.writeFileSync('desempenho-producao.json', JSON.stringify({ site, reps: REPS, api, telas: resultado }, null, 1));
}

principal().catch((err) => {
  console.error(`::error::${err.message}`);
  process.exit(1);
});

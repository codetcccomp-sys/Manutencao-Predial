// Grava os clipes do vídeo comercial (60 s): três cenas de arte (abertura, marca, encerramento)
// e quatro da interface REAL, num banco descartável semeado por ../semear.mjs. Quem junta tudo
// é o montar.py. Veja o README desta pasta.
//
// Uso (na pasta frontend): node video/comercial/gravar.mjs [pasta-de-saida] [clipe ...]
//
// A interface não é redesenhada: o que aparece é a tela, com um cursor, um anel de destaque e
// uma aproximação. Tudo desenhado por DOM + CSSOM, que a CSP estrita permite.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
// PLAYWRIGHT_MODULO aponta para outro Playwright (o da máquina) quando o do projeto não tem o
// navegador e o ffmpeg da versão dele instalados: gravar vídeo exige os dois casados.
const { chromium } = process.env.PLAYWRIGHT_MODULO
  ? createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULO)
  : await import('@playwright/test');
const APP = process.env.APP ?? 'http://localhost:4173';
const SAIDA = path.resolve(process.argv[2] ?? path.join(AQUI, 'saida'));
const SO = process.argv.slice(3);
const SENHA = 'senha-teste-123';
// O contato do cartão final vem de fora: não existe valor padrão para não publicar um inventado.
const CONTATO = process.env.CONTATO ?? '[ contato comercial ]';
const CLIPES = path.join(SAIDA, 'clipes');
fs.mkdirSync(CLIPES, { recursive: true });

const arquivoMarcas = path.join(SAIDA, 'marcas.json');
const marcas = fs.existsSync(arquivoMarcas) ? JSON.parse(fs.readFileSync(arquivoMarcas, 'utf8')) : {};
const quer = (nome) => SO.length === 0 || SO.includes(nome);

const navegador = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
);
const COMUM = { locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'no-preference' };

// ───────────────────────── apoio ─────────────────────────

// A sessão é um cookie HttpOnly: entra-se fora da gravação e o clipe já nasce logado.
async function sessao(email) {
  const c = await navegador.newContext({ ...COMUM, viewport: { width: 1280, height: 720 } });
  const p = await c.newPage();
  await p.goto(`${APP}/login`);
  await p.getByLabel(/e-?mail/i).fill(email);
  await p.getByLabel(/senha/i).fill(SENHA);
  await p.getByRole('button', { name: /entrar/i }).click();
  await p.waitForURL('**/');
  const estado = await c.storageState();
  await c.close();
  return estado;
}

async function gravar(nome, opcoes, roteiro) {
  if (!quer(nome)) return;
  const contexto = await navegador.newContext({
    ...COMUM,
    ...opcoes,
    recordVideo: { dir: CLIPES, size: { width: 1920, height: 1080 } },
  });
  await contexto.addInitScript(() => {
    const montar = () => {
      if (!document.body || document.getElementById('__cur')) return;
      const cur = document.createElement('div');
      cur.id = '__cur';
      cur.style.cssText =
        'position:fixed;left:0;top:0;width:20px;height:20px;margin:-3px 0 0 -3px;z-index:2147483647;' +
        'pointer-events:none;border-radius:50%;background:rgba(240,185,99,.95);border:2px solid #fff;' +
        'box-shadow:0 2px 8px rgba(0,0,0,.45);transform:translate(-100px,-100px);transition:background .15s';
      const anel = document.createElement('div');
      anel.id = '__anel';
      anel.style.cssText =
        'position:absolute;z-index:2147483646;pointer-events:none;border:3px solid #f0b963;border-radius:12px;' +
        'box-shadow:0 0 0 6px rgba(240,185,99,.28);opacity:0;transition:opacity .45s,left .5s,top .5s,width .5s,height .5s';
      document.body.append(anel, cur);
      document.addEventListener('mousemove', (e) => { cur.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, true);
      document.addEventListener('mousedown', () => { cur.style.background = 'rgba(31,56,100,.95)'; }, true);
      document.addEventListener('mouseup', () => { cur.style.background = 'rgba(240,185,99,.95)'; }, true);
    };
    document.addEventListener('DOMContentLoaded', montar);
    // A gravação do Playwright ignora a densidade de pixels. Para a interface sair em 1080p
    // nítida e do tamanho em que se lê num vídeo, a janela tem 1920×1080 e a aplicação é
    // ampliada 1,5× (equivale a uma tela de 1280×720). O cursor e o anel ficam de fora.
    const AMPLIACAO = 1.5;
    document.addEventListener('DOMContentLoaded', () => {
      const raiz = document.getElementById('root');
      if (raiz) raiz.style.zoom = String(AMPLIACAO);
    });
    window.__anel = (caixa) => {
      montar();
      const anel = document.getElementById('__anel');
      if (!caixa) { anel.style.opacity = '0'; return; }
      const m = 6;
      anel.style.left = `${caixa.x + window.scrollX - m}px`;
      anel.style.top = `${caixa.y + window.scrollY - m}px`;
      anel.style.width = `${caixa.width + 2 * m}px`;
      anel.style.height = `${caixa.height + 2 * m}px`;
      anel.style.opacity = '1';
    };
    // Aproximação: escala a aplicação em torno de um ponto da janela, com transição suave.
    // O anel é medido depois dela (fica fora da escala): aproxime, espere, e só então destaque.
    window.__zoom = (escala, x, y, segundos) => {
      const r = document.getElementById('root');
      r.style.transition = `transform ${segundos}s cubic-bezier(.4,0,.2,1)`;
      r.style.transformOrigin = `${(x + window.scrollX) / AMPLIACAO}px ${(y + window.scrollY) / AMPLIACAO}px`;
      r.style.transform = `scale(${escala})`;
    };
  });
  const page = await contexto.newPage();
  page.setDefaultTimeout(9000);
  const t0 = Date.now();
  const m = (marcas[nome] = {});
  const apoio = {
    page,
    pausa: (ms) => page.waitForTimeout(ms),
    marca: (rotulo) => { m[rotulo] = (Date.now() - t0) / 1000; },
    async caixa(loc) {
      const caixas = [];
      for (const l of [].concat(loc)) caixas.push(await l.boundingBox());
      const x = Math.min(...caixas.map((b) => b.x));
      const y = Math.min(...caixas.map((b) => b.y));
      return {
        x, y,
        width: Math.max(...caixas.map((b) => b.x + b.width)) - x,
        height: Math.max(...caixas.map((b) => b.y + b.height)) - y,
      };
    },
    async anel(loc) { await page.evaluate((c) => window.__anel(c), loc ? await apoio.caixa(loc) : null); },
    zoom: (escala, x = 960, y = 540, s = 1.2) => page.evaluate((a) => window.__zoom(...a), [escala, x, y, s]),
    async mover(loc, passos = 22) {
      const b = await loc.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: passos });
      await page.waitForTimeout(160);
    },
    async clicar(loc, depois = 400) { await apoio.mover(loc); await loc.click(); await page.waitForTimeout(depois); },
    async rolarAte(loc, folga = 110) {
      await loc.evaluate((el, f) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - f, behavior: 'smooth' }), folga);
      await page.waitForTimeout(900);
    },
  };
  await roteiro(apoio);
  m.fim = (Date.now() - t0) / 1000;
  const video = page.video();
  await contexto.close();
  fs.renameSync(await video.path(), path.join(CLIPES, `${nome}.webm`));
  fs.writeFileSync(arquivoMarcas, JSON.stringify(marcas, null, 1));
  console.log(`✔ ${nome}  ${JSON.stringify(m)}`);
}

const TELA = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };
const ARTE = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };

const marca64 = fs.readFileSync(path.join(AQUI, '../../public/marca.png')).toString('base64');
// Imagens de contexto (prédio, área técnica, equipe) são opcionais: contexto/01.jpg, 02.jpg, 03.jpg.
// Sem elas a abertura sai só com a arte tipográfica.
const contexto64 = ['01', '02', '03']
  .map((n) => ['jpg', 'jpeg', 'png', 'webp'].map((e) => path.join(AQUI, 'contexto', `${n}.${e}`)).find((f) => fs.existsSync(f)))
  .filter(Boolean)
  .map((f) => `data:image/${path.extname(f).slice(1).replace('jpg', 'jpeg')};base64,${fs.readFileSync(f).toString('base64')}`);

const BASE = `
  *{box-sizing:border-box} html,body{margin:0;height:100%;overflow:hidden}
  body{background:radial-gradient(circle at 28% 18%,#2a4a82,#16294b 58%,#0e1b33);color:#fff;
    font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
  @keyframes entra{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
  @keyframes some{to{opacity:0;transform:translateY(-18px)}}
  @keyframes surge{from{opacity:0}to{opacity:1}}
  b{color:#f0b963;font-weight:inherit}`;
const arte = (page, css, corpo) => page.setContent(`<!doctype html><meta charset="utf-8"><style>${BASE}${css}</style>${corpo}`);

// Os instantes das artes seguem a fala (pausas medidas no áudio): na abertura a pergunta vem
// primeiro e os recados entram quando são ditos; no encerramento, um benefício por trecho.
// Mudou a narração? Confira estes atrasos.
// ───────────────────────── 1. abertura (0–10 s) ─────────────────────────
await gravar('abertura', ARTE, async ({ page, pausa, marca }) => {
  const fundos = contexto64
    .map((src, i) => `<img class="fundo" style="animation-delay:${i * 3.2}s,${i * 3.2}s" src="${src}">`)
    .join('');
  await arte(page, `
    .fundo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;
      animation:foto 3.9s linear both,aproxima 3.9s linear both}
    @keyframes foto{0%{opacity:0}12%{opacity:1}85%{opacity:1}100%{opacity:0}}
    @keyframes aproxima{from{transform:scale(1.02)}to{transform:scale(1.1)}}
    .veu{position:absolute;inset:0;background:linear-gradient(180deg,rgba(14,27,51,.5),rgba(14,27,51,.82))}
    .recados{position:absolute;inset:0}
    .recado{position:absolute;width:640px;padding:26px 32px;border-radius:20px;background:rgba(255,255,255,.96);color:#16294b;
      box-shadow:0 18px 50px rgba(0,0,0,.35);opacity:0;animation:entra .8s cubic-bezier(.22,1,.36,1) both}
    .recado small{display:block;font-size:22px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#8a5300;margin-bottom:8px}
    .recado p{margin:0;font-size:34px;line-height:1.3;font-weight:500}
    .r1{left:170px;top:150px;animation-delay:5.5s}
    .r2{left:1010px;top:330px;animation-delay:6.6s}
    .r3{left:330px;top:590px;animation-delay:7.5s}
    h1{position:relative;margin:0;max-width:1400px;text-align:center;font-size:92px;line-height:1.12;letter-spacing:-2px;font-weight:700;
      opacity:0;animation:entra 1s .3s cubic-bezier(.22,1,.36,1) both,some .6s 4.7s forwards}
  `, `${fundos}${fundos ? '<div class="veu"></div>' : ''}
    <div class="recados">
      <div class="recado r1"><small>Por mensagem</small><p>“A torneira do 2º andar está pingando.”</p></div>
      <div class="recado r2"><small>Por telefone</small><p>“O ar da sala 204 parou de novo.”</p></div>
      <div class="recado r3"><small>No corredor</small><p>“A lâmpada da escada queimou.”</p></div>
    </div>
    <h1>Em que pé está <b>cada pedido</b> de manutenção?</h1>`);
  marca('inicio');
  await pausa(11200);
});

// ───────────────────────── 2. marca (10–14 s) ─────────────────────────
await gravar('marca', ARTE, async ({ page, pausa, marca }) => {
  await arte(page, `
    main{text-align:center;animation:entra .9s cubic-bezier(.22,1,.36,1) both}
    img{width:190px;height:190px;object-fit:contain}
    h1{font-size:118px;margin:18px 0 10px;letter-spacing:-3px;font-weight:700}
    p{font-size:40px;margin:0;color:#e8edf6;opacity:0;animation:surge .8s .9s both}
  `, `<main><img src="data:image/png;base64,${marca64}"><h1>Conserva <b>Predial</b></h1>
      <p>Os chamados de manutenção em um só lugar</p></main>`);
  marca('inicio');
  await pausa(5200);
});

// ───────────────────────── telas reais ─────────────────────────
const precisaDeTela = ['visao', 'chamado', 'painel', 'preventiva'].some(quer);
const ana = precisaDeTela ? await sessao('ana.ribeiro@conserva.demo') : null;
const jorge = precisaDeTela ? await sessao('jorge.pacheco@conserva.demo') : null;

// Transição da marca para a plataforma: o painel da gestão, com uma aproximação lenta.
await gravar('visao', { ...TELA, storageState: ana }, async ({ page, pausa, marca, zoom }) => {
  await page.goto(`${APP}/`);
  await page.getByText('Sem técnico').waitFor();
  await pausa(700);
  marca('inicio');
  await zoom(1.07, 0, 0, 5);
  await pausa(5600);
});

// Funcionalidade 2 (gravada antes da 1 para o painel ainda não ter o chamado da cena seguinte).
await gravar('painel', { ...TELA, storageState: ana }, async ({ page, pausa, marca, anel, zoom, clicar }) => {
  await page.goto(`${APP}/`);
  const semTecnico = page.getByRole('button', { name: /sem técnico/i });
  const atrasados = page.getByRole('button', { name: /atrasados/i });
  await semTecnico.waitFor();
  await pausa(700);
  marca('inicio');
  await zoom(1.15, 0, 240, 1.3);
  await pausa(1300);
  await anel([semTecnico, atrasados]);
  await pausa(2300);
  await anel(null);
  await clicar(atrasados, 300);
  marca('filtro');
  await zoom(1, 0, 240, 1.4);
  await pausa(5200);
});

// Funcionalidade 1: quem percebe o problema abre o chamado e recebe o protocolo.
await gravar('chamado', { ...TELA, storageState: jorge }, async ({ page, pausa, marca, anel, zoom, clicar, mover, rolarAte }) => {
  await page.goto(`${APP}/chamados/novo`);
  await page.getByLabel('Título').waitFor();
  await pausa(700);
  marca('inicio');
  await mover(page.getByLabel('Título'), 12);
  await page.getByLabel('Título').click();
  await page.getByLabel('Título').pressSequentially('Vazamento na pia do laboratório', { delay: 24 });
  await page.getByLabel('Descrição').fill('A pia está pingando desde cedo e já molhou o piso perto das bancadas.');
  await pausa(250);
  await page.getByLabel('Categoria').selectOption({ label: 'hidráulica' });
  const local = page.getByLabel('Local');
  await local.selectOption(await local.locator('option', { hasText: 'Laboratório de informática' }).first().getAttribute('value'));
  await pausa(350);
  await rolarAte(page.getByText('Alguém pode se machucar'), 90);
  for (const resposta of ['Pode virar risco se demorar', 'Atrapalha, mas dá para trabalhar', 'Nesta semana']) {
    await clicar(page.getByText(resposta, { exact: true }), 140);
  }
  await clicar(page.getByRole('button', { name: /abrir chamado/i }), 0);
  await page.waitForURL(/\/chamados\/\d+/);
  await page.getByRole('heading', { level: 1 }).waitFor();
  marca('protocolo');
  await pausa(900);
  const protocolo = page.getByText(/SMP-\d{8}-[0-9A-F]{6}/).first();
  await zoom(1.25, 0, 0, 1.2);
  await pausa(1400);
  await anel(protocolo);
  await pausa(6000);
});

// Funcionalidade 3: o plano preventivo gera o chamado.
await gravar('preventiva', { ...TELA, storageState: ana }, async ({ page, pausa, marca, anel, clicar, rolarAte }) => {
  await page.goto(`${APP}/preventiva`);
  const titulo = page.getByRole('heading', { name: 'Planos cadastrados' });
  await titulo.waitFor();
  await pausa(500);
  await titulo.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 60));
  await pausa(500);
  marca('inicio');
  const plano = page.locator('li', { hasText: 'Inspeção da bomba de recalque' }).first();
  await pausa(900);
  await anel(plano);
  await pausa(2200);
  await anel(null);
  await clicar(plano.getByRole('button', { name: 'Gerar agora' }), 1900);
  // A tela pede confirmação e explica que o agendador criaria o chamado sozinho na data.
  await clicar(page.getByRole('dialog').getByRole('button', { name: 'Gerar agora' }), 300);
  marca('gerado');
  await plano.getByText(/Última execução/).waitFor();
  await pausa(500);
  await anel(plano);
  await pausa(5500);
});

// ───────────────────────── 4. encerramento (45–60 s) ─────────────────────────
await gravar('encerramento', ARTE, async ({ page, pausa, marca }) => {
  await arte(page, `
    .beneficios{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding-left:330px;gap:44px;
      animation:some .6s 5.9s both}
    .beneficios div{font-size:82px;font-weight:700;letter-spacing:-2px;opacity:0;animation:entra .8s cubic-bezier(.22,1,.36,1) both;
      display:flex;align-items:center;gap:36px}
    .beneficios i{flex:none;width:76px;height:76px;border-radius:50%;background:#f0b963;display:grid;place-items:center}
    .beneficios svg{width:42px;height:42px}
    .b1{animation-delay:2.5s!important}.b2{animation-delay:3.5s!important}.b3{animation-delay:4.6s!important}
    main{text-align:center;opacity:0;animation:entra 1s 6.4s cubic-bezier(.22,1,.36,1) both}
    img{width:130px;height:130px;object-fit:contain}
    h1{font-size:96px;margin:10px 0 26px;letter-spacing:-2.5px;font-weight:700}
    p{font-size:44px;line-height:1.3;margin:0 auto;max-width:1300px;color:#e8edf6}
    .contato{display:inline-block;margin-top:46px;padding:22px 46px;border-radius:18px;background:#f0b963;color:#16294b;
      font-size:48px;font-weight:700}
  `, `<div class="beneficios">
      ${['O que foi pedido', 'Quem está cuidando', 'O que está no prazo'].map((t, i) => `<div class="b${i + 1}">
        <i><svg viewBox="0 0 24 24" fill="none" stroke="#16294b" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></i>${t}</div>`).join('')}
    </div>
    <main><img src="data:image/png;base64,${marca64}"><h1>Conserva <b>Predial</b></h1>
      <p>Agende uma demonstração e conheça o sistema na prática.</p>
      <div class="contato">${CONTATO.replace(/[<>&]/g, '')}</div></main>`);
  marca('inicio');
  await pausa(15500);
});

await navegador.close();

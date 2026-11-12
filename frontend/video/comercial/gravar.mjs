// Grava os clipes do vídeo comercial (45 a 60 s): três cenas de arte (problema, marca,
// encerramento) e cinco da interface REAL, num banco descartável semeado por ../semear.mjs.
// Quem junta tudo é o montar.py. Veja o README desta pasta.
//
// Uso (na pasta frontend): node video/comercial/gravar.mjs [pasta-de-saida] [clipe ...]
//
// A FALA COMANDA O TEMPO. O manifesto (narrar.py sintetizar) traz a duração de cada fala; cada
// cena anota o instante em que a fala começa e só termina depois que ela acaba. O montar.py
// põe o áudio nesses instantes: voz, legenda e ação ficam juntas por construção.
//
// A interface não é redesenhada: o que aparece é a tela, com um cursor, um anel de destaque e
// uma aproximação. Tudo desenhado por DOM + CSSOM, que a CSP estrita permite. O que seria só
// espera (preencher formulário, trocar de estado) acontece ANTES do início de cada cena.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const exigir = createRequire(import.meta.url);
// PLAYWRIGHT_MODULO aponta para outro Playwright (o da máquina) quando o do projeto não tem o
// navegador e o ffmpeg da versão dele instalados: gravar vídeo exige os dois casados.
const { chromium } = process.env.PLAYWRIGHT_MODULO
  ? exigir(process.env.PLAYWRIGHT_MODULO)
  : await import('@playwright/test');
const qrcode = exigir('qrcode-generator');

const APP = process.env.APP ?? 'http://localhost:4173';
const SAIDA = path.resolve(process.argv[2] ?? path.join(AQUI, 'saida'));
const SO = process.argv.slice(3);
const SENHA = 'senha-teste-123';
// O endereço do cartão final e do QR Code. É o do sistema publicado, informado pelo dono.
const ENDERECO = process.env.ENDERECO ?? 'conserva-predial.vercel.app';
const CLIPES = path.join(SAIDA, 'clipes');
fs.mkdirSync(CLIPES, { recursive: true });

const FALAS = JSON.parse(fs.readFileSync(path.join(AQUI, 'falas.json'), 'utf8'));
const MANIFESTO = JSON.parse(fs.readFileSync(path.join(SAIDA, 'manifesto.json'), 'utf8'));
// A síntese acrescenta 0,35 s de respiro no fim de cada arquivo: a voz acaba antes.
const voz = (chave) => MANIFESTO[chave].duracao - 0.35;
// Em que fração da fala começa um trecho (pelo número de letras): serve para a imagem mudar
// quando a palavra é dita. Erro de poucos décimos de segundo em frases curtas.
const fracao = (chave, trecho) => {
  const i = FALAS[chave].indexOf(trecho);
  if (i < 0) throw new Error(`"${trecho}" não está na fala ${chave}`);
  return i / FALAS[chave].length;
};

const arquivoMarcas = path.join(SAIDA, 'marcas.json');
const marcas = fs.existsSync(arquivoMarcas) ? JSON.parse(fs.readFileSync(arquivoMarcas, 'utf8')) : {};
const quer = (nome) => SO.length === 0 || SO.includes(nome);

const navegador = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
);
const COMUM = { locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'no-preference' };
const JANELA = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };

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
    ...JANELA,
    ...opcoes,
    recordVideo: { dir: CLIPES, size: { width: 1920, height: 1080 } },
  });
  await contexto.addInitScript(() => {
    // A gravação do Playwright ignora a densidade de pixels. Para a interface sair em 1080p
    // nítida e do tamanho em que se lê num celular, a janela tem 1920×1080 e a aplicação é
    // ampliada 1,5× (equivale a uma tela de 1280×720). O cursor e o anel ficam de fora.
    const AMPLIACAO = 1.5;
    const montar = () => {
      if (!document.body || document.getElementById('__cur')) return;
      const cur = document.createElement('div');
      cur.id = '__cur';
      cur.style.cssText =
        'position:fixed;left:0;top:0;width:26px;height:26px;margin:-5px 0 0 -5px;z-index:2147483647;' +
        'pointer-events:none;border-radius:50%;background:rgba(240,185,99,.95);border:3px solid #fff;' +
        'box-shadow:0 2px 10px rgba(0,0,0,.5);transform:translate(-100px,-100px);transition:background .15s';
      const anel = document.createElement('div');
      anel.id = '__anel';
      anel.style.cssText =
        'position:absolute;z-index:2147483646;pointer-events:none;border:5px solid #f0b963;border-radius:14px;' +
        'box-shadow:0 0 0 8px rgba(240,185,99,.3);opacity:0;transition:opacity .3s';
      document.body.append(anel, cur);
      document.addEventListener('mousemove', (e) => { cur.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, true);
      document.addEventListener('mousedown', () => { cur.style.background = 'rgba(31,56,100,.95)'; }, true);
      document.addEventListener('mouseup', () => { cur.style.background = 'rgba(240,185,99,.95)'; }, true);
    };
    document.addEventListener('DOMContentLoaded', () => {
      montar();
      const raiz = document.getElementById('root');
      if (raiz) raiz.style.zoom = String(AMPLIACAO);
    });
    window.__anel = (caixa) => {
      montar();
      const anel = document.getElementById('__anel');
      if (!caixa) { anel.style.opacity = '0'; return; }
      const m = 8;
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
      const origem = `${(x + window.scrollX) / AMPLIACAO}px ${(y + window.scrollY) / AMPLIACAO}px`;
      // Partindo do tamanho normal, o ponto fixo é posto de uma vez: animá-lo desde o centro
      // faria a tela escorregar de lado no começo da aproximação.
      if (!r.style.transform || r.style.transform === 'none') {
        r.style.transition = 'none';
        r.style.transformOrigin = origem;
        r.getBoundingClientRect();
      }
      r.style.transition = `transform ${segundos}s cubic-bezier(.4,0,.2,1), transform-origin ${segundos}s cubic-bezier(.4,0,.2,1)`;
      r.style.transformOrigin = origem;
      r.style.transform = `scale(${escala})`;
    };
  });
  const page = await contexto.newPage();
  page.setDefaultTimeout(9000);
  const t0 = Date.now();
  const agora = () => (Date.now() - t0) / 1000;
  const m = (marcas[nome] = { falas: [] });
  let fimDaFala = 0;
  let inicioDaFala = 0;
  const a = {
    page,
    pausa: (ms) => page.waitForTimeout(ms),
    inicio: () => { m.inicio = agora(); },
    // Começa uma fala agora (depois que a anterior terminou) e segue: quem espera é aguardarFala.
    async falar(chave) {
      await a.aguardarFala(150);
      inicioDaFala = agora();
      m.falas.push({ chave, t: inicioDaFala });
      fimDaFala = inicioDaFala + voz(chave);
    },
    // Espera a fala em curso acabar e mais a folga (ms), mesmo que a ação tenha passado dela.
    async aguardarFala(folga = 0) {
      const resta = fimDaFala + folga / 1000 - agora();
      if (resta > 0) await page.waitForTimeout(resta * 1000);
    },
    // Espera o instante em que um trecho da fala em curso é dito.
    async quandoDisser(trecho, antecipar = 0.25) {
      const { chave } = m.falas.at(-1);
      const alvo = inicioDaFala + fracao(chave, trecho) * voz(chave) - antecipar;
      if (alvo > agora()) await page.waitForTimeout((alvo - agora()) * 1000);
    },
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
    async anel(loc) { await page.evaluate((c) => window.__anel(c), loc ? await a.caixa(loc) : null); },
    zoom: (escala, x = 960, y = 540, s = 0.9) => page.evaluate((v) => window.__zoom(...v), [escala, x, y, s]),
    // Aproxima de um elemento (medido SEM aproximação): centraliza-o no quadro ou, se ampliado
    // ele não couber, encosta o começo dele na margem.
    async zoomEm(caixa, escala, s = 0.9) {
      const ponto = (ini, tam, total, margem) => {
        const o = tam * escala > total - 2 * margem
          ? (ini * escala - margem) / (escala - 1)
          : ((ini + tam / 2) * escala - total / 2) / (escala - 1);
        // Pode passar um pouco do fim da janela (elemento no pé da página): sobra fundo liso.
        return Math.min(total * 1.8, Math.max(0, o));
      };
      await a.zoom(escala, ponto(caixa.x, caixa.width, 1920, 40), ponto(caixa.y, caixa.height, 1080, 120), s);
      await page.waitForTimeout(s * 1000 + 80);
    },
    // Volta ao tamanho normal e REMOVE a transformação: enquanto ela existe, o que a tela fixa
    // na janela (o diálogo de confirmação) passa a se posicionar pela página e sai do quadro.
    async semZoom(s = 0.7) {
      await a.zoom(1, 960, 540, s);
      await page.waitForTimeout(s * 1000 + 80);
      await page.evaluate(() => { const r = document.getElementById('root'); r.style.transition = 'none'; r.style.transform = 'none'; });
    },
    async mover(loc, passos = 14) {
      const b = await loc.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: passos });
      await page.waitForTimeout(120);
    },
    async clicar(loc, depois = 300) { await a.mover(loc); await loc.click(); await page.waitForTimeout(depois); },
    // Rolagem seca (fora de cena) e suave (em cena).
    async posicionar(loc, folga = 110) {
      await loc.evaluate((el, f) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - f), folga);
      await page.waitForTimeout(250);
    },
    async rolarAte(loc, folga = 110) {
      await loc.evaluate((el, f) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - f, behavior: 'smooth' }), folga);
      await page.waitForTimeout(550);
    },
  };
  await roteiro(a);
  await a.aguardarFala();
  m.fim = agora();
  const video = page.video();
  await contexto.close();
  fs.renameSync(await video.path(), path.join(CLIPES, `${nome}.webm`));
  fs.writeFileSync(arquivoMarcas, JSON.stringify(marcas, null, 1));
  console.log(`✔ ${nome}  ${(m.fim - m.inicio).toFixed(1)}s  ${m.falas.map((f) => f.chave).join(', ')}`);
}

// ───────────────────────── artes ─────────────────────────

const marca64 = fs.readFileSync(path.join(AQUI, '../../public/marca.png')).toString('base64');
// Imagens de contexto (prédio, área técnica, equipe) são opcionais: contexto/01, 02 e 03.
// Sem elas a abertura sai só com a arte tipográfica.
const contexto64 = ['01', '02', '03']
  .map((n) => ['jpg', 'jpeg', 'png', 'webp'].map((e) => path.join(AQUI, 'contexto', `${n}.${e}`)).find((f) => fs.existsSync(f)))
  .filter(Boolean)
  .map((f) => `data:image/${path.extname(f).slice(1).replace('jpg', 'jpeg')};base64,${fs.readFileSync(f).toString('base64')}`);

function qrSvg(texto) {
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
  // Margem de 4 módulos (zona de silêncio): sem ela muitos leitores não reconhecem o código.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${n + 8} ${n + 8}" shape-rendering="crispEdges">
    <rect x="-4" y="-4" width="${n + 8}" height="${n + 8}" fill="#fff"/><path d="${d}" fill="#0e1b33"/></svg>`;
}

const BASE = `
  *{box-sizing:border-box} html,body{margin:0;height:100%;overflow:hidden}
  body{background:radial-gradient(circle at 28% 18%,#2a4a82,#16294b 58%,#0e1b33);color:#fff;
    font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
  @keyframes entra{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}
  @keyframes salta{0%{opacity:0;transform:scale(.86)}60%{opacity:1;transform:scale(1.03)}100%{opacity:1;transform:scale(1)}}
  @keyframes some{to{opacity:0;transform:translateY(-18px)}}
  @keyframes surge{from{opacity:0}to{opacity:1}}
  b{color:#f0b963;font-weight:inherit}`;
const arte = (page, css, corpo) => page.setContent(`<!doctype html><meta charset="utf-8"><style>${BASE}${css}</style>${corpo}`);
// As artes começam a falar 0,35 s depois de aparecer; os atrasos das animações contam daí.
const ENTRADA = 0.35;
const quando = (chave, trecho) => (ENTRADA + fracao(chave, trecho) * voz(chave) - 0.2).toFixed(2);

// 1. O problema: a pergunta e três pedidos soltos, cada um quando é dito.
await gravar('problema', {}, async ({ page, pausa, inicio, falar }) => {
  const passo = (voz('problema') + 1.6) / Math.max(1, contexto64.length);
  const fundos = contexto64
    .map((src, i) => `<img class="fundo" style="animation-delay:${(i * passo).toFixed(2)}s" src="${src}">`)
    .join('');
  await arte(page, `
    .fundo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 58%;opacity:0;
      animation:foto ${(passo + 0.7).toFixed(2)}s linear both}
    @keyframes foto{0%{opacity:0;transform:scale(1.02)}14%{opacity:1}84%{opacity:1}100%{opacity:0;transform:scale(1.1)}}
    .veu{position:absolute;inset:0;background:linear-gradient(180deg,rgba(14,27,51,.62),rgba(14,27,51,.84))}
    main{position:relative;width:1660px}
    h1{margin:0 0 70px;font-size:96px;line-height:1.1;letter-spacing:-2.5px;font-weight:700;
      animation:entra .6s .1s cubic-bezier(.22,1,.36,1) both}
    .pedidos{display:flex;gap:34px}
    .pedido{flex:1;padding:34px 38px;border-radius:24px;background:#fff;color:#16294b;box-shadow:0 20px 56px rgba(0,0,0,.4);
      opacity:0;animation:salta .45s cubic-bezier(.22,1,.36,1) both}
    .pedido small{display:block;font-size:30px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8a5300;margin-bottom:12px}
    .pedido p{margin:0;font-size:46px;line-height:1.22;font-weight:600}
  `, `${fundos}${fundos ? '<div class="veu"></div>' : ''}
    <main><h1>Pedidos de manutenção <b>espalhados</b>?</h1>
      <div class="pedidos">
        <div class="pedido" style="animation-delay:${quando('problema', 'mensagens')}s"><small>Mensagem</small><p>“A torneira do 2º andar está pingando.”</p></div>
        <div class="pedido" style="animation-delay:${quando('problema', 'ligações')}s"><small>Ligação</small><p>“O ar da sala 204 parou de novo.”</p></div>
        <div class="pedido" style="animation-delay:${quando('problema', 'conversas')}s"><small>Conversa</small><p>“A lâmpada da escada queimou.”</p></div>
      </div></main>`);
  inicio();
  await pausa(ENTRADA * 1000);
  await falar('problema');
  await pausa((voz('problema') + 1.1) * 1000);
});

// 2. A marca e a que o sistema serve.
await gravar('marca', {}, async ({ page, pausa, inicio, falar }) => {
  await arte(page, `
    main{text-align:center}
    img{width:200px;height:200px;object-fit:contain;animation:salta .6s .05s both}
    h1{font-size:132px;margin:14px 0 14px;letter-spacing:-3.5px;font-weight:700;animation:entra .6s .15s cubic-bezier(.22,1,.36,1) both}
    p{font-size:54px;margin:0;font-weight:600;opacity:0;animation:entra .6s ${quando('marca', 'Os chamados')}s cubic-bezier(.22,1,.36,1) both}
    small{display:inline-block;margin-top:40px;padding:14px 34px;border-radius:999px;border:2px solid rgba(240,185,99,.7);
      font-size:34px;color:#f0b963;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
      opacity:0;animation:surge .6s ${quando('marca', 'de manutenção')}s both}
  `, `<main><img src="data:image/png;base64,${marca64}"><h1>Conserva <b>Predial</b></h1>
      <p>Os chamados de manutenção em um só lugar</p><br><small>Gestão da manutenção predial</small></main>`);
  inicio();
  await pausa(ENTRADA * 1000);
  await falar('marca');
  await pausa((voz('marca') + 0.5) * 1000);
});

// ───────────────────────── telas reais ─────────────────────────
const TELAS = ['registro', 'atribuicao', 'conclusao', 'painel', 'preventiva'];
const precisaDeTela = TELAS.some(quer);
const ana = precisaDeTela ? await sessao('ana.ribeiro@conserva.demo') : null;
const jorge = precisaDeTela ? await sessao('jorge.pacheco@conserva.demo') : null;
const paulo = precisaDeTela ? await sessao('paulo.tavares@conserva.demo') : null;
// O mesmo chamado atravessa as três cenas. Regravar só uma delas exige o endereço dele.
let chamado = marcas.__chamado ?? null;

// 3a. Registro: o formulário já está preenchido; a cena é o envio e o protocolo.
await gravar('registro', { storageState: jorge }, async (a) => {
  const { page, pausa } = a;
  await page.goto(`${APP}/chamados/novo`);
  await page.getByLabel('Título').fill('Vazamento na pia do laboratório');
  await page.getByLabel('Descrição').fill('A pia está pingando desde cedo e já molhou o piso perto das bancadas.');
  await page.getByLabel('Categoria').selectOption({ label: 'hidráulica' });
  const local = page.getByLabel('Local');
  await local.selectOption(await local.locator('option', { hasText: 'Laboratório de informática' }).first().getAttribute('value'));
  for (const r of ['Pode virar risco se demorar', 'Atrapalha, mas dá para trabalhar', 'Nesta semana']) {
    await page.getByText(r, { exact: true }).click();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await a.zoom(1.3, 0, 150, 0);
  await pausa(500);
  a.inicio();
  await pausa(250);
  await a.falar('registro');
  await a.quandoDisser('quem percebe', 0.6);
  await a.semZoom(0.4);
  const enviar = page.getByRole('button', { name: /abrir chamado/i });
  await a.rolarAte(enviar, 760);
  await a.clicar(enviar, 0);
  await page.waitForURL(/\/chamados\/\d+/);
  chamado = page.url();
  marcas.__chamado = chamado;
  const aviso = page.getByText(/O protocolo é SMP-/);
  await aviso.waitFor();
  await pausa(150);
  await a.zoom(1.5, 0, 150, 0.6);
  await pausa(650);
  await a.anel(aviso);
  await a.aguardarFala(400);
});

// 3b. Responsável e prazo: a gestão atribui; a tela passa a mostrar "Atribuído" e o prazo.
await gravar('atribuicao', { storageState: ana }, async (a) => {
  const { page, pausa } = a;
  await page.goto(chamado);
  await page.getByRole('button', { name: 'Em triagem', exact: true }).click();
  const form = page.locator('form', { has: page.getByRole('heading', { name: /atribuir técnico/i }) });
  const tecnico = form.locator('select');
  await tecnico.waitFor();
  await tecnico.selectOption(await tecnico.locator('option', { hasText: 'Paulo Tavares' }).first().getAttribute('value'));
  await a.posicionar(form, 300);
  await a.zoomEm(await a.caixa(form), 1.3, 0);
  await pausa(400);
  a.inicio();
  await pausa(200);
  await a.falar('atribuicao');
  await a.anel(tecnico);
  await pausa(1500);
  await a.anel(null);
  await a.clicar(form.getByRole('button', { name: 'Atribuir' }), 0);
  await page.getByText('Chamado atribuído.').waitFor();
  await a.semZoom(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await a.zoom(1.5, 0, 150, 0.8);
  await pausa(900); // o anel é medido na tela já aproximada
  await a.quandoDisser('e o prazo', 0.3);
  await a.anel([page.getByText('Atribuído', { exact: true }).first(), page.getByText(/^Prazo:/).first()]);
  await a.aguardarFala(400);
});

// 3c. Conclusão: a descrição do serviço e a confirmação de EPI já estão preenchidas.
await gravar('conclusao', { storageState: paulo }, async (a) => {
  const { page, pausa } = a;
  await page.goto(chamado);
  await page.getByRole('button', { name: 'Em andamento', exact: true }).click();
  await page.getByRole('button', { name: 'Concluído', exact: true }).click();
  const servico = page.getByLabel(/descrição do serviço executado/i);
  await servico.fill('Troca do vedante e reaperto do sifão. Teste de vazamento sem ocorrência.');
  await page.getByLabel(/EPIs exigidos/i).check();
  const concluir = page.getByRole('button', { name: 'Concluir chamado' });
  await a.posicionar(servico, 330);
  await a.zoom(1.3, 0, 330, 0);
  await pausa(400);
  a.inicio();
  await pausa(200);
  await a.falar('conclusao');
  await a.anel(servico);
  await pausa(1700);
  await a.anel(null);
  await a.clicar(concluir, 0);
  await page.getByText('Concluído', { exact: true }).first().waitFor();
  await a.semZoom(0);
  // O histórico é um <details> nativo: abre-se pelo <summary>.
  const historico = page.locator('summary', { hasText: 'Histórico' });
  await historico.click();
  const registros = page.locator('details', { hasText: 'Histórico' });
  await a.posicionar(registros, 200);
  await a.zoomEm(await a.caixa(registros), 1.3, 0.8);
  await a.aguardarFala(450);
});

// 4. Visão da gestão: um indicador por vez, cada um quando é dito.
await gravar('painel', { storageState: ana }, async (a) => {
  const { page, pausa } = a;
  await page.goto(`${APP}/`);
  // "Sem técnico" e "Atrasados" são botões (filtram a lista); "Em aberto" é só um número.
  const cartoes = [
    page.getByRole('button', { name: /sem técnico/i }).first(),
    page.getByRole('button', { name: /atrasados/i }).first(),
    page.getByText('Em aberto', { exact: true }).first().locator('xpath=..'),
  ];
  await cartoes[0].waitFor();
  await pausa(700);
  const caixas = [];
  for (const c of cartoes) caixas.push(await a.caixa(c));
  a.inicio();
  await pausa(300);
  await a.falar('painel');
  const trechos = ['o que está sem técnico', 'o que passou do prazo', 'e quantos chamados'];
  for (let i = 0; i < 3; i++) {
    await a.quandoDisser(trechos[i], 0.3);
    await a.anel(null);
    await a.zoomEm(caixas[i], 1.75, 0.6);
    await a.anel(cartoes[i]);
  }
  await a.aguardarFala(450);
  await a.anel(null);
  await a.semZoom(0.6);
});

// 5. Preventiva: o plano, e o "Gerar agora" como antecipação manual do que o agendador faz.
await gravar('preventiva', { storageState: ana }, async (a) => {
  const { page, pausa } = a;
  await page.goto(`${APP}/preventiva`);
  const titulo = page.getByRole('heading', { name: 'Planos cadastrados' });
  await titulo.waitFor();
  await a.posicionar(titulo, 70);
  const plano = page.locator('li', { hasText: 'Inspeção da bomba de recalque' }).first();
  const caixaDoPlano = await a.caixa(plano);
  await pausa(400);
  a.inicio();
  await pausa(250);
  await a.falar('planos');
  // Aproxima do texto do plano (serviço, periodicidade, próxima data), que é o que se diz;
  // volta ao quadro inteiro antes do clique, para o botão aparecer.
  await a.quandoDisser('cada plano', 0.6);
  await a.zoomEm(caixaDoPlano, 1.45, 0.7);
  await a.anel(plano);
  await a.aguardarFala(250);
  await a.falar('gerar');
  await a.quandoDisser('Com o botão', 1.6);
  await a.anel(null);
  await a.semZoom(0.5);
  await a.clicar(plano.getByRole('button', { name: 'Gerar agora' }), 0);
  // A tela pede confirmação e diz, ela mesma, que o agendador criaria o chamado sozinho.
  const confirmar = page.getByRole('dialog').getByRole('button', { name: 'Gerar agora' });
  await confirmar.waitFor();
  await pausa(1300);
  await a.clicar(confirmar, 0);
  await plano.getByText(/Última execução/).waitFor();
  // Depois de gerado, o plano muda de lugar na lista (ela segue a próxima data).
  await a.zoomEm(await a.caixa(plano), 1.4, 0.6);
  await a.anel(plano.getByText(/Última execução/).locator('xpath=..'));
  await a.aguardarFala(1000);
});

// 6. Encerramento: os três benefícios, depois a marca, o endereço e o QR Code.
await gravar('encerramento', {}, async ({ page, pausa, inicio, falar, aguardarFala }) => {
  const troca = ENTRADA + voz('beneficios') + 0.35;
  await arte(page, `
    .beneficios{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding-left:250px;gap:50px;
      animation:some .45s ${troca.toFixed(2)}s both}
    .beneficios div{font-size:92px;font-weight:700;letter-spacing:-2.5px;opacity:0;animation:entra .5s cubic-bezier(.22,1,.36,1) both;
      display:flex;align-items:center;gap:40px}
    .beneficios i{flex:none;width:86px;height:86px;border-radius:50%;background:#f0b963;display:grid;place-items:center}
    .beneficios svg{width:48px;height:48px}
    main{display:flex;align-items:center;gap:110px;opacity:0;animation:entra .6s ${(troca + 0.35).toFixed(2)}s cubic-bezier(.22,1,.36,1) both}
    .texto{max-width:1050px}
    .nome{display:flex;align-items:center;gap:26px}
    img{width:120px;height:120px;object-fit:contain}
    h1{font-size:104px;margin:0;letter-spacing:-3px;font-weight:700;white-space:nowrap}
    p{font-size:62px;line-height:1.2;margin:30px 0 40px;font-weight:600}
    .endereco{display:inline-block;padding:24px 44px;border-radius:18px;background:#f0b963;color:#16294b;font-size:54px;font-weight:700}
    .qr{flex:none;width:430px;padding:22px;border-radius:26px;background:#fff;box-shadow:0 20px 56px rgba(0,0,0,.4)}
    .qr svg{display:block;width:100%;height:auto}
  `, `<div class="beneficios">
      ${[['O que precisa de atenção', 'o que precisa'], ['Quem é o responsável', 'quem é'], ['O que passou do prazo', 'e o que passou']]
        .map(([t, trecho]) => `<div style="animation-delay:${quando('beneficios', trecho)}s">
        <i><svg viewBox="0 0 24 24" fill="none" stroke="#16294b" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></i>${t}</div>`).join('')}
    </div>
    <main><div class="texto"><div class="nome"><img src="data:image/png;base64,${marca64}"><h1>Conserva <b>Predial</b></h1></div>
      <p>Acesse e conheça o sistema</p><div class="endereco">${ENDERECO.replace(/[<>&]/g, '')}</div></div>
      <div class="qr">${qrSvg(`https://${ENDERECO}`)}</div></main>`);
  inicio();
  await pausa(ENTRADA * 1000);
  await falar('beneficios');
  await aguardarFala(700);
  await falar('convite');
  // O cartão fica parado depois da fala: é o tempo de apontar a câmera para o QR Code.
  await pausa((voz('convite') + 3.2) * 1000);
});

await navegador.close();

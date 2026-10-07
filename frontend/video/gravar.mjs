// Gravação da demonstração completa do Conserva Predial, com legendas e (opcionalmente)
// narração. Veja o README desta pasta: normalmente é o rodar.sh que chama este arquivo.
//
// Uso: node gravar.mjs [pasta-de-saida]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { chromium } from '@playwright/test';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP ?? 'http://localhost:4173';
const SAIDA = process.argv[2] ?? path.join(AQUI, 'saida');
const SENHA = 'senha123';
// Conta do administrador do banco DESCARTÁVEL de vídeo (criada por rodar.sh). Não existe em
// nenhum outro lugar, e o semear-admin.js recusa rodar com NODE_ENV=production.
const ADMIN = { email: 'admin_video@exemplo.com', senha: 'senha_video_local' };
const TITULO = 'Vazamento na pia do laboratório de informática';
const DESCRICAO =
  'A pia do laboratório está pingando sem parar desde cedo e já molhou o piso perto das bancadas dos computadores.';

// Narração: o manifesto traz a duração de cada fala (narrar.py sintetizar). Sem ele o vídeo
// sai só com legendas, como antes.
const arquivoManifesto = path.join(SAIDA, 'manifesto.json');
const manifesto = fs.existsSync(arquivoManifesto) ? JSON.parse(fs.readFileSync(arquivoManifesto, 'utf8')) : null;

const navegador = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
);
const contexto = await navegador.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: SAIDA, size: { width: 1280, height: 720 } },
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  reducedMotion: 'no-preference',
});

// Legenda e cursor desenhados por DOM + CSSOM (style.cssText), que a CSP estrita permite:
// nada de <style> nem atributo style escrito em HTML.
await contexto.addInitScript(() => {
  const montar = () => {
    if (!document.body || document.getElementById('__leg')) return;
    const leg = document.createElement('div');
    leg.id = '__leg';
    leg.style.cssText =
      'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:80%;z-index:2147483647;' +
      'padding:12px 24px;border-radius:12px;background:rgba(15,27,51,.93);color:#fff;' +
      'font:600 22px/1.35 system-ui,Segoe UI,sans-serif;text-align:center;opacity:0;' +
      'transition:opacity .35s;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.28)';
    const cur = document.createElement('div');
    cur.id = '__cur';
    cur.style.cssText =
      'position:fixed;left:0;top:0;width:20px;height:20px;margin:-3px 0 0 -3px;z-index:2147483647;' +
      'pointer-events:none;border-radius:50%;background:rgba(240,162,59,.9);border:2px solid #fff;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.45);transform:translate(-100px,-100px);transition:background .15s';
    document.body.append(leg, cur);
    document.addEventListener('mousemove', (e) => { cur.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, true);
    document.addEventListener('mousedown', () => { cur.style.background = 'rgba(31,56,100,.95)'; }, true);
    document.addEventListener('mouseup', () => { cur.style.background = 'rgba(240,162,59,.9)'; }, true);
  };
  document.addEventListener('DOMContentLoaded', montar);
  window.__legendaPos = (topo) => {
    const leg = document.getElementById('__leg');
    if (!leg) return;
    leg.style.bottom = topo ? 'auto' : '26px';
    leg.style.top = topo ? '58px' : 'auto';
  };
  window.__legenda = (texto, topo) => {
    montar();
    const leg = document.getElementById('__leg');
    if (!leg) return;
    window.__legendaPos(Boolean(topo));
    if (!texto) { leg.style.opacity = '0'; return; }
    leg.textContent = texto;
    leg.style.opacity = '1';
  };
});

const page = await contexto.newPage();
page.setDefaultTimeout(9000);
// O vídeo começa quando a página nasce: é daqui que se contam os instantes das falas.
const inicio = Date.now();
const agora = () => Date.now() - inicio;
const pausa = (ms) => page.waitForTimeout(ms);

// Cada fala só começa depois que a anterior terminou, e a legenda aparece junto com a voz.
// Sem isso a voz atropelaria a cena seguinte, ou haveria silêncio sem motivo.
const falasEmitidas = [];
let audioFim = 0;

async function esperarFala() {
  const resta = audioFim - agora();
  if (resta > 0) await pausa(resta + 250);
}

async function falar(chave) {
  if (!manifesto) return;
  const m = manifesto[chave];
  if (!m) throw new Error(`Fala sem áudio no manifesto: "${chave}". Rode: narrar.py sintetizar`);
  await esperarFala();
  falasEmitidas.push({ chave, t: agora() / 1000 });
  audioFim = agora() + m.duracao * 1000;
}

async function legenda(texto, ms = 0, topo = false) {
  if (texto) await falar(texto);
  await page.evaluate(([t, p]) => window.__legenda?.(t, p), [texto, topo]);
  if (ms) await pausa(ms);
}

// Marcadores de capítulo, em segundos desde o início da gravação.
const capitulos = [];
const marca = (nome) => capitulos.push({ t: Math.round(agora() / 1000), nome });

async function cartao(titulo, linhas, ms = 5500, chaveFala = null) {
  await page.goto('about:blank');
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:radial-gradient(circle at 30% 20%,#2a4a82,#162a4b 60%,#0e1b33);
      font-family:system-ui,Segoe UI,sans-serif;color:#fff;display:flex;align-items:center;justify-content:center}
    main{text-align:center;max-width:980px;animation:e .9s cubic-bezier(.22,1,.36,1) both}
    @keyframes e{from{opacity:0;transform:translateY(14px);filter:blur(8px)}to{opacity:1;transform:none;filter:none}}
    h1{font-size:68px;margin:0 0 14px;letter-spacing:-1px} h1 b{color:#f0b963}
    p{font-size:27px;margin:8px 0;color:#c9d4e3;line-height:1.4} p.d{color:#f0b963;font-weight:600}
    small{display:block;margin-top:34px;font-size:19px;color:#8fa3c4}
  </style><main><h1>${titulo}</h1>${linhas.map((l, i) => `<p class="${i === 0 ? 'd' : ''}">${l}</p>`).join('')}</main>`);
  if (chaveFala) await falar(chaveFala);
  await pausa(ms);
  await esperarFala();
}

async function mover(loc) {
  await loc.scrollIntoViewIfNeeded();
  await pausa(150);
  const b = await loc.boundingBox();
  // A legenda ocupa a faixa de baixo; se o alvo está ali, ela sobe para não o esconder.
  await page.evaluate((embaixo) => window.__legendaPos?.(embaixo), b.y + b.height > 560);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 24 });
  await pausa(220);
}

async function clicar(loc, depois = 650) {
  await mover(loc);
  await loc.click();
  await pausa(depois);
}

async function digitar(loc, texto, atraso = 32) {
  await mover(loc);
  await loc.click();
  await loc.pressSequentially(texto, { delay: atraso });
  await pausa(250);
}

async function rolar(total, passo = 70, espera = 22) {
  const direcao = Math.sign(total);
  for (let feito = 0; feito < Math.abs(total); feito += passo) {
    await page.mouse.wheel(0, direcao * passo);
    await pausa(espera);
  }
  await pausa(300);
}

async function entrar(email, senha = SENHA) {
  await page.goto(`${APP}/login`);
  await pausa(900);
  await digitar(page.getByLabel(/e-?mail/i), email);
  await digitar(page.getByLabel(/senha/i), senha, 45);
  await clicar(page.getByRole('button', { name: /entrar/i }), 300);
  await page.waitForURL('**/');
  await pausa(1700);
}

async function sair() {
  await clicar(page.getByRole('button', { name: 'Sair' }), 900);
}

// O código de 6 dígitos que o aplicativo autenticador mostraria (RFC 6238), para a cena
// da verificação em duas etapas: a conta é do banco descartável de vídeo.
function codigoTotp(segredo) {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of segredo) bits += alfabeto.indexOf(c).toString(2).padStart(5, '0');
  const chave = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hmac = createHmac('sha1', chave).update(contador).digest();
  const d = hmac[19] & 0x0f;
  return String((hmac.readUInt32BE(d) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function opcaoPorTexto(select, texto) {
  const valor = await select.locator('option', { hasText: texto }).first().getAttribute('value');
  await select.selectOption(valor);
}

try {
  // ───────────────────────────── abertura ─────────────────────────────
  await cartao('Conserva <b>Predial</b>', [
    'Sistema de chamados de manutenção predial',
    'Do pedido à avaliação, com prioridade, prazo e histórico',
    'Manutenção preventiva, etiquetas com QR Code e verificação em duas etapas',
    '<small>Demonstração completa · 4 perfis · projeto interdisciplinar</small>',
  ], 5500, 'abertura');

  // ───────────────────────────── 1. solicitante ─────────────────────────────
  marca('Abertura');
  await entrar('jorge.pacheco@conserva.demo');
  marca('Solicitante abre um chamado');
  await legenda('1 · Solicitante: o Jorge acompanha o que já pediu', 3600);
  await legenda('Cada pedido mostra estado, prioridade e prazo', 2800);

  await legenda('Ele percebeu um vazamento e vai abrir um chamado', 1500);
  await clicar(page.getByRole('link', { name: /abrir chamado/i }), 1500);

  await legenda('O formulário pede só o essencial', 1500);
  await digitar(page.getByLabel('Título'), TITULO, 36);
  await digitar(page.getByLabel('Descrição'), DESCRICAO, 20);
  await mover(page.getByLabel('Categoria'));
  await page.getByLabel('Categoria').selectOption({ label: 'hidráulica' });
  await pausa(700);
  await mover(page.getByLabel('Local'));
  await opcaoPorTexto(page.getByLabel('Local'), 'Laboratório de informática');
  await pausa(900);
  await legenda('A prioridade inicial é só uma sugestão: a gestão revisa na triagem', 2800);
  await clicar(page.getByRole('button', { name: /abrir chamado/i }), 1800);

  await legenda('O protocolo aparece na hora e o histórico começa a ser escrito', 3800);
  await rolar(380);
  await pausa(1200);
  await rolar(-380);
  await sair();

  // ───────────────────────────── 2. gestão ─────────────────────────────
  await legenda('', 0);
  await entrar('ana.ribeiro@conserva.demo');
  marca('Gestão: painel, triagem, priorização e atribuição');
  await legenda('2 · Gestão: a Ana vê onde está o problema', 3800);
  await legenda('Os indicadores destacam o que está sem técnico e o que já venceu o prazo', 3600);

  await legenda('Clicar num indicador filtra a lista, e os cartões se reorganizam', 1200);
  await clicar(page.getByRole('button', { name: /sem técnico/i }), 2600);
  await clicar(page.getByRole('button', { name: /sem técnico/i }), 1800);

  await legenda('O resumo abre ao lado, sem perder o lugar na lista', 1000);
  const abrirResumo = page.getByRole('button', { name: `Ver resumo: ${TITULO}` });
  await clicar(abrirResumo, 2800);
  await legenda('Título, estado, local, categoria, prazo e descrição num relance', 3000);
  await clicar(page.getByRole('link', { name: 'Abrir chamado completo' }), 1800);

  await legenda('Na tela do chamado a gestão faz a triagem', 1800);
  await clicar(page.getByRole('button', { name: 'Em triagem', exact: true }), 1800);

  await rolar(420);
  await legenda('Priorização: urgência, impacto e risco, com a regra vigente', 1600);
  const fator = (nome) => page.locator('label', { hasText: nome }).locator('select');
  await mover(fator('Urgência'));
  await fator('Urgência').selectOption({ label: '3 — alta' });
  await pausa(900);
  await mover(fator('Impacto'));
  await fator('Impacto').selectOption({ label: '2 — setorial' });
  await pausa(900);
  await mover(fator('Risco'));
  await fator('Risco').selectOption({ label: '3 — alto' });
  await pausa(1200);
  await legenda('O sistema sugere a prioridade e explica o motivo; mudar exige justificativa', 3600);
  await clicar(page.getByRole('button', { name: 'Registrar priorização' }), 2000);

  await rolar(300);
  await legenda('Agora atribui ao técnico responsável', 1400);
  const formAtribuir = page.locator('form', { has: page.getByRole('heading', { name: /atribuir técnico/i }) });
  await mover(formAtribuir.locator('select'));
  await opcaoPorTexto(formAtribuir.locator('select'), 'Paulo Tavares');
  await pausa(900);
  await clicar(formAtribuir.getByRole('button', { name: 'Atribuir' }), 2200);
  await legenda('O prazo (SLA) passa a valer pela prioridade, e o Paulo é avisado', 3400);
  await rolar(-900);
  await sair();

  // ───────────────────────────── 3. técnico ─────────────────────────────
  await legenda('', 0);
  await entrar('paulo.tavares@conserva.demo');
  marca('Técnico executa e conclui');
  await legenda('3 · Técnico: o Paulo vê só o que é dele', 3600);
  await clicar(page.getByRole('link', { name: new RegExp(TITULO) }), 1800);

  await legenda('Ele inicia o atendimento', 1400);
  await clicar(page.getByRole('button', { name: 'Em andamento', exact: true }), 1800);

  await rolar(260);
  await legenda('E registra o diagnóstico e o tempo gasto', 1400);
  await digitar(page.getByLabel('Diagnóstico'), 'Sifão da pia com a rosca frouxa e vedante ressecado.', 26);
  await digitar(page.getByLabel(/tempo empregado/i), '45', 90);
  await clicar(page.getByRole('button', { name: 'Salvar execução' }), 1600);

  await legenda('Para concluir, descreve o serviço executado (regra RN07)', 1400);
  await clicar(page.getByRole('button', { name: 'Concluído', exact: true }), 1200);
  await digitar(
    page.getByLabel(/descrição do serviço executado/i),
    'Troca do vedante e reaperto do sifão; teste de vazamento sem ocorrência.',
    24
  );
  await clicar(page.getByRole('button', { name: 'Concluir chamado' }), 2400);
  await legenda('Chamado concluído, e o solicitante é avisado', 3000);
  await rolar(-700);
  await sair();

  // ───────────────────────────── 4. avaliação ─────────────────────────────
  await legenda('', 0);
  await entrar('jorge.pacheco@conserva.demo');
  marca('Solicitante avalia o atendimento');
  await legenda('4 · De volta ao solicitante: o aviso chega no sino', 1400);
  await clicar(page.getByRole('button', { name: /^avisos/i }), 2600);
  await legenda('O primeiro aviso é a conclusão do chamado; um clique leva até ele', 1800);
  // O aviso cita o protocolo, não o título: o primeiro da lista é o mais recente.
  await clicar(page.locator('div.fixed.z-20 ul li').first().getByRole('button'), 1800);
  await legenda('Ele confere o histórico completo e avalia o atendimento', 2600);
  const avaliar = page.locator('form', { has: page.getByRole('heading', { name: /avaliar atendimento/i }) });
  await mover(avaliar);
  await mover(avaliar.locator('select'));
  await avaliar.locator('select').selectOption('5');
  await pausa(900);
  await clicar(avaliar.getByRole('button', { name: 'Enviar avaliação' }), 2200);
  await legenda('A nota entra nos relatórios de desempenho', 2800);
  await sair();

  // ───────────────────────────── 5. relatórios ─────────────────────────────
  await legenda('', 0);
  await entrar('ana.ribeiro@conserva.demo');
  marca('Relatórios e cadastros');
  await legenda('5 · De volta à gestão: relatórios do período', 1200);
  await clicar(page.getByRole('link', { name: 'Relatórios' }), 3600);

  await legenda('Totais, e o gráfico de chamados por dia, abertos e concluídos', 3000, true);
  const grafico = page.getByRole('group', { name: /por dia/i });
  await grafico.scrollIntoViewIfNeeded();
  await pausa(2300);
  const g = await grafico.boundingBox();
  await legenda('Passe o mouse (ou use as setas) para ler cada dia', 800, true);
  for (const f of [0.08, 0.28, 0.5, 0.72, 0.95]) {
    await page.mouse.move(g.x + 34 + (g.width - 48) * f, g.y + 100, { steps: 16 });
    await pausa(900);
  }
  await page.mouse.move(g.x - 80, g.y - 80, { steps: 10 });
  await pausa(500);

  await legenda('Por estado, categoria, prioridade e local, com prazo (SLA) e desempenho', 2200);
  await rolar(560);
  await pausa(1800);
  await rolar(520);
  await pausa(1800);
  await legenda('Carga por técnico, e exportação em PDF e planilha', 2800);
  await rolar(-2000, 120, 14);

  await legenda('Cadastros: locais e categorias, inclusive em massa por planilha', 1000);
  await clicar(page.getByRole('link', { name: 'Cadastros' }), 3400);

  // ───────────────────────────── 6. preventiva ─────────────────────────────
  marca('Manutenção preventiva e etiquetas');
  await legenda('6 · Preventiva (NBR 5674): planos que abrem o próprio chamado', 1000);
  await clicar(page.getByRole('link', { name: 'Preventiva', exact: true }), 2600);
  await legenda('Cada plano diz o que fazer, a cada quanto tempo, onde e por quem', 2400);
  const planoBomba = page.locator('li', { hasText: 'Inspeção da bomba de recalque' });
  await mover(planoBomba);
  await pausa(1200);
  await legenda('Na data, o agendador gera o chamado sozinho; aqui, pelo botão Gerar agora', 800);
  await clicar(planoBomba.getByRole('button', { name: 'Gerar agora' }), 2400);
  await legenda('O chamado nasce com o roteiro do serviço e segue o fluxo normal', 3200, true);
  await legenda('', 0);

  await clicar(page.getByRole('tab', { name: 'Equipamentos' }), 1600);
  await legenda('Cada equipamento tem ficha própria: etiqueta, planos e histórico', 800);
  await clicar(page.getByRole('link', { name: /BOMBA-01/ }), 2600);
  await rolar(420);
  await pausa(1600);
  await rolar(-420);

  await legenda('A etiqueta com QR Code vai colada no equipamento', 800);
  await page.goto(`${APP}/etiquetas`);
  await pausa(2600);
  await legenda('Lido pela câmera do celular, o QR abre o chamado já preenchido', 800);
  await page.goto(`${APP}/chamados/novo?equipamento=BOMBA-01`);
  await pausa(3400);
  await legenda('O app também se instala no celular e consulta a fila sem conexão', 3400);

  // ───────────────────────────── 7. segurança da conta ─────────────────────────────
  await legenda('', 0);
  marca('Verificação em duas etapas');
  await legenda('7 · Minha conta: verificação em duas etapas', 800);
  await clicar(page.getByTitle('Minha conta'), 2200);
  await legenda('Recomendada para a gestão: a senha sozinha deixa de abrir a conta', 1200);
  await clicar(page.getByRole('button', { name: 'Ligar a verificação em duas etapas' }), 2400);
  await legenda('O QR Code cadastra a conta no aplicativo autenticador do celular', 2600);
  const segredo = (await page.locator('code').first().textContent()).trim();
  await legenda('Para ligar, o código do aplicativo e a senha', 600);
  await digitar(page.getByLabel('Código do aplicativo'), codigoTotp(segredo), 90);
  await digitar(page.getByLabel('Senha'), SENHA, 45);
  await clicar(page.getByRole('button', { name: 'Ligar', exact: true }), 2400);
  await legenda('Os códigos de recuperação aparecem uma única vez', 3000);
  await rolar(300);
  await legenda('E "sair de todos os aparelhos" derruba qualquer sessão esquecida', 3200);
  await sair();

  // ───────────────────────────── 8. administração ─────────────────────────────
  await legenda('', 0);
  await entrar(ADMIN.email, ADMIN.senha);
  marca('Administração de usuários');
  await legenda('8 · Administração: quem entra e com qual perfil', 1000);
  await clicar(page.getByRole('link', { name: 'Usuários' }), 2600);
  await rolar(300);
  await legenda('Desativar, trocar perfil ou anonimizar (LGPD), sem deixar chamados órfãos', 4200, true);
  await legenda('', 0);

  // ───────────────────────────── encerramento ─────────────────────────────
  marca('Encerramento');
  await cartao('Conserva <b>Predial</b>', [
    'Permissão no servidor · SLA em horas corridas ou úteis · preventiva · LGPD',
    '543 testes de API · 285 de tela · 123 de ponta a ponta · CI a cada envio',
    '<small>Node/Express + PostgreSQL · React/Vite/Tailwind · Vercel + Supabase</small>',
  ], 7000, 'encerramento');
} finally {
  await contexto.close();
  await navegador.close();
}
fs.writeFileSync(path.join(SAIDA, 'capitulos.json'), JSON.stringify(capitulos, null, 1));
fs.writeFileSync(path.join(SAIDA, 'legendas.json'), JSON.stringify(falasEmitidas, null, 1));
console.log('GRAVADO');

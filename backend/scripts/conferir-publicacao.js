#!/usr/bin/env node
/**
 * Conferência pós-deploy: chama a API PUBLICADA e confere que ela atende.
 *
 * Por que existe: em 10/11/2026 a API ficou fora do ar desde o deploy do PR #102 até alguém
 * tentar entrar. Os testes passaram todos (rodam com os arquivos no disco), e a função da Vercel
 * respondia 500 em toda rota ("Cannot find module './routes/auth.routes'"). Teste nenhum enxerga o
 * pacote que a Vercel monta; só uma chamada à API publicada enxerga.
 *
 * O que confere, sem login e sem escrever nada:
 * - `/health` responde 200;
 * - `/health/db` responde 200 com o banco conectado, e diz ser (ou não) de demonstração conforme
 *   o esperado: a API da produção ligada ao banco da demo, ou o contrário, também é falha;
 * - cada roteador montado em `src/app.js` responde abaixo de 500 (401, 403 e 404 são a API
 *   funcionando; 5xx é a função quebrada). A lista sai do próprio `app.js`: roteador novo entra
 *   na conferência sem ninguém lembrar.
 *
 * - com o segredo do agendador (CRON_SECRET no ambiente), que cada tarefa agendada passou dentro
 *   da tolerância (`/tarefas/saude`): o aviso de atraso ficou parado de 09/11/2026 em diante sem
 *   que a conferência visse, porque ela só olhava a API.
 *
 * Uso: node scripts/conferir-publicacao.js <url-da-api> [producao|demonstracao]
 * Repete a rodada inteira até CONFERIR_TENTATIVAS vezes (padrão 1), com CONFERIR_ESPERA_MS entre
 * elas: o aviso de deploy pronto pode chegar segundos antes de o domínio apontar para ele.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'src', 'app.js');

/**
 * Endereço da API que um site usa: o destino do `/api/:path*` no vercel.json dele. É a mesma
 * fonte que o navegador segue, então a conferência não guarda um endereço que possa envelhecer.
 */
function apiDoSite(arquivoVercel) {
  const config = JSON.parse(fs.readFileSync(path.resolve(arquivoVercel), 'utf8'));
  const regra = (config.rewrites || []).find((r) => r.source === '/api/:path*');
  if (!regra) throw new Error(`${arquivoVercel} não encaminha /api para a API.`);
  return new URL(regra.destination.replace('/:path*', '')).origin;
}

/** Caminhos dos roteadores, lidos da lista ROTEADORES de app.js. */
function rotasMontadas(codigo = fs.readFileSync(APP, 'utf8')) {
  return [...codigo.matchAll(/\[\s*'(\/[^']+)'\s*,\s*require\(/g)].map((m) => m[1]);
}

async function obter(base, caminho, cabecalhos = {}) {
  try {
    const resp = await fetch(new URL(caminho, base), {
      headers: cabecalhos,
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    let corpo = null;
    try {
      corpo = await resp.json();
    } catch {
      // Página de erro da Vercel não é JSON; o status já diz o bastante.
    }
    return { status: resp.status, corpo };
  } catch (err) {
    return { status: 0, corpo: null, erro: err.message };
  }
}

/** Uma rodada. Devolve a lista de falhas (vazia quando tudo atende). */
async function conferir(base, esperado = 'producao', rotas = rotasMontadas(), { segredoAgendador } = {}) {
  const falhas = [];

  const saude = await obter(base, '/health');
  if (saude.status !== 200) falhas.push(`/health respondeu ${saude.status || saude.erro}`);

  const banco = await obter(base, '/health/db');
  if (banco.status !== 200 || banco.corpo?.banco !== 'conectado') {
    falhas.push(`/health/db respondeu ${banco.status || banco.erro}`);
  } else if (banco.corpo.demonstracao !== (esperado === 'demonstracao')) {
    falhas.push(
      `/health/db diz demonstracao=${banco.corpo.demonstracao}, mas esta API devia ser de ${esperado}`
    );
  }

  for (const rota of rotas) {
    const { status, erro } = await obter(base, rota);
    // 0 é sem resposta (rede, tempo esgotado): também é a API fora do ar.
    if (status === 0 || status >= 500) falhas.push(`${rota} respondeu ${status || erro}`);
  }

  if (segredoAgendador) {
    const saude = await obter(base, '/tarefas/saude', { Authorization: `Bearer ${segredoAgendador}` });
    if (saude.status !== 200 || !Array.isArray(saude.corpo?.tarefas)) {
      falhas.push(`/tarefas/saude respondeu ${saude.status || saude.erro}`);
    } else {
      for (const t of saude.corpo.tarefas.filter((t) => t.situacao !== 'ok')) {
        const desde = t.ultimo_sucesso ? `último sucesso em ${t.ultimo_sucesso}` : 'nenhum sucesso registrado';
        falhas.push(`agendador: ${t.rotulo} ${t.situacao} (${desde}; esperado ${t.frequencia})`);
      }
    }
  }

  return falhas;
}

async function principal() {
  const [base, esperado = 'producao'] = process.argv.slice(2);
  if (!base || !['producao', 'demonstracao'].includes(esperado)) {
    console.error('Uso: node scripts/conferir-publicacao.js <url-da-api> [producao|demonstracao]');
    process.exit(2);
  }
  const tentativas = Number(process.env.CONFERIR_TENTATIVAS) || 1;
  const espera = Number(process.env.CONFERIR_ESPERA_MS) || 30000;
  const rotas = rotasMontadas();
  // Só o segredo da API que se está conferindo: o da produção não vale na demonstração.
  const segredoAgendador = process.env.CRON_SECRET || undefined;
  if (!segredoAgendador && esperado === 'producao') {
    console.log('::warning::CRON_SECRET não cadastrado no GitHub: o agendador não foi conferido.');
  }

  let falhas = [];
  for (let i = 1; i <= tentativas; i += 1) {
    falhas = await conferir(base, esperado, rotas, { segredoAgendador });
    if (falhas.length === 0) {
      const extra = segredoAgendador ? ' e as tarefas agendadas' : '';
      console.log(`${base} atende: /health, /health/db, ${rotas.length} roteadores${extra} (tentativa ${i}).`);
      return;
    }
    console.log(`Tentativa ${i} de ${tentativas}: ${falhas.join('; ')}`);
    if (i < tentativas) await new Promise((r) => setTimeout(r, espera));
  }
  for (const f of falhas) console.log(`::error::${base}: ${f}`);
  process.exit(1);
}

if (require.main === module) principal();

module.exports = { apiDoSite, rotasMontadas, conferir };

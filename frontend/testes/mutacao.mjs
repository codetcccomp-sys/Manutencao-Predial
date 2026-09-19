#!/usr/bin/env node
/**
 * Teste de mutação, à mão e de propósito.
 *
 * Um teste que passa não prova nada sozinho: ele pode estar passando pelo
 * motivo errado. Aqui cada mutação quebra um comportamento específico do
 * código e confere que a suíte acusa. O que não for acusado é um teste
 * decorativo — e foi assim que se descobriu que a exceção do /auth/login no
 * interceptor podia ser apagada sem nenhum teste reclamar.
 *
 * Não roda no CI: é uma ferramenta para usar ao escrever ou revisar testes,
 * porque leva o tempo da suíte multiplicado pelo número de mutações.
 *
 * Uso:
 *   node testes/mutacao.mjs              todas
 *   node testes/mutacao.mjs vitest       só as que rodam em jsdom (rápidas)
 *   node testes/mutacao.mjs playwright   só as de layout (reconstroem a build)
 */
import { execSync } from 'child_process';
import fs from 'fs';

const MUTACOES = [
  {
    descricao: 'interceptor deixa de excetuar o /auth/login',
    arquivo: 'src/api/client.js',
    de: "const ehTentativaDeLogin = error.config?.url?.includes('/auth/login');",
    para: 'const ehTentativaDeLogin = false;',
    spec: 'testes/client.test.js',
  },
  {
    descricao: 'interceptor dispara mesmo sem token guardado',
    arquivo: 'src/api/client.js',
    de: "const tinhaSessao = Boolean(localStorage.getItem('smp_token'));",
    para: 'const tinhaSessao = true;',
    spec: 'testes/client.test.js',
  },
  {
    descricao: 'download ignora o nome vindo do servidor',
    arquivo: 'src/api/client.js',
    de: `const nome = /filename="([^"]+)"/.exec(disposicao)?.[1] || 'download';`,
    para: `const nome = 'download';`,
    spec: 'testes/client.test.js',
  },
  {
    descricao: 'download não desembrulha o erro que veio como blob',
    arquivo: 'src/api/client.js',
    de: "if (corpo instanceof Blob && corpo.type.includes('json')) {",
    para: 'if (false) {',
    spec: 'testes/client.test.js',
  },
  {
    descricao: 'sino deixa de cortar o contador em 9+',
    arquivo: 'src/components/Avisos.jsx',
    de: "{naoLidas > 9 ? '9+' : naoLidas}",
    para: '{naoLidas}',
    spec: 'testes/Avisos.test.jsx',
  },
  {
    descricao: 'sino conta as lidas junto com as não lidas',
    arquivo: 'src/components/Avisos.jsx',
    de: 'const naoLidas = avisos.filter((a) => !a.lida).length;',
    para: 'const naoLidas = avisos.length;',
    spec: 'testes/Avisos.test.jsx',
  },
  {
    descricao: 'sino marca como lida uma notificação já lida',
    arquivo: 'src/components/Avisos.jsx',
    de: 'if (!aviso.lida) {',
    para: 'if (true) {',
    spec: 'testes/Avisos.test.jsx',
  },
  {
    descricao: 'painel não prende a posição dentro da tela',
    arquivo: 'src/components/Avisos.jsx',
    de: 'left: Math.max(MARGEM_TELA, Math.min(r.right - largura, limiteDireito)),',
    para: 'left: r.right - largura,',
    // Geometria não existe no jsdom: só o navegador acusa.
    motor: 'playwright',
    spec: 'e2e/layout.spec.js',
  },
  {
    descricao: 'filtro de locais deixa de filtrar',
    arquivo: 'src/pages/Cadastros.jsx',
    de: '? locais.filter((l) => rotuloLocal(l).toLowerCase().includes(termo))',
    para: '? locais',
    spec: 'testes/Cadastros.test.jsx',
  },
  {
    descricao: 'busca do painel deixa de ser enviada à API',
    arquivo: 'src/pages/Dashboard.jsx',
    de: '...(buscaAplicada ? { busca: buscaAplicada } : {}),',
    para: '',
    spec: 'testes/Dashboard.test.jsx',
  },
  {
    descricao: 'busca deixa de esperar a digitação parar',
    arquivo: 'src/pages/Dashboard.jsx',
    de: '}, 400);',
    para: '}, 0);',
    spec: 'testes/Dashboard.test.jsx',
  },
  {
    descricao: 'cartão de chamado deixa de encolher',
    arquivo: 'src/pages/Dashboard.jsx',
    de: 'gap-3 min-w-0 hover:shadow-md',
    para: 'gap-3 hover:shadow-md',
    motor: 'playwright',
    spec: 'e2e/layout.spec.js',
  },
  {
    descricao: 'select de técnico deixa de encolher',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: 'className="border rounded px-3 py-2 w-full min-w-0"',
    para: 'className="border rounded px-3 py-2"',
    motor: 'playwright',
    spec: 'e2e/layout.spec.js',
  },
  {
    descricao: 'anexos e comentários voltam a ser pedidos em paralelo',
    arquivo: 'src/pages/ChamadoDetalhe.jsx',
    de: `carregar().then((carregou) => {
      if (!carregou) return;`,
    para: 'carregar().then(() => {',
    spec: 'testes/ChamadoDetalhe.test.jsx',
  },
  {
    descricao: 'importação lê a planilha sempre como UTF-8',
    arquivo: 'src/pages/Cadastros.jsx',
    de: `    return new TextDecoder('windows-1252').decode(bytes);`,
    para: `    return new TextDecoder('utf-8').decode(bytes);`,
    spec: 'testes/Cadastros.test.jsx',
  },
  {
    descricao: 'importação engole a lista de problemas do arquivo',
    arquivo: 'src/pages/Cadastros.jsx',
    de: 'setProblemas(corpo?.detalhes || []);',
    para: 'setProblemas([]);',
    spec: 'testes/Cadastros.test.jsx',
  },
  {
    descricao: 'importação não recarrega a lista de locais',
    arquivo: 'src/pages/Cadastros.jsx',
    de: `      setRelatorio(data.relatorio);
      carregar();`,
    para: '      setRelatorio(data.relatorio);',
    spec: 'testes/Cadastros.test.jsx',
  },
];

/**
 * Restauração à prova de interrupção.
 *
 * O `finally` de cada iteração devolve o arquivo ao original, mas não roda se
 * o processo for morto no meio — e aí o código fica mutado no disco, o que já
 * aconteceu: uma execução interrompida deixou o contador do sino somando as
 * notificações lidas. Guardar o original aqui e restaurar em qualquer saída
 * fecha esse buraco.
 */
const originais = new Map();

function restaurarTudo() {
  for (const [arquivo, conteudo] of originais) {
    fs.writeFileSync(arquivo, conteudo);
  }
  originais.clear();
}

for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'uncaughtException']) {
  process.on(sinal, (erro) => {
    restaurarTudo();
    console.error(`\n[mutacao] interrompido (${sinal}); arquivos restaurados.`);
    if (erro instanceof Error) console.error(erro.message);
    process.exit(1);
  });
}
process.on('exit', restaurarTudo);

let decoradas = 0;

const filtro = process.argv[2];

for (const { descricao, arquivo, de, para, spec, motor = 'vitest' } of MUTACOES) {
  if (filtro && motor !== filtro) continue;
  if (!fs.existsSync(spec)) {
    console.log(`sem spec   | ${descricao}`);
    continue;
  }

  const original = fs.readFileSync(arquivo, 'utf8');
  if (!original.includes(de)) {
    console.log(`DESATUALIZADA | ${descricao} — o trecho mudou, atualize a mutação`);
    decoradas += 1;
    continue;
  }

  originais.set(arquivo, original);
  fs.writeFileSync(arquivo, original.replace(de, para));
  try {
    // O Playwright roda contra a build servida pelo preview: sem reconstruir,
    // a mutação ficaria só no código-fonte e a tela continuaria a antiga — a
    // mutação passaria "despercebida" por um motivo que não é o teste.
    const comando =
      motor === 'playwright'
        ? `npm run build --silent && npx playwright test ${spec}`
        : `npx vitest run ${spec}`;
    execSync(comando, { stdio: 'ignore' });
    console.log(`NÃO PEGOU  | ${descricao}`);
    decoradas += 1;
  } catch {
    console.log(`pegou      | ${descricao}`);
  } finally {
    fs.writeFileSync(arquivo, original);
    originais.delete(arquivo);
  }
}

console.log(
  decoradas === 0
    ? '\nTodas as mutações foram acusadas.'
    : `\n${decoradas} mutação(ões) passaram despercebidas — há teste decorativo aí.`
);
process.exit(decoradas === 0 ? 0 : 1);

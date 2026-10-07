#!/usr/bin/env node
/**
 * Teste de mutação do backend, à mão e de propósito (o do frontend é
 * frontend/testes/mutacao.mjs).
 *
 * Cada mutação desfaz uma trava específica — a que impede o código do
 * aplicativo de valer duas vezes, a que derruba a sessão roubada quando a
 * senha muda — e confere que a suíte indicada acusa. Mutação que passa
 * despercebida é teste decorativo: a trava pode sumir num refactor sem
 * ninguém notar.
 *
 * Não roda no CI (leva o tempo das suítes vezes o número de mutações), e não
 * casa com o padrão *.test.js de propósito: o Jest não deve pegá-lo.
 *
 * Uso, com o banco de teste configurado no .env:
 *   node tests/mutacao.js               todas
 *   node tests/mutacao.js sessão        só as que contêm "sessão" na descrição
 *
 * As mutações em migração recriam um banco descartável (smp_mutacao) e
 * migram nele, porque a função alterada só muda depois de aplicada.
 */
require('dotenv').config();
const fs = require('fs');
const { spawnSync } = require('child_process');

const MUTACOES = [
  {
    descricao: 'código do aplicativo volta a valer duas vezes',
    arquivo: 'src/services/auth.service.js',
    de: 'AND (totp_ultimo_passo IS NULL OR totp_ultimo_passo < $2)',
    para: 'AND (totp_ultimo_passo IS NULL OR totp_ultimo_passo <= $2)',
    spec: 'tests/cookieE2fa.test.js',
  },
  {
    descricao: 'escrita só com cookie deixa de exigir o cabeçalho da tela',
    arquivo: 'src/services/sessao.service.js',
    de: "return origem === 'cookie' && !METODOS_SEGUROS.includes(req.method) && req.headers[CABECALHO_CSRF] !== '1';",
    para: 'return false;',
    spec: 'tests/cookieE2fa.test.js',
  },
  {
    descricao: 'trocar a senha deixa a sessão roubada aberta',
    arquivo: 'src/services/recuperacao.service.js',
    de: "'UPDATE usuario SET senha_hash = $1, sessao_versao = sessao_versao + 1 WHERE id = $2',",
    para: "'UPDATE usuario SET senha_hash = $1 WHERE id = $2',",
    spec: 'tests/cookieE2fa.test.js',
  },
  {
    descricao: 'versão da sessão deixa de ser conferida',
    arquivo: 'src/middlewares/auth.js',
    de: '|| (payload.sv ?? 0) !== conta.sessao_versao',
    para: '',
    spec: 'tests/cookieE2fa.test.js',
  },
  {
    descricao: 'desafio do 2FA passa a valer como sessão',
    arquivo: 'src/middlewares/auth.js',
    de: '  if (payload.tipo) {\n    return next(',
    para: '  if (false) {\n    return next(',
    spec: 'tests/cookieE2fa.test.js',
  },
  {
    descricao: 'senha certa com 2FA zera o contador de falhas',
    arquivo: 'src/controllers/auth.controller.js',
    de: "    if (resultado.requer2fa) {\n      return res.json({ requer_2fa: true, desafio: resultado.desafio });\n    }\n\n    await registrarTentativa(req.body.email, ip, true);",
    para: "    await registrarTentativa(req.body.email, ip, true);\n    if (resultado.requer2fa) {\n      return res.json({ requer_2fa: true, desafio: resultado.desafio });\n    }",
    spec: 'tests/cookieE2fa.test.js',
  },
  {
    descricao: 'ligar o 2FA deixa de pedir a senha',
    arquivo: 'src/services/auth.service.js',
    de: "    if (!(await bcrypt.compare(String(senha ?? ''), conta.senha_hash))) {\n      throw new AppError('Senha incorreta.', 422, 'SENHA_INCORRETA');\n    }\n    if (conta.totp_ativado_em) {",
    para: '    if (conta.totp_ativado_em) {',
    spec: 'tests/cookieE2fa.test.js',
  },
  {
    descricao: 'sessão reemitida volta no corpo também para quem entrou pelo cookie',
    arquivo: 'src/services/sessao.service.js',
    de: "return req.origemDaSessao === 'cabecalho' ? { token } : {};",
    para: 'return { token };',
    spec: 'tests/cookieE2fa.test.js',
  },
  {
    descricao: 'chute de código na própria conta deixa de contar no limite',
    arquivo: 'src/controllers/auth.controller.js',
    de: "    if (err.code === 'CODIGO_INVALIDO' || err.code === 'SENHA_INCORRETA') {\n      await registrarTentativa(req.usuario.email, ipDoCliente(req), false);\n    }",
    para: '',
    spec: 'tests/cookieE2fa.test.js',
  },
  {
    descricao: 'gerar códigos novos deixa de passar pelo limite',
    arquivo: 'src/routes/auth.routes.js',
    de: "  validate({ codigo: { obrigatorio: true, tipo: 'string', maxLength: 20 } }),\n  limitarPelaConta,\n  authController.novosCodigos",
    para: "  validate({ codigo: { obrigatorio: true, tipo: 'string', maxLength: 20 } }),\n  authController.novosCodigos",
    spec: 'tests/cookieE2fa.test.js',
  },
  {
    descricao: 'horas úteis voltam a contar o fim de semana',
    arquivo: 'database/migrations/021_prazo_em_horas_uteis.sql',
    de: "WHEN 'uteis' THEN somar_horas_uteis(inicio, make_interval(hours => s.prazo_horas) + suspenso_util, fuso)",
    para: "WHEN 'uteis' THEN inicio + make_interval(hours => s.prazo_horas) + suspenso_util",
    spec: 'tests/horasUteis.test.js',
    migrar: true,
  },
  {
    descricao: 'funções voltam a ser executáveis por PUBLIC (e pela chave anon)',
    arquivo: 'database/migrations/023_funcoes_so_para_o_backend.sql',
    de: 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;',
    para: '',
    spec: 'tests/migracoes.test.js',
    migrar: true,
  },
  {
    descricao: 'preventiva volta a ser gerada duas vezes para a mesma data',
    arquivo: 'src/services/preventiva.service.js',
    de: 'ON CONFLICT (plano_id, data_prevista) WHERE plano_id IS NOT NULL DO NOTHING',
    para: '',
    spec: 'tests/preventiva.test.js',
  },
  {
    descricao: 'anexo no Storage volta a ser lido antes da permissão',
    arquivo: 'src/controllers/anexos.controller.js',
    de: '  const registro = await anexosService.buscarMetadados(req.params.anexoId);\n  await chamadosService.garantirLeitura(registro.chamado_id, req.usuario);\n  const anexo = await anexosService.buscarConteudo(req.params.anexoId);',
    para: '  const anexo = await anexosService.buscarConteudo(req.params.anexoId);\n  await chamadosService.garantirLeitura(anexo.chamado_id, req.usuario);',
    spec: 'tests/anexosStorage.test.js',
  },
];

const BANCO_DESCARTAVEL = 'smp_mutacao';

// Restauração à prova de interrupção: um Ctrl+C no meio da suíte não pode
// deixar o código mutado no disco.
const originais = new Map();
function restaurarTudo() {
  for (const [arquivo, conteudo] of originais) fs.writeFileSync(arquivo, conteudo);
  originais.clear();
}
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sinal, () => {
    restaurarTudo();
    console.error(`\n[mutacao] interrompido (${sinal}); arquivos restaurados.`);
    process.exit(1);
  });
}
process.on('exit', restaurarTudo);

function rodar(comando, env) {
  return spawnSync('bash', ['-c', comando], { stdio: 'ignore', env: { ...process.env, ...env } }).status;
}

function prepararBancoDescartavel() {
  const conexao = `-h ${process.env.DB_HOST || 'localhost'} -p ${process.env.DB_PORT || 5432} -U ${process.env.DB_USER}`;
  const env = { PGPASSWORD: process.env.DB_PASSWORD, DB_NAME: BANCO_DESCARTAVEL };
  const status = rodar(
    `dropdb ${conexao} --if-exists ${BANCO_DESCARTAVEL} && createdb ${conexao} ${BANCO_DESCARTAVEL} && node database/migrate.js`,
    env
  );
  if (status !== 0) throw new Error(`não foi possível preparar o banco ${BANCO_DESCARTAVEL}`);
  return env;
}

const filtro = process.argv[2] || '';
let despercebidas = 0;

for (const m of MUTACOES.filter((x) => x.descricao.includes(filtro))) {
  const original = fs.readFileSync(m.arquivo, 'utf8');
  if (!original.includes(m.de)) {
    console.log(`DESATUALIZADA | ${m.descricao} — o trecho mudou, atualize a mutação`);
    despercebidas += 1;
    continue;
  }

  originais.set(m.arquivo, original);
  fs.writeFileSync(m.arquivo, original.replace(m.de, m.para));
  try {
    const env = m.migrar ? prepararBancoDescartavel() : {};
    const status = rodar(`npx jest --runInBand ${m.spec}`, env);
    if (status === 0) despercebidas += 1;
    console.log(`${status === 0 ? 'NÃO PEGOU' : 'pegou    '} | ${m.descricao}`);
  } finally {
    fs.writeFileSync(m.arquivo, original);
    originais.delete(m.arquivo);
  }
}

console.log(
  despercebidas === 0
    ? '\nTodas as mutações foram acusadas.'
    : `\n${despercebidas} mutação(ões) passaram despercebidas — há teste decorativo aí.`
);
process.exit(despercebidas === 0 ? 0 : 1);

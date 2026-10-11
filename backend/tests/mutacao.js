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
  {
    descricao: 'distribuição: a regra mais geral passa a vencer a mais específica',
    arquivo: 'src/services/distribuicao.service.js',
    de: 'ORDER BY (r.bloco IS NOT NULL) DESC, (r.unidade IS NOT NULL) DESC',
    para: 'ORDER BY (r.bloco IS NOT NULL) ASC, (r.unidade IS NOT NULL) ASC',
    spec: 'tests/distribuicao.test.js',
  },
  {
    descricao: 'distribuição: regra desligada continua distribuindo',
    arquivo: 'src/services/distribuicao.service.js',
    de: '      WHERE r.ativo\n        AND r.categoria_id = $1',
    para: '      WHERE r.categoria_id = $1',
    spec: 'tests/distribuicao.test.js',
  },
  {
    descricao: 'distribuição: a divisão manda para quem tem MAIS chamados em aberto',
    arquivo: 'src/services/distribuicao.service.js',
    de: 'ORDER BY em_aberto ASC,',
    para: 'ORDER BY em_aberto DESC,',
    spec: 'tests/distribuicao.test.js',
  },
  {
    descricao: 'distribuição: chamado concluído passa a pesar na carga',
    arquivo: 'src/services/distribuicao.service.js',
    de: "const ESTADOS_EM_ABERTO = \"('atribuido', 'em_andamento', 'aguardando_material')\";",
    para: "const ESTADOS_EM_ABERTO = \"('atribuido', 'em_andamento', 'aguardando_material', 'concluido')\";",
    spec: 'tests/distribuicao.test.js',
  },
  {
    descricao: 'distribuição: plantonista desativado continua recebendo',
    arquivo: 'src/services/distribuicao.service.js',
    de: "WHERE et.equipe_id = $1 AND u.id = $2\n          AND u.perfil = 'tecnico' AND u.ativo AND u.anonimizado_em IS NULL",
    para: "WHERE et.equipe_id = $1 AND u.id = $2",
    spec: 'tests/distribuicao.test.js',
  },
  {
    descricao: 'distribuição: dois chamados simultâneos deixam de esperar a vez da equipe',
    arquivo: 'src/services/distribuicao.service.js',
    de: "  await client.query(\"SELECT pg_advisory_xact_lock(hashtext('regra_distribuicao'), $1)\", [regra.equipe_id]);\n",
    para: '',
    spec: 'tests/distribuicao.test.js',
  },
  {
    descricao: 'distribuição: o plantonista pode ser de fora da equipe',
    arquivo: 'src/services/distribuicao.service.js',
    de: '  if (tecnicoId === null || tecnicoId === undefined) return;',
    para: '  return;',
    spec: 'tests/distribuicao.test.js',
  },
  {
    descricao: 'aprovação: login de pedido pendente revela a pendência sem conferir a senha',
    arquivo: 'src/services/auth.service.js',
    de: '    if (await bcrypt.compare(senha, usuario.senha_hash)) {\n      throw new AppError(\n        \'Seu cadastro ainda aguarda',
    para: '    if (true) {\n      throw new AppError(\n        \'Seu cadastro ainda aguarda',
    spec: 'tests/cadastroAprovacao.test.js',
  },
  {
    descricao: 'aprovação: o cadastro ignora a exigência e entra direto',
    arquivo: 'src/services/auth.service.js',
    de: "return criarUsuario({ nome, email, senha, perfil: 'solicitante' }, { pendente });",
    para: "return criarUsuario({ nome, email, senha, perfil: 'solicitante' }, { pendente: false });",
    spec: 'tests/cadastroAprovacao.test.js',
  },
  {
    descricao: 'aprovação: aprovar vira porta dos fundos para reativar conta desligada',
    arquivo: 'src/services/usuarios.service.js',
    de: '      WHERE id = ANY($1::int[]) AND cadastro_pendente_desde IS NOT NULL\n      RETURNING id, nome, email`,',
    para: '      WHERE id = ANY($1::int[])\n      RETURNING id, nome, email`,',
    spec: 'tests/cadastroAprovacao.test.js',
  },
  {
    descricao: 'aprovação: recusar apaga conta que não é pedido',
    arquivo: 'src/services/usuarios.service.js',
    de: '      WHERE id = ANY($1::int[]) AND cadastro_pendente_desde IS NOT NULL\n      RETURNING id`,',
    para: '      WHERE id = ANY($1::int[])\n      RETURNING id`,',
    spec: 'tests/cadastroAprovacao.test.js',
  },
  {
    descricao: 'aprovação: pedido pendente aparece na lista comum de contas',
    arquivo: 'src/services/usuarios.service.js',
    de: "const condicoes = ['cadastro_pendente_desde IS NULL'];",
    para: 'const condicoes = [];',
    spec: 'tests/cadastroAprovacao.test.js',
  },
  {
    descricao: 'aprovação: a gestão passa a mudar a exigência',
    arquivo: 'src/routes/configuracao.routes.js',
    de: "router.patch('/', authorize('administrador'), configuracaoController.definir);",
    para: "router.patch('/', authorize('administrador', 'gestor'), configuracaoController.definir);",
    spec: 'tests/cadastroAprovacao.test.js',
  },
  {
    descricao: 'exigência de 2FA: gestão sem a verificação passa direto',
    arquivo: 'src/middlewares/auth.js',
    de: 'if (pendente2fa && !permitirSem2fa) {',
    para: 'if (false) {',
    spec: 'tests/exigencia2fa.test.js',
  },
  {
    descricao: 'exigência de 2FA: a rota de ligar a verificação fica fechada para quem precisa',
    arquivo: 'src/routes/auth.routes.js',
    de: "  '/2fa/ativar',\n  authenticateSem2fa,",
    para: "  '/2fa/ativar',\n  authenticate,",
    spec: 'tests/exigencia2fa.test.js',
  },
  {
    descricao: 'exigência de 2FA: administrador sem a própria liga a exigência',
    arquivo: 'src/services/configuracao.service.js',
    de: 'if (!rows[0]?.totp_ativado_em) {',
    para: 'if (false) {',
    spec: 'tests/exigencia2fa.test.js',
  },
  {
    descricao: 'exigência de 2FA: o login deixa de avisar a tela',
    arquivo: 'src/services/auth.service.js',
    de: 'dois_fatores_pendente: pendente }',
    para: 'dois_fatores_pendente: false }',
    spec: 'tests/exigencia2fa.test.js',
  },
  {
    descricao: 'google: credencial de outro sistema passa a valer aqui',
    arquivo: 'src/services/google.service.js',
    de: "{ algorithms: ['RS256'], audience: aud, issuer: EMISSORES }",
    para: "{ algorithms: ['RS256'], issuer: EMISSORES }",
    spec: 'tests/loginGoogle.test.js',
  },
  {
    descricao: 'google: e-mail que o Google só conferiu uma vez passa a abrir conta',
    arquivo: 'src/services/google.service.js',
    de: "dados.email_verified === true && (DOMINIOS_DO_GMAIL.includes(dominio) || organizacao !== null)",
    para: 'dados.email_verified === true',
    spec: 'tests/loginGoogle.test.js',
  },
  {
    descricao: 'google: o login pelo Google dispensa a verificação em duas etapas',
    arquivo: 'src/services/auth.service.js',
    de: "  if (usuario.totp_segredo) {\n    return { requer2fa: true, desafio: desafioDe(usuario) };\n  }\n  return { conta: usuario, usuario: await publico(usuario) };\n}\n\n/** Quem é o desafio",
    para: "  return { conta: usuario, usuario: await publico(usuario) };\n}\n\n/** Quem é o desafio",
    spec: 'tests/loginGoogle.test.js',
  },
  {
    descricao: 'google: conta nova entra sem passar pela aprovação',
    arquivo: 'src/services/auth.service.js',
    de: "  if (usuario.cadastro_pendente_desde) {\n    return { aguardandoAprovacao: true };\n  }",
    para: '',
    spec: 'tests/loginGoogle.test.js',
  },
  {
    descricao: 'google: cada chave inventada vira uma busca no Google',
    arquivo: 'src/services/google.service.js',
    de: '!cache.chaves[kid] && agora - cache.buscadaEm >= INTERVALO_MINIMO_MS',
    para: '!cache.chaves[kid]',
    spec: 'tests/loginGoogle.test.js',
  },
  {
    descricao: 'google: o domínio da instituição deixa de ser conferido',
    arquivo: 'src/services/google.service.js',
    de: 'if (exigido && organizacao !== exigido) {',
    para: 'if (false) {',
    spec: 'tests/loginGoogle.test.js',
  },
  {
    descricao: 'limpeza: e-mail digitado errado deixa de parar o script',
    arquivo: 'database/limpar-demonstracao.sql',
    de: "  IF faltando IS NOT NULL THEN\n    RAISE EXCEPTION 'Sem conta com este e-mail",
    para: "  IF false THEN\n    RAISE EXCEPTION 'Sem conta com este e-mail",
    spec: 'tests/limparDemonstracao.test.js',
  },
  {
    descricao: 'limpeza: lista vazia passa a valer como "só administradores"',
    arquivo: 'database/limpar-demonstracao.sql',
    de: "  IF lista = '' THEN",
    para: '  IF lista IS NULL THEN',
    spec: 'tests/limparDemonstracao.test.js',
  },
  {
    descricao: 'limpeza: preventiva aberta apagada some do calendário do plano',
    arquivo: 'database/limpar-demonstracao.sql',
    de: ' WHERE p.id = aberta.plano_id AND aberta.primeira < p.proxima_execucao;',
    para: ' WHERE false;',
    spec: 'tests/limparDemonstracao.test.js',
  },
  {
    descricao: 'limpeza: escrita de fora entra no meio da limpeza',
    arquivo: 'database/limpar-demonstracao.sql',
    de: '  IN EXCLUSIVE MODE;',
    para: '  IN ACCESS SHARE MODE;',
    spec: 'tests/limparDemonstracao.test.js',
  },
  {
    descricao: 'limpeza: a espera pela trava deixa de ter limite',
    arquivo: 'database/limpar-demonstracao.sql',
    de: "PERFORM set_config('lock_timeout',",
    para: "PERFORM set_config('application_name',",
    spec: 'tests/limparDemonstracao.test.js',
  },
  {
    descricao: 'limpeza: anexo no Storage deixa de parar o script',
    arquivo: 'database/limpar-demonstracao.sql',
    de: "IF EXISTS (SELECT 1 FROM anexo WHERE armazenamento <> 'banco') THEN",
    para: 'IF false THEN',
    spec: 'tests/limparDemonstracao.test.js',
  },
  {
    descricao: 'EPI: concluir sem a confirmação passa na API',
    arquivo: 'src/services/chamados.service.js',
    de: 'if (epi_confirmado !== true) {',
    para: 'if (false) {',
    spec: 'tests/epi.test.js',
  },
  {
    descricao: 'EPI: a confirmação é gravada em nome de outra pessoa que não quem marcou',
    arquivo: 'src/services/chamados.service.js',
    de: "params.push(usuario.id);\n      campos.push(`epi_confirmado_por",
    para: "params.push(chamado.tecnico_id);\n      campos.push(`epi_confirmado_por",
    spec: 'tests/epi.test.js',
  },
  {
    descricao: 'EPI: a confirmação não vai para a linha do tempo',
    arquivo: 'src/services/chamados.service.js',
    de: "[observacao?.trim(), 'Uso de EPI confirmado.']",
    para: '[observacao?.trim()]',
    spec: 'tests/epi.test.js',
  },
  {
    descricao: 'EPI: reabrir herda a confirmação do ciclo anterior',
    arquivo: 'src/services/chamados.service.js',
    de: '         epi_confirmado_em = NULL,\n         epi_confirmado_por = NULL,\n',
    para: '',
    spec: 'tests/epi.test.js',
  },
  {
    descricao: 'EPI: a rota deixa de validar o tipo da confirmação',
    arquivo: 'src/routes/chamados.routes.js',
    de: "epi_confirmado: { tipo: 'boolean' },",
    para: '',
    spec: 'tests/epi.test.js',
  },
  {
    descricao: 'EPI: o banco aceita concluir agora sem confirmação',
    arquivo: 'database/migrations/027_confirmacao_epi.sql',
    de: "OR COALESCE(data_conclusao < %L::timestamptz, false)",
    para: 'OR true',
    spec: 'tests/epi.test.js',
    migrar: true,
  },
  {
    descricao: 'EPI: o banco deixa passar conclusão sem data (o NULL do CHECK)',
    arquivo: 'database/migrations/027_confirmacao_epi.sql',
    de: "OR COALESCE(data_conclusao < %L::timestamptz, false)",
    para: 'OR (data_conclusao < %L::timestamptz)',
    spec: 'tests/epi.test.js',
    migrar: true,
  },
  {
    descricao: 'EPI: o banco deixa de aceitar o legado (corte sempre no passado)',
    arquivo: 'database/migrations/027_confirmacao_epi.sql',
    de: "OR COALESCE(data_conclusao < %L::timestamptz, false)",
    para: 'OR false',
    spec: 'tests/epi.test.js',
    migrar: true,
  },
  {
    descricao: 'EPI: autor e hora deixam de andar juntos',
    arquivo: 'database/migrations/027_confirmacao_epi.sql',
    de: 'CHECK ((epi_confirmado_em IS NULL) = (epi_confirmado_por IS NULL));',
    para: 'CHECK (true);',
    spec: 'tests/epi.test.js',
    migrar: true,
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

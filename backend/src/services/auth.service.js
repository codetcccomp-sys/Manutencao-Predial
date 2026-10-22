const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/db');
const { transacao } = require('../config/transacao');
const totp = require('../utils/totp');
const { AppError } = require('../middlewares/errorHandler');
const configuracaoService = require('./configuracao.service');
const googleService = require('./google.service');
const { PERFIS_DA_GESTAO } = require('../middlewares/auth');
const { validarSenhaNova } = require('../utils/senha');

const SALT_ROUNDS = 10;

// Hash descartável, de uma senha que ninguém usa, comparado quando o e-mail
// não existe. Sem isso, "usuário inexistente" responde na hora e "senha
// errada" leva o tempo do bcrypt: a diferença é mensurável de fora e permite
// descobrir quais e-mails têm conta antes de tentar qualquer senha.
const HASH_FICTICIO = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

// A caixa do e-mail não identifica ninguém: "Joao@empresa.com" e
// "joao@empresa.com" são a mesma pessoa. Sem normalizar, quem se cadastrou de
// um jeito não conseguia entrar digitando do outro, e o UNIQUE da coluna
// deixava as duas contas coexistirem. Aplicado em toda escrita e toda busca;
// o CHECK na tabela garante o mesmo para quem escrever por fora do código.
function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Tira o espaço sobrando do nome.
 *
 * O e-mail já era normalizado; o nome entrava cru. Um espaço no fim passa
 * despercebido no cadastro e reaparece em todo lugar depois: no cabeçalho, na
 * autoria do comentário, no histórico do chamado e no "Olá, Fulano ." dos
 * e-mails. Pior, dois cadastros de "João" e "João " ficam visualmente
 * idênticos na lista de usuários e são pessoas diferentes para o sistema.
 *
 * Também colapsa espaços internos: "Maria   Silva" vira "Maria Silva". Quem
 * digita dois espaços sem querer não quis dizer nada com isso.
 */
function normalizarNome(nome) {
  return String(nome ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Cria a conta. `silencioso`: e-mail que já existe não é erro, devolve `null`.
 *
 * O cadastro público usa o modo silencioso. Um 409 "já existe" respondia a quem quisesse, sem
 * login nenhum, se um e-mail tem conta, e uma lista de e-mails confirmados é o que se usa para
 * dirigir phishing e tentativa de senha. A administração (POST /usuarios) segue recebendo o 409:
 * é autenticada e precisa saber por que a conta não foi criada.
 */
async function criarUsuario({ nome, email, senha, perfil }, { pendente = false, silencioso = false } = {}) {
  const emailNormalizado = normalizarEmail(email);

  validarSenhaNova(senha, { email: emailNormalizado });

  // O hash vem ANTES de olhar se o e-mail existe, e é feito nos dois casos: o bcrypt é a parte
  // lenta, e pular dele para o e-mail repetido deixaria o tempo de resposta contar o que o corpo
  // da resposta esconde.
  const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);

  const emUso = () => new AppError('Já existe um usuário cadastrado com este e-mail.', 409, 'EMAIL_EM_USO');

  const existente = await pool.query('SELECT id FROM usuario WHERE email = $1', [emailNormalizado]);
  if (existente.rows.length > 0) {
    if (silencioso) return null;
    throw emUso();
  }

  // Pendente nasce inativa: tudo o que já recusa conta inativa (login,
  // recuperação de senha, listas, avisos) recusa a pendente sem precisar
  // saber que ela existe.
  try {
    const { rows } = await pool.query(
      `INSERT INTO usuario (nome, email, senha_hash, perfil, ativo, cadastro_pendente_desde)
       VALUES ($1, $2, $3, $4, NOT $5::boolean, CASE WHEN $5::boolean THEN now() END)
       RETURNING id, nome, email, perfil, ativo, criado_em, cadastro_pendente_desde`,
      [normalizarNome(nome), emailNormalizado, senhaHash, perfil, pendente]
    );
    return rows[0];
  } catch (err) {
    // Dois pedidos do mesmo e-mail ao mesmo tempo: o UNIQUE da coluna decide, e quem perde
    // recebe o mesmo desfecho de quem chegou depois.
    if (err.code === '23505' && err.constraint?.includes('email')) {
      if (silencioso) return null;
      throw emUso();
    }
    throw err;
  }
}

// Cadastro público: sempre cria perfil "solicitante". Perfis internos
// (tecnico, gestor, administrador) só podem ser criados por um administrador
// autenticado, via usuariosService.criarUsuario, para evitar escalonamento
// de privilégio por auto-cadastro.
//
// Com a aprovação ligada (RF01: "autocadastro sob aprovação"), a conta nasce
// esperando a gestão e não entra até ser aprovada.
//
// A resposta não diz se o e-mail era novo: devolve só se a conta, quando existe, espera a
// gestão (uma configuração do sistema, igual para todo mundo).
async function registrar({ nome, email, senha }) {
  const pendente = await configuracaoService.cadastroExigeAprovacao();
  await criarUsuario({ nome, email, senha, perfil: 'solicitante' }, { pendente, silencioso: true });
  return { aguardando_aprovacao: pendente };
}

/**
 * O que a tela recebe de quem entrou. `dois_fatores_pendente` avisa que a
 * administração exige a verificação em duas etapas deste perfil e ela ainda
 * não está ligada: a tela leva direto para Minha conta, em vez de deixar a
 * pessoa bater em recusa a cada clique (middlewares/auth.js).
 */
async function publico(u, { tem2fa = false } = {}) {
  const pendente = !tem2fa && PERFIS_DA_GESTAO.includes(u.perfil) && (await configuracaoService.exige2faGestao());
  return { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, dois_fatores_pendente: pendente };
}

// O desafio do segundo fator vale poucos minutos: é o tempo de abrir o
// aplicativo e digitar. Quem o intercepta sem a senha não tem o que fazer com
// ele, e com a senha ainda precisa do código.
const VALIDADE_DESAFIO = '5m';

/**
 * Primeira etapa: e-mail e senha.
 *
 * Sem segundo fator, devolve a conta para quem chama emitir a sessão. Com
 * ele, devolve só um desafio assinado — a senha certa ainda não abre nada.
 */
async function login({ email, senha }) {
  const { rows } = await pool.query(
    `SELECT id, nome, email, senha_hash, perfil, ativo, sessao_versao, totp_segredo, cadastro_pendente_desde
       FROM usuario WHERE email = $1`,
    [normalizarEmail(email)]
  );
  const usuario = rows[0];

  // Cadastro esperando a gestão: quem acertou a senha merece saber por que não
  // entra — senão tenta de novo, pede outra senha, cadastra outra conta. Só
  // depois da senha certa, para a resposta não virar um "este e-mail pediu
  // cadastro?" aberto a qualquer um.
  if (usuario?.cadastro_pendente_desde) {
    if (await bcrypt.compare(senha, usuario.senha_hash)) {
      throw new AppError(
        'Seu cadastro ainda aguarda a aprovação da gestão. Você poderá entrar assim que ele for aprovado.',
        403,
        'CADASTRO_PENDENTE'
      );
    }
    throw new AppError('E-mail ou senha inválidos.', 401, 'CREDENCIAIS_INVALIDAS');
  }

  if (!usuario || !usuario.ativo) {
    await bcrypt.compare(senha, HASH_FICTICIO);
    throw new AppError('E-mail ou senha inválidos.', 401, 'CREDENCIAIS_INVALIDAS');
  }

  const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
  if (!senhaValida) {
    throw new AppError('E-mail ou senha inválidos.', 401, 'CREDENCIAIS_INVALIDAS');
  }

  if (usuario.totp_segredo) {
    return { requer2fa: true, desafio: desafioDe(usuario), email: usuario.email };
  }

  return { conta: usuario, usuario: await publico(usuario) };
}

const desafioDe = (usuario) =>
  jwt.sign({ id: usuario.id, tipo: '2fa' }, process.env.JWT_SECRET, { expiresIn: VALIDADE_DESAFIO });

/**
 * Entrar com Google: a credencial do botão substitui o e-mail e a senha, e o
 * resto é o mesmo caminho do login.
 *
 * - Conta que já existe com o e-mail: entra nela. Com a verificação em duas
 *   etapas ligada, o Google não a dispensa: devolve o desafio, como a senha.
 * - Conta nova: nasce solicitante, e espera a gestão se a aprovação estiver
 *   ligada (RF01) — o Google prova quem é a pessoa, não que ela pode entrar.
 *   A senha é aleatória e ninguém a conhece; quem quiser entrar também por
 *   e-mail e senha usa "Esqueci minha senha".
 *
 * Aqui o Google já provou a identidade, então dizer "conta desativada" ou
 * "aguardando aprovação" não conta nada a quem não é a pessoa.
 */
async function entrarComGoogle({ credencial }) {
  const { email, nome } = await googleService.conferir(credencial);

  const buscar = () =>
    pool.query(
      `SELECT id, nome, email, perfil, ativo, anonimizado_em, sessao_versao, totp_segredo, cadastro_pendente_desde
         FROM usuario WHERE email = $1`,
      [email]
    );

  let usuario = (await buscar()).rows[0];
  if (!usuario) {
    const pendente = await configuracaoService.cadastroExigeAprovacao();
    const senha = crypto.randomBytes(32).toString('base64url');
    try {
      await criarUsuario({ nome, email, senha, perfil: 'solicitante' }, { pendente });
    } catch (err) {
      // Dois cliques no botão chegam juntos: o segundo encontra a conta que o
      // primeiro acabou de criar (na conferência, ou no índice único se os
      // dois passaram dela ao mesmo tempo), e segue com ela.
      if (err.code !== 'EMAIL_EM_USO' && err.code !== '23505') throw err;
    }
    usuario = (await buscar()).rows[0];
  }

  if (usuario.cadastro_pendente_desde) {
    return { aguardandoAprovacao: true };
  }
  if (!usuario.ativo || usuario.anonimizado_em) {
    throw new AppError('Esta conta está desativada. Fale com a gestão.', 403, 'CONTA_DESATIVADA');
  }
  if (usuario.totp_segredo) {
    return { requer2fa: true, desafio: desafioDe(usuario), email: usuario.email };
  }
  return { conta: usuario, usuario: await publico(usuario) };
}

/** Quem é o desafio (para o limitador), sem aceitar nada além dele. */
function lerDesafio(desafio) {
  let payload;
  try {
    payload = jwt.verify(String(desafio || ''), process.env.JWT_SECRET);
  } catch {
    throw new AppError('A verificação expirou. Entre de novo com e-mail e senha.', 401, 'DESAFIO_INVALIDO');
  }
  if (payload.tipo !== '2fa') {
    throw new AppError('A verificação expirou. Entre de novo com e-mail e senha.', 401, 'DESAFIO_INVALIDO');
  }
  return payload;
}

async function emailDoDesafio(desafio) {
  const { id } = lerDesafio(desafio);
  const { rows } = await pool.query('SELECT email FROM usuario WHERE id = $1', [id]);
  return rows[0]?.email;
}

const hashDoCodigo = (codigo) =>
  crypto.createHash('sha256').update(String(codigo).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

/**
 * Confere um código do segundo fator: o do aplicativo ou um de recuperação.
 *
 * O do aplicativo não vale duas vezes: o passo de 30 s aceito fica gravado, e
 * só um passo posterior passa. Quem viu o código por cima do ombro, ou o
 * capturou no caminho, chega atrasado. O de recuperação é de uso único.
 * As duas marcações são o próprio UPDATE, para duas tentativas simultâneas
 * com o mesmo código não passarem juntas.
 */
async function conferirSegundoFator(client, usuario, codigo) {
  const passo = totp.verificar(usuario.totp_segredo, codigo);
  if (passo !== null) {
    const { rowCount } = await client.query(
      `UPDATE usuario SET totp_ultimo_passo = $2
        WHERE id = $1 AND (totp_ultimo_passo IS NULL OR totp_ultimo_passo < $2)`,
      [usuario.id, passo]
    );
    return rowCount > 0 ? 'aplicativo' : null;
  }

  const { rowCount } = await client.query(
    `UPDATE codigo_recuperacao_2fa SET usado_em = now()
      WHERE usuario_id = $1 AND codigo_hash = $2 AND usado_em IS NULL`,
    [usuario.id, hashDoCodigo(codigo)]
  );
  return rowCount > 0 ? 'recuperacao' : null;
}

/** Segunda etapa: o desafio da primeira e o código. */
async function segundoFator({ desafio, codigo }) {
  const { id } = lerDesafio(desafio);
  const { rows } = await pool.query(
    `SELECT id, nome, email, perfil, ativo, anonimizado_em, sessao_versao, totp_segredo, totp_ultimo_passo
       FROM usuario WHERE id = $1`,
    [id]
  );
  const usuario = rows[0];
  if (!usuario || !usuario.ativo || usuario.anonimizado_em || !usuario.totp_segredo) {
    throw new AppError('A verificação expirou. Entre de novo com e-mail e senha.', 401, 'DESAFIO_INVALIDO');
  }

  const meio = await conferirSegundoFator(pool, usuario, codigo);
  if (!meio) {
    throw new AppError('Código inválido ou já usado.', 401, 'CODIGO_INVALIDO');
  }

  return { conta: usuario, usuario: await publico(usuario, { tem2fa: true }), meio };
}

// ---------------------------------------------------------------------------
// Cadastro e retirada do segundo fator
// ---------------------------------------------------------------------------

const EMISSOR = 'Conserva Predial';
const QUANTIDADE_CODIGOS = 8;

function novoCodigoDeRecuperacao() {
  // 10 caracteres de base32 (50 bits), em dois blocos para ler e digitar.
  const bruto = totp.base32(crypto.randomBytes(7)).slice(0, 10);
  return `${bruto.slice(0, 5)}-${bruto.slice(5)}`;
}

async function situacao2fa(usuarioId) {
  const { rows } = await pool.query(
    `SELECT totp_ativado_em,
            (SELECT count(*)::int FROM codigo_recuperacao_2fa c
              WHERE c.usuario_id = u.id AND c.usado_em IS NULL) AS codigos_restantes
       FROM usuario u WHERE id = $1`,
    [usuarioId]
  );
  return {
    ativo: Boolean(rows[0]?.totp_ativado_em),
    ativado_em: rows[0]?.totp_ativado_em ?? null,
    codigos_restantes: rows[0]?.codigos_restantes ?? 0,
  };
}

async function iniciar2fa(usuario) {
  const atual = await situacao2fa(usuario.id);
  if (atual.ativo) {
    throw new AppError('A verificação em duas etapas já está ligada.', 409, 'JA_ATIVO');
  }
  const segredo = totp.gerarSegredo();
  await pool.query('UPDATE usuario SET totp_pendente = $2 WHERE id = $1', [usuario.id, segredo]);
  return { segredo, endereco: totp.enderecoOtpauth(segredo, usuario.email, EMISSOR) };
}

async function gravarCodigos(client, usuarioId) {
  await client.query('DELETE FROM codigo_recuperacao_2fa WHERE usuario_id = $1', [usuarioId]);
  const codigos = Array.from({ length: QUANTIDADE_CODIGOS }, novoCodigoDeRecuperacao);
  for (const codigo of codigos) {
    await client.query('INSERT INTO codigo_recuperacao_2fa (usuario_id, codigo_hash) VALUES ($1, $2)', [
      usuarioId,
      hashDoCodigo(codigo),
    ]);
  }
  return codigos;
}

/**
 * Liga o segundo fator — só depois de a pessoa provar que o aplicativo dela
 * gera o código certo. Ligar sem a prova trancaria para fora quem leu o QR
 * com o aplicativo errado, ou não leu.
 *
 * Ligar derruba as outras sessões: se alguém já estava dentro com a senha
 * roubada, é agora que deve sair.
 *
 * E pede a senha. Só a sessão não basta: com ela, quem pegou um computador
 * destravado — ou um script injetado na página — cadastraria o próprio
 * aplicativo e trancaria a dona da conta do lado de fora.
 */
async function ativar2fa(usuarioId, { senha, codigo }) {
  return transacao(async (client) => {
    const { rows } = await client.query(
      'SELECT id, senha_hash, totp_pendente, totp_ativado_em FROM usuario WHERE id = $1 FOR UPDATE',
      [usuarioId]
    );
    const conta = rows[0];
    if (!(await bcrypt.compare(String(senha ?? ''), conta.senha_hash))) {
      throw new AppError('Senha incorreta.', 422, 'SENHA_INCORRETA');
    }
    if (conta.totp_ativado_em) {
      throw new AppError('A verificação em duas etapas já está ligada.', 409, 'JA_ATIVO');
    }
    if (!conta.totp_pendente) {
      throw new AppError('Comece pelo QR Code: o cadastro não foi iniciado.', 409, 'NAO_INICIADO');
    }
    const passo = totp.verificar(conta.totp_pendente, codigo);
    if (passo === null) {
      throw new AppError('O código não confere. Confira o relógio do celular e tente o código seguinte.', 422, 'CODIGO_INVALIDO');
    }

    const { rows: atualizada } = await client.query(
      `UPDATE usuario SET totp_segredo = totp_pendente, totp_pendente = NULL, totp_ativado_em = now(),
                          totp_ultimo_passo = $2, sessao_versao = sessao_versao + 1
        WHERE id = $1
        RETURNING id, nome, email, perfil, sessao_versao`,
      [usuarioId, passo]
    );
    const codigos = await gravarCodigos(client, usuarioId);
    return { conta: atualizada[0], codigos };
  });
}

/**
 * Desliga — com a senha E um código. Só a sessão aberta não basta: quem
 * pegou um computador destravado não pode tirar a proteção da conta.
 */
async function desativar2fa(usuarioId, { senha, codigo }) {
  const { rows } = await pool.query(
    'SELECT id, perfil, senha_hash, totp_segredo, totp_ultimo_passo FROM usuario WHERE id = $1',
    [usuarioId]
  );
  const conta = rows[0];
  if (!conta.totp_segredo) {
    throw new AppError('A verificação em duas etapas não está ligada.', 409, 'NAO_ATIVO');
  }
  // Exigida do perfil, desligar só trocaria a conta protegida por uma conta
  // restrita a Minha conta. Quem perdeu o celular pede ao administrador para
  // redefinir, e liga de novo.
  if (PERFIS_DA_GESTAO.includes(conta.perfil) && (await configuracaoService.exige2faGestao())) {
    throw new AppError(
      'A administração exige a verificação em duas etapas para o seu perfil: ela não pode ser desligada.',
      409,
      'DOIS_FATORES_EXIGIDO'
    );
  }
  if (!(await bcrypt.compare(String(senha ?? ''), conta.senha_hash))) {
    throw new AppError('Senha incorreta.', 422, 'SENHA_INCORRETA');
  }

  return transacao(async (client) => {
    if (!(await conferirSegundoFator(client, conta, codigo))) {
      throw new AppError('Código inválido ou já usado.', 422, 'CODIGO_INVALIDO');
    }
    await client.query('DELETE FROM codigo_recuperacao_2fa WHERE usuario_id = $1', [usuarioId]);
    const { rows: atualizada } = await client.query(
      `UPDATE usuario SET totp_segredo = NULL, totp_pendente = NULL, totp_ativado_em = NULL,
                          totp_ultimo_passo = NULL, sessao_versao = sessao_versao + 1
        WHERE id = $1
        RETURNING id, nome, email, perfil, sessao_versao`,
      [usuarioId]
    );
    return atualizada[0];
  });
}

/** Novos códigos de recuperação (os antigos deixam de valer), com um código do aplicativo. */
async function novosCodigos(usuarioId, codigo) {
  const { rows } = await pool.query(
    'SELECT id, totp_segredo, totp_ultimo_passo FROM usuario WHERE id = $1',
    [usuarioId]
  );
  const conta = rows[0];
  if (!conta.totp_segredo) {
    throw new AppError('A verificação em duas etapas não está ligada.', 409, 'NAO_ATIVO');
  }
  return transacao(async (client) => {
    if ((await conferirSegundoFator(client, conta, codigo)) !== 'aplicativo') {
      throw new AppError('Use um código do aplicativo para gerar códigos novos.', 422, 'CODIGO_INVALIDO');
    }
    return gravarCodigos(client, usuarioId);
  });
}

/**
 * O administrador tira o segundo fator de alguém que perdeu o celular e os
 * códigos. Derruba as sessões da pessoa junto: quem pediu isso talvez não
 * tenha sido ela.
 */
async function redefinir2fa(usuarioId) {
  return transacao(async (client) => {
    await client.query('DELETE FROM codigo_recuperacao_2fa WHERE usuario_id = $1', [usuarioId]);
    const { rows } = await client.query(
      `UPDATE usuario SET totp_segredo = NULL, totp_pendente = NULL, totp_ativado_em = NULL,
                          totp_ultimo_passo = NULL, sessao_versao = sessao_versao + 1
        WHERE id = $1 RETURNING id`,
      [usuarioId]
    );
    if (!rows[0]) throw new AppError('Usuário não encontrado.', 404, 'USUARIO_NAO_ENCONTRADO');
  });
}

module.exports = {
  registrar,
  login,
  entrarComGoogle,
  segundoFator,
  emailDoDesafio,
  situacao2fa,
  iniciar2fa,
  ativar2fa,
  desativar2fa,
  novosCodigos,
  redefinir2fa,
  criarUsuario,
  normalizarEmail,
  normalizarNome,
};

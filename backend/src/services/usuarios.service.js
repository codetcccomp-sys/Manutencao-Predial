const pool = require('../config/db');
const { transacao } = require('../config/transacao');
const { AppError } = require('../middlewares/errorHandler');
const { normalizarNome } = require('./auth.service');

const CAMPOS = 'id, nome, email, perfil, ativo, criado_em, anonimizado_em';

/**
 * Por padrão lista só quem está ativo.
 *
 * O select de técnicos da tela de chamado consome esta rota: incluir
 * desligados ali permitiria atribuir um chamado a quem não atende mais. Quem
 * precisa ver a lista inteira — a tela de administração — pede explicitamente.
 */
async function listar({ perfil, incluirInativos } = {}) {
  const condicoes = [];
  const params = [];

  if (perfil) {
    params.push(perfil);
    condicoes.push(`perfil = $${params.length}`);
  }
  if (!incluirInativos) {
    condicoes.push('ativo = TRUE');
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT ${CAMPOS} FROM usuario ${where} ORDER BY ativo DESC, nome`,
    params
  );
  return rows;
}

async function buscarPorId(id) {
  const { rows } = await pool.query(`SELECT ${CAMPOS} FROM usuario WHERE id = $1`, [id]);
  if (!rows[0]) {
    throw new AppError('Usuário não encontrado.', 404, 'USUARIO_NAO_ENCONTRADO');
  }
  return rows[0];
}

async function contarAdministradoresAtivos(exceto) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS total FROM usuario WHERE perfil = $1 AND ativo = TRUE AND id <> $2',
    ['administrador', exceto]
  );
  return rows[0].total;
}

/**
 * Técnico com chamado em aberto não sai da fila sem passar o trabalho adiante.
 *
 * Vale para tudo que o tira do trabalho: desativar, mudar de perfil e
 * anonimizar. A conta que saiu não entra mais, e o chamado continuaria
 * designado a ela: fora do filtro "sem técnico" (que procura `tecnico_id`
 * nulo) e fora da fila de qualquer pessoa. Pararia calado até estourar o
 * prazo.
 *
 * Recusar em vez de soltar os chamados automaticamente é deliberado: a
 * reatribuição tem justificativa e histórico (RF05, RN05), e decidir para
 * quem vai cada chamado é trabalho da gestão, não um efeito colateral.
 *
 * `acao` completa a frase "Reatribua antes de ...".
 */
async function garantirSemChamadosEmAberto(id, acao) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total FROM chamado
      WHERE tecnico_id = $1 AND estado NOT IN ('concluido', 'cancelado')`,
    [id]
  );
  const n = rows[0].total;
  if (n > 0) {
    throw new AppError(
      `Esta pessoa tem ${n} ${n === 1 ? 'chamado' : 'chamados'} em aberto. ` +
        `Reatribua antes de ${acao}, para nenhum ficar parado sem responsável.`,
      422,
      'CHAMADOS_EM_ABERTO'
    );
  }
}

/**
 * Altera nome, perfil ou situação de um usuário.
 *
 * Duas travas, ambas contra o mesmo acidente — ficar sem quem administre:
 * ninguém rebaixa ou desativa a própria conta, e o último administrador ativo
 * não pode ser removido por outro. Sem elas, recuperar o sistema exigiria
 * acesso direto ao banco, que é justamente o que esta tela existe para evitar.
 */
async function atualizar(id, { nome, perfil, ativo }, autor) {
  const alvo = await buscarPorId(id);
  const ehAPropriaConta = alvo.id === autor.id;

  if (ehAPropriaConta && ativo === false) {
    throw new AppError('Você não pode desativar a própria conta.', 422, 'AUTO_DESATIVACAO');
  }
  if (ehAPropriaConta && perfil !== undefined && perfil !== alvo.perfil) {
    throw new AppError('Você não pode alterar o próprio perfil.', 422, 'AUTO_REBAIXAMENTO');
  }

  // Conta anonimizada não volta. Reativar devolveria acesso a uma conta cujo
  // dono pediu para sair, e cujo nome e e-mail já não existem: quem entrasse
  // ali estaria numa conta sem identidade, assinando chamados como "Usuário
  // removido". O `ativo = false` da anonimização não é uma desativação comum
  // e o botão "Reativar" da tela não pode tratá-lo como tal.
  if (alvo.anonimizado_em) {
    throw new AppError(
      'Esta conta foi anonimizada a pedido e não pode ser alterada.',
      422,
      'CONTA_ANONIMIZADA'
    );
  }

  const deixaDeAdministrar =
    alvo.perfil === 'administrador' &&
    ((perfil !== undefined && perfil !== 'administrador') || ativo === false);

  if (deixaDeAdministrar && (await contarAdministradoresAtivos(alvo.id)) === 0) {
    throw new AppError(
      'Este é o último administrador ativo. Promova outro antes de alterá-lo.',
      422,
      'ULTIMO_ADMINISTRADOR'
    );
  }

  // Reativar e renomear não tiram ninguém da fila; desativar e trocar de
  // perfil tiram. Sem `perfil` no corpo, ou com o mesmo, nada muda de lado.
  if (ativo === false) {
    await garantirSemChamadosEmAberto(alvo.id, 'desativar');
  } else if (perfil !== undefined && perfil !== 'tecnico') {
    await garantirSemChamadosEmAberto(alvo.id, 'mudar o perfil');
  }

  const campos = [];
  const params = [];

  for (const [coluna, valor] of [
    // `null` é tratado como ausente, e não como "apague o nome". O validador
    // já faz isso (pula null antes de medir minLength), mas o serviço não
    // fazia: `normalizarNome(null)` devolve '', que passava pela checagem de
    // `undefined` e ia parar no UPDATE. Antes disso, o NOT NULL da tabela
    // barrava; depois da normalização, o nome era apagado em silêncio.
    ['nome', nome === undefined || nome === null ? undefined : normalizarNome(nome)],
    ['perfil', perfil],
    ['ativo', ativo],
  ]) {
    if (valor === undefined) continue;
    params.push(valor);
    campos.push(coluna === 'perfil' ? `perfil = $${params.length}::perfil_usuario` : `${coluna} = $${params.length}`);
  }

  if (campos.length === 0) {
    throw new AppError('Informe ao menos um campo para atualizar.', 422, 'NADA_A_ATUALIZAR');
  }

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE usuario SET ${campos.join(', ')} WHERE id = $${params.length} RETURNING ${CAMPOS}`,
    params
  );

  return rows[0];
}

/**
 * Atende pedido de remoção anonimizando a pessoa (LGPD, docs/lgpd.md §5).
 *
 * Não apaga a linha, e a diferença é o ponto inteiro: `usuario.id` é
 * referenciado por chamado, comentário, avaliação, anexo, notificação,
 * histórico e equipe. Apagar arrastaria o registro da manutenção junto —
 * o prédio perderia a memória do que foi consertado por causa de um pedido
 * sobre dado pessoal. Some quem era, fica o que foi feito.
 *
 * É irreversível: nada guarda o nome ou o e-mail originais. Por isso as
 * mesmas travas do `atualizar`, e uma a mais — quem já foi anonimizado não
 * volta a ser anonimizado, porque a segunda passagem não teria o que apagar
 * e só serviria para mover a data e fingir um pedido novo.
 */
async function anonimizar(id, autor) {
  const alvo = await buscarPorId(id);

  if (alvo.id === autor.id) {
    // Quem anonimiza a si mesmo perde o acesso no mesmo instante, e a conta
    // não volta. Se for de fato o pedido da pessoa, outro administrador
    // executa — assim existe um segundo par de olhos numa ação sem desfazer.
    throw new AppError(
      'Você não pode anonimizar a própria conta. Peça a outro administrador.',
      422,
      'AUTO_ANONIMIZACAO'
    );
  }

  if (alvo.perfil === 'administrador' && (await contarAdministradoresAtivos(alvo.id)) === 0) {
    throw new AppError(
      'Este é o último administrador ativo. Promova outro antes de anonimizá-lo.',
      422,
      'ULTIMO_ADMINISTRADOR'
    );
  }

  await garantirSemChamadosEmAberto(id, 'anonimizar');

  return transacao(async (client) => {
    // A anonimização vem PRIMEIRO na transação, e só acontece se a conta
    // ainda não tiver sido anonimizada. A checagem antes, fora da transação,
    // deixava duas requisições simultâneas passarem juntas — um clique duplo
    // bastava —, e a segunda sobrescrevia `anonimizado_em`: a data que prova
    // quando o pedido foi atendido passava a ser a do segundo clique.
    const { rows } = await client.query(
      `UPDATE usuario
          SET nome           = 'Usuário removido',
              -- Endereço-lápide em .invalid, domínio que a RFC 2606 reserva
              -- para nunca existir. Um domínio inventado qualquer devolveria
              -- cada aviso do sistema na caixa do remetente — foi o que as 27
              -- devoluções de @exemplo.demo ensinaram.
              email          = 'removido-' || id || '@anonimizado.invalid',
              -- Não é hash de senha nenhuma: bcrypt nunca produz este valor,
              -- então nenhuma senha digitada casa com ele. Deixar o hash
              -- antigo manteria a senha da pessoa guardada depois de ela
              -- pedir para sair.
              senha_hash     = 'conta-anonimizada-sem-acesso',
              ativo          = FALSE,
              anonimizado_em = now()
        WHERE id = $1 AND anonimizado_em IS NULL
        RETURNING ${CAMPOS}`,
      [id]
    );

    if (!rows[0]) {
      throw new AppError('Esta conta já foi anonimizada.', 422, 'JA_ANONIMIZADO');
    }

    // Some o que só existe por causa da pessoa. O pedido de recuperação é o
    // que mais importa aqui: é a tabela que guarda IP.
    await client.query('DELETE FROM notificacao WHERE usuario_id = $1', [id]);
    await client.query('DELETE FROM recuperacao_senha WHERE usuario_id = $1', [id]);
    await client.query('DELETE FROM tentativa_login WHERE email = $1', [alvo.email]);

    return rows[0];
  });
}

module.exports = { listar, buscarPorId, atualizar, anonimizar };

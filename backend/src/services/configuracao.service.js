const pool = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Configurações que a administração muda pela tela.
 *
 * Cada chave declara o tipo do valor e o padrão. Chave fora desta lista não é
 * lida nem gravada: o banco aceitaria qualquer JSON, e uma opção com nome
 * digitado errado viraria uma configuração que ninguém consulta.
 */
const CHAVES = {
  cadastro_exige_aprovacao: { tipo: 'boolean', padrao: false },
  // Gestão e administração sem a verificação em duas etapas ficam restritas à
  // própria conta até ligá-la (middlewares/auth.js).
  exigir_2fa_gestao: { tipo: 'boolean', padrao: false },
};

async function ler(chave, client = pool) {
  const definicao = CHAVES[chave];
  const { rows } = await client.query('SELECT valor FROM configuracao WHERE chave = $1', [chave]);
  return rows[0] ? rows[0].valor : definicao.padrao;
}

async function listar(client = pool) {
  const { rows } = await client.query('SELECT chave, valor FROM configuracao');
  const salvas = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
  return Object.fromEntries(
    Object.entries(CHAVES).map(([chave, { padrao }]) => [chave, chave in salvas ? salvas[chave] : padrao])
  );
}

async function definir(valores, autor, client = pool) {
  const entradas = Object.entries(valores ?? {});
  if (entradas.length === 0) {
    throw new AppError('Informe ao menos uma configuração.', 422, 'NADA_A_ATUALIZAR');
  }
  for (const [chave, valor] of entradas) {
    const definicao = CHAVES[chave];
    if (!definicao) {
      throw new AppError(`Configuração desconhecida: "${chave}".`, 422, 'CONFIGURACAO_DESCONHECIDA');
    }
    if (typeof valor !== definicao.tipo) {
      throw new AppError(`"${chave}" deve ser verdadeiro ou falso.`, 422, 'VALIDACAO');
    }
  }

  // Quem exige dos outros precisa ter ligado a própria: sem isso, o próprio
  // administrador cairia na tela de ativação no clique seguinte.
  if (valores.exigir_2fa_gestao === true) {
    const { rows } = await client.query('SELECT totp_ativado_em FROM usuario WHERE id = $1', [autor.id]);
    if (!rows[0]?.totp_ativado_em) {
      throw new AppError(
        'Ligue a sua verificação em duas etapas em Minha conta antes de exigir da gestão.',
        409,
        'SEM_2FA_PROPRIO'
      );
    }
  }

  for (const [chave, valor] of entradas) {
    await client.query(
      `INSERT INTO configuracao (chave, valor, atualizado_por)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (chave) DO UPDATE
         SET valor = EXCLUDED.valor, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
      [chave, JSON.stringify(valor), autor.id]
    );
  }
  return listar(client);
}

const cadastroExigeAprovacao = (client) => ler('cadastro_exige_aprovacao', client);
const exige2faGestao = (client) => ler('exigir_2fa_gestao', client);

module.exports = { listar, definir, cadastroExigeAprovacao, exige2faGestao, CHAVES };

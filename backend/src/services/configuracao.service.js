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
};

async function ler(chave, client = pool) {
  const definicao = CHAVES[chave];
  const { rows } = await client.query('SELECT valor FROM configuracao WHERE chave = $1', [chave]);
  return rows[0] ? rows[0].valor : definicao.padrao;
}

async function listar() {
  const { rows } = await pool.query('SELECT chave, valor FROM configuracao');
  const salvas = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
  return Object.fromEntries(
    Object.entries(CHAVES).map(([chave, { padrao }]) => [chave, chave in salvas ? salvas[chave] : padrao])
  );
}

async function definir(valores, autor) {
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

  for (const [chave, valor] of entradas) {
    await pool.query(
      `INSERT INTO configuracao (chave, valor, atualizado_por)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (chave) DO UPDATE
         SET valor = EXCLUDED.valor, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
      [chave, JSON.stringify(valor), autor.id]
    );
  }
  return listar();
}

const cadastroExigeAprovacao = (client) => ler('cadastro_exige_aprovacao', client);

module.exports = { listar, definir, cadastroExigeAprovacao, CHAVES };

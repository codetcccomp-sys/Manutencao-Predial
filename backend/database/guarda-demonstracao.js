#!/usr/bin/env node
/**
 * Trava do banco da demonstração publicada.
 *
 * A demonstração tem API, site e banco próprios (docs/demonstracao-publicada.md),
 * e o semeador cria contas e chamados pela API. O desastre que esta trava
 * impede é o semeador escrever no banco de PRODUÇÃO: bastaria colar a URL
 * errada em um painel. Uma variável de ambiente dizendo "isto é demonstração"
 * não impede nada disso — ela diria "demo" com a URL de produção ao lado —,
 * então a decisão é tomada olhando o BANCO:
 *
 *  1. Recusa se o endereço de conexão contém a referência do projeto de
 *     produção. Roda antes de qualquer conexão, e é a primeira linha de defesa.
 *  2. O banco só é "de demonstração" se carrega a marca `ambiente_demonstracao`
 *     na tabela `configuracao`. Quem escreve a marca é ESTE script, e só num
 *     banco provadamente vazio (nenhum chamado, nenhuma conta): nunca o
 *     semeador, senão a marca valeria por si e a trava seria circular.
 *  3. Banco com chamado ou conta e sem a marca é recusado, mesmo com a URL
 *     diferente da de produção: não se sabe de quem é.
 *
 * A API confere a mesma marca em /health/db (`demonstracao`) antes de o
 * semeador escrever por ela, o que pega o caso oposto: a trava aprovou o banco
 * da variável do GitHub, mas a API da demonstração aponta para outro.
 *
 * Uso (o banco vem de DATABASE_URL ou DB_*, como no resto do backend):
 *   node database/guarda-demonstracao.js             só confere; banco novo, ainda
 *                                                    sem tabelas, passa
 *   node database/guarda-demonstracao.js --marcar    depois do migrate: grava a
 *                                                    marca num banco vazio
 * Sai com 0 se pode seguir e com 1 se recusou.
 */
require('dotenv').config();

// A referência do projeto Supabase da produção. É um identificador, não uma
// credencial: aparece em toda URL do projeto, inclusive nas públicas.
const PROJETO_DE_PRODUCAO = 'cwchhmstcyqxizwwusxn';
const CHAVE = 'ambiente_demonstracao';

/**
 * Decide o que fazer. Pura de propósito, para o teste cobrir todas as
 * combinações sem banco.
 *
 * @param {string} endereco  tudo que identifica o servidor de banco (URL, host, usuário)
 * @param {null|{chamados:number, usuarios:number, temConfiguracao:boolean, marcado:boolean}} banco
 *        null quando o banco ainda não tem as tabelas do sistema
 * @param {boolean} marcar   se quem chamou quer a marca gravada
 * @returns {{ok:boolean, marcar?:boolean, motivo:string}}
 */
function avaliar({ endereco, banco, marcar }) {
  if (String(endereco).toLowerCase().includes(PROJETO_DE_PRODUCAO)) {
    return { ok: false, motivo: 'o endereço do banco é o da PRODUÇÃO. Esta trava nunca libera esse banco.' };
  }

  if (banco === null) {
    if (marcar) {
      return { ok: false, motivo: 'o banco ainda não tem as tabelas do sistema. Rode o migrate antes de marcar.' };
    }
    return { ok: true, marcar: false, motivo: 'banco novo, sem tabelas: pode migrar.' };
  }

  if (banco.marcado) {
    return { ok: true, marcar: false, motivo: 'banco já marcado como de demonstração.' };
  }

  if (banco.chamados > 0 || banco.usuarios > 0) {
    return {
      ok: false,
      motivo:
        `o banco tem ${banco.usuarios} conta(s) e ${banco.chamados} chamado(s) e não está marcado como de ` +
        'demonstração: não se sabe de quem é. Use um banco vazio.',
    };
  }

  if (!marcar) {
    return { ok: true, marcar: false, motivo: 'banco vazio e ainda sem a marca.' };
  }
  if (!banco.temConfiguracao) {
    return { ok: false, motivo: 'falta a tabela configuracao: rode o migrate antes de marcar.' };
  }
  return { ok: true, marcar: true, motivo: 'banco vazio: marcado como de demonstração.' };
}

async function examinar(client) {
  const { rows } = await client.query(
    `SELECT to_regclass('public.chamado') IS NOT NULL AS tem_chamado,
            to_regclass('public.usuario') IS NOT NULL AS tem_usuario,
            to_regclass('public.configuracao') IS NOT NULL AS tem_configuracao`
  );
  const { tem_chamado: temChamado, tem_usuario: temUsuario, tem_configuracao: temConfiguracao } = rows[0];
  if (!temChamado && !temUsuario && !temConfiguracao) return null;

  const contar = async (tabela, existe) =>
    existe ? Number((await client.query(`SELECT count(*) AS n FROM ${tabela}`)).rows[0].n) : 0;
  const marcado = temConfiguracao
    ? (await client.query(`SELECT valor = 'true'::jsonb AS marcado FROM configuracao WHERE chave = $1`, [CHAVE]))
        .rows[0]?.marcado === true
    : false;

  return {
    chamados: await contar('chamado', temChamado),
    usuarios: await contar('usuario', temUsuario),
    temConfiguracao,
    marcado,
  };
}

function enderecoDoBanco() {
  return [process.env.DATABASE_URL, process.env.DB_HOST, process.env.DB_USER, process.env.DB_NAME]
    .filter(Boolean)
    .join(' ');
}

async function executar({ marcar }) {
  const endereco = enderecoDoBanco();

  // Antes de abrir qualquer conexão: contra a produção, nem o SELECT de
  // conferência deve sair daqui.
  const previa = avaliar({ endereco, banco: null, marcar: false });
  if (!previa.ok) return previa;

  const pool = require('../src/config/db');
  const client = await pool.connect();
  try {
    // Conferir e gravar numa transação só, com as tabelas travadas: entre a
    // contagem e a marca ninguém cria conta nem chamado.
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT to_regclass('public.chamado') IS NOT NULL
          AND to_regclass('public.usuario') IS NOT NULL
          AND to_regclass('public.configuracao') IS NOT NULL AS pronto`
    );
    if (rows[0].pronto) {
      await client.query('LOCK TABLE chamado, usuario, configuracao IN EXCLUSIVE MODE');
    }
    const decisao = avaliar({ endereco, banco: await examinar(client), marcar });
    if (decisao.ok && decisao.marcar) {
      await client.query(
        `INSERT INTO configuracao (chave, valor) VALUES ($1, 'true'::jsonb)
         ON CONFLICT (chave) DO UPDATE SET valor = 'true'::jsonb, atualizado_em = now()`,
        [CHAVE]
      );
    }
    await client.query(decisao.ok ? 'COMMIT' : 'ROLLBACK');
    return decisao;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = { avaliar, examinar, executar, PROJETO_DE_PRODUCAO, CHAVE };

if (require.main === module) {
  executar({ marcar: process.argv.includes('--marcar') })
    .then((decisao) => {
      console.log(`[guarda-demonstracao] ${decisao.ok ? 'liberado' : 'RECUSADO'}: ${decisao.motivo}`);
      process.exit(decisao.ok ? 0 : 1);
    })
    .catch((err) => {
      // A mensagem do driver pode trazer host e usuário do banco: no log de uma
      // execução do GitHub ela ficaria legível a quem tem acesso ao repositório.
      console.error('[guarda-demonstracao] falhou ao consultar o banco:', err.code || 'erro de conexão');
      process.exit(1);
    });
}

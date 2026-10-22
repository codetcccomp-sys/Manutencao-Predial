const pool = require('../config/db');
const { ALERTA_PERCENTUAL, BANCO_LIMITE_MB_PADRAO } = require('../config/anexos');
const armazenamento = require('./armazenamento.service');

const MB = 1024 * 1024;

function limiteDoBanco() {
  const mb = Number(process.env.BANCO_LIMITE_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : BANCO_LIMITE_MB_PADRAO) * MB;
}

/**
 * Quanto do banco está ocupado, e se já é hora de avisar.
 *
 * Função pura: o teste do limiar não precisa de um banco quase cheio. O alerta vale a partir
 * do percentual exato (70% já avisa), porque a decisão que ele provoca (ligar o Storage)
 * leva um dia, e não minutos.
 */
function avaliar(bancoBytes, limiteBytes) {
  // Multiplica antes de dividir: 700 de 1000 dá exatamente 70, e não 70,00000000000001.
  const percentual = (bancoBytes * 100) / limiteBytes;
  return { percentual: Math.round(percentual * 10) / 10, alerta: percentual >= ALERTA_PERCENTUAL };
}

/**
 * O uso do banco, para a gestão. `pg_database_size` conta o banco inteiro (tabelas, índices
 * e o que o Postgres ainda não devolveu), que é o número que o plano cobra, e não só os anexos.
 * Os anexos entram à parte, para dizer quanto do uso é foto e quanto Storage resolveria.
 */
async function uso() {
  const { rows } = await pool.query(
    `SELECT pg_database_size(current_database())::bigint AS banco_bytes,
            COALESCE(SUM(tamanho_bytes) FILTER (WHERE armazenamento = 'banco'), 0)::bigint AS anexos_no_banco_bytes,
            COUNT(*) FILTER (WHERE armazenamento = 'banco')::int AS anexos_no_banco,
            COUNT(*) FILTER (WHERE armazenamento = 'supabase')::int AS anexos_no_storage
       FROM anexo`
  );
  const limite_bytes = limiteDoBanco();
  const banco_bytes = Number(rows[0].banco_bytes);
  return {
    banco_bytes,
    limite_bytes,
    ...avaliar(banco_bytes, limite_bytes),
    alerta_a_partir_de: ALERTA_PERCENTUAL,
    anexos_no_banco_bytes: Number(rows[0].anexos_no_banco_bytes),
    anexos_no_banco: rows[0].anexos_no_banco,
    anexos_no_storage: rows[0].anexos_no_storage,
    modo: armazenamento.modo(),
  };
}

module.exports = { uso, avaliar, limiteDoBanco };

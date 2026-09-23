const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

/**
 * Certificado da autoridade que assina o servidor do banco.
 *
 * Sem ele, a conexão ficava com `rejectUnauthorized: false` — criptografada e
 * NÃO autenticada, o equivalente a `sslmode=require`. A documentação do
 * Supabase é explícita: esse modo "sempre usa SSL, mas não verifica o
 * certificado do servidor nem o hostname". Quem conseguisse se colocar entre
 * a Vercel e o Supabase apresentaria um certificado qualquer e seria aceito:
 * leria toda consulta, os hashes de senha, todo chamado, e poderia alterar as
 * respostas no caminho.
 *
 * Aceita o certificado por duas vias, nesta ordem:
 *
 * 1. `DB_CA_CERT`, com o PEM inteiro — é o que serve na Vercel, onde não há
 *    disco para se guardar arquivo entre deploys.
 * 2. `database/supabase-ca.crt`, no repositório. O certificado de uma CA é
 *    público por definição: ele existe para ser distribuído, e versioná-lo é
 *    o caminho normal. Não é segredo e não vai junto com senha nenhuma.
 *
 * Baixe em Dashboard → Project Settings → Database → SSL Configuration.
 */
const CAMINHO_CA = path.join(__dirname, '..', '..', 'database', 'supabase-ca.crt');

function certificadoDaAutoridade() {
  const doAmbiente = String(process.env.DB_CA_CERT || '').trim();
  if (doAmbiente) return doAmbiente;

  try {
    return fs.readFileSync(CAMINHO_CA, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Como a conexão trata TLS.
 *
 * Com certificado, verifica tudo: cadeia e hostname.
 *
 * Sem certificado, o comportamento depende de onde se está. Em produção isso
 * é recusa: subir sem verificação é a falha silenciosa que esta função existe
 * para impedir, e um erro na subida é preferível a meses de tráfego
 * interceptável sem ninguém notar. Fora de produção, segue sem verificar e
 * avisa alto — quem roda contra um Postgres local com certificado de mentira
 * não deveria precisar de um arquivo para trabalhar.
 */
function configuracaoTls() {
  const ca = certificadoDaAutoridade();
  if (ca) return { ca, rejectUnauthorized: true };

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DB_CA_CERT ausente e database/supabase-ca.crt não encontrado. Em produção a ' +
        'conexão com o banco não sobe sem verificar o certificado: sem ela, o tráfego ' +
        'é criptografado mas não autenticado. Baixe o certificado em Dashboard → ' +
        'Project Settings → Database → SSL Configuration.'
    );
  }

  console.warn(
    '[db] sem certificado da CA: conectando SEM verificar o servidor. ' +
      'Aceitável fora de produção; em produção a subida falha.'
  );
  return { rejectUnauthorized: false };
}

// Em serverless (Vercel), usamos DATABASE_URL apontando para o pooler em modo
// transação (Supavisor/PgBouncer), com poucas conexões por instância.
// Removemos "sslmode" da própria string: quando presente, o pg-connection-string
// monta seu próprio objeto ssl a partir dele e ele conflita com o `ssl` abaixo,
// derrubando a conexão com "self-signed certificate in certificate chain".
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, ''),
      ssl: configuracaoTls(),
      max: 3,
    })
  : new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

pool.on('error', (err) => {
  console.error('Erro inesperado no pool do PostgreSQL:', err);
});

module.exports = pool;

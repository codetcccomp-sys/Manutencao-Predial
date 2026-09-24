const { Pool } = require('pg');
const { configuracaoTls } = require('./tls');
require('dotenv').config();

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

const { Pool, types } = require('pg');
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

// Coluna DATE volta como texto 'AAAA-MM-DD', e não como Date. O driver
// converteria para meia-noite no fuso do PROCESSO, e o JSON levaria isso em
// UTC: a data prevista de uma preventiva, 10/03, chegava à tela como
// "2026-03-10T03:00:00.000Z" — e qualquer conversão de volta no fuso errado
// mostrava 09/03. Data de calendário não tem hora nem fuso.
types.setTypeParser(1082, (valor) => valor);

pool.on('error', (err) => {
  console.error('Erro inesperado no pool do PostgreSQL:', err);
});

module.exports = pool;

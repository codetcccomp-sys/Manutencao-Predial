require('dotenv').config();
const app = require('./app');
const pool = require('./config/db');

const PORT = process.env.PORT || 3333;

pool.query('SELECT NOW()')
  .then(() => {
    console.log('Conexão com PostgreSQL estabelecida com sucesso.');
    app.listen(PORT, () => {
      console.log(`API do Sistema de Manutenção Predial rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Falha ao conectar ao PostgreSQL:', err.message);
    process.exit(1);
  });

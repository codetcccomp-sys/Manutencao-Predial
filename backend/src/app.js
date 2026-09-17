const express = require('express');
const cors = require('cors');
const { errorHandler } = require('./middlewares/errorHandler');

const app = express();

const ORIGENS_PERMITIDAS = [
  /^https:\/\/manutencao-predial-frontend(-[a-z0-9]+)?(-git-[a-z0-9-]+)?-tec-code\.vercel\.app$/,
  'http://localhost:5173',
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ORIGENS_PERMITIDAS.some((o) => (o instanceof RegExp ? o.test(origin) : o === origin))) {
        return callback(null, true);
      }
      callback(new Error('Origem não permitida pelo CORS.'));
    },
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', servico: 'Sistema de Manutenção Predial API' });
});

// Checagem que realmente exercita o banco: /health sozinho responde "ok" mesmo
// com o banco inacessível, o que esconde falha de credencial, de rede ou de SSL.
//
// A consulta lê uma tabela de verdade, e não apenas now(): conexão aberta não
// significa acesso concedido. Um SELECT de relógio passaria igual se o papel
// da aplicação perdesse privilégio sobre o schema — que é exatamente o tipo de
// falha que este endpoint existe para revelar.
app.get('/health/db', async (req, res) => {
  try {
    const { rows } = await require('./config/db').query(
      'SELECT now() AS agora, (SELECT count(*) FROM categoria) AS categorias'
    );
    res.json({
      status: 'ok',
      banco: 'conectado',
      agora: rows[0].agora,
      categorias: Number(rows[0].categorias),
    });
  } catch (err) {
    res.status(503).json({ status: 'erro', banco: 'indisponivel', detalhe: err.message });
  }
});

app.use('/auth', require('./routes/auth.routes'));
app.use('/chamados', require('./routes/chamados.routes'));
app.use('/usuarios', require('./routes/usuarios.routes'));
app.use('/locais', require('./routes/locais.routes'));
app.use('/categorias', require('./routes/categorias.routes'));
app.use('/equipes', require('./routes/equipes.routes'));
app.use('/materiais', require('./routes/materiais.routes'));
app.use('/relatorios', require('./routes/relatorios.routes'));
app.use('/notificacoes', require('./routes/notificacoes.routes'));

app.use((req, res) => {
  res.status(404).json({ erro: { mensagem: 'Rota não encontrada.' } });
});

app.use(errorHandler);

module.exports = app;

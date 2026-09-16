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

app.use('/auth', require('./routes/auth.routes'));
app.use('/chamados', require('./routes/chamados.routes'));
app.use('/usuarios', require('./routes/usuarios.routes'));
app.use('/locais', require('./routes/locais.routes'));
app.use('/categorias', require('./routes/categorias.routes'));
// app.use('/relatorios', require('./routes/relatorios.routes'));

app.use((req, res) => {
  res.status(404).json({ erro: { mensagem: 'Rota não encontrada.' } });
});

app.use(errorHandler);

module.exports = app;

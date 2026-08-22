const express = require('express');
const cors = require('cors');
const { errorHandler } = require('./middlewares/errorHandler');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', servico: 'Sistema de Manutenção Predial API' });
});

// app.use('/auth', require('./routes/auth.routes'));
// app.use('/chamados', require('./routes/chamados.routes'));
// app.use('/usuarios', require('./routes/usuarios.routes'));
// app.use('/locais', require('./routes/locais.routes'));
// app.use('/categorias', require('./routes/categorias.routes'));
// app.use('/relatorios', require('./routes/relatorios.routes'));

app.use((req, res) => {
  res.status(404).json({ erro: { mensagem: 'Rota não encontrada.' } });
});

app.use(errorHandler);

module.exports = app;

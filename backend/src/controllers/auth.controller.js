const authService = require('../services/auth.service');
const { asyncHandler } = require('../utils/asyncHandler');
const { registrarTentativa, ipDoCliente } = require('../middlewares/rateLimit');

const registrar = asyncHandler(async (req, res) => {
  const usuario = await authService.registrar(req.body);
  res.status(201).json({ usuario });
});

const login = asyncHandler(async (req, res) => {
  const ip = ipDoCliente(req);

  try {
    const resultado = await authService.login(req.body);
    await registrarTentativa(req.body.email, ip, true);
    res.json(resultado);
  } catch (err) {
    // Só conta como tentativa falha o que foi de fato credencial recusada.
    // Um erro de infraestrutura não é sinal de ataque e não deve empurrar
    // ninguém em direção ao bloqueio.
    if (err.code === 'CREDENCIAIS_INVALIDAS') {
      await registrarTentativa(req.body.email, ip, false);
    }
    throw err;
  }
});

module.exports = { registrar, login };

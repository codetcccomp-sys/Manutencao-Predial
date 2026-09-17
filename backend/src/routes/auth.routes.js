const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const { validate } = require('../validators/validate');
const { limitarLogin } = require('../middlewares/rateLimit');

const router = Router();

// Cadastro público: sempre cria perfil "solicitante".
// Demais perfis são criados por um administrador em POST /usuarios.
router.post(
  '/registrar',
  validate({
    nome: { obrigatorio: true, tipo: 'string', minLength: 3 },
    email: { obrigatorio: true, tipo: 'string', email: true },
    senha: { obrigatorio: true, tipo: 'string', minLength: 6 },
  }),
  authController.registrar
);

router.post(
  '/login',
  validate({
    email: { obrigatorio: true, tipo: 'string', email: true },
    senha: { obrigatorio: true, tipo: 'string' },
  }),
  limitarLogin,
  authController.login
);

module.exports = router;

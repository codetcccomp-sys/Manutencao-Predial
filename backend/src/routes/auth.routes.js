const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const { validate } = require('../validators/validate');
const { limitarLogin, limitarRecuperacao } = require('../middlewares/rateLimit');

const router = Router();

// Cadastro público: sempre cria perfil "solicitante".
// Demais perfis são criados por um administrador em POST /usuarios.
router.post(
  '/registrar',
  validate({
    nome: { aparar: true, obrigatorio: true, tipo: 'string', minLength: 3 },
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

// RF01: recuperação segura de senha.
//
// O limitador vem depois do `validate`: assim um corpo malformado é recusado
// sem gastar uma linha do contador, e quem erra o formato do e-mail não
// caminha para o bloqueio.
router.post(
  '/recuperar-senha',
  validate({ email: { obrigatorio: true, tipo: 'string', email: true } }),
  limitarRecuperacao,
  authController.solicitarRecuperacao
);

router.post(
  '/redefinir-senha',
  validate({
    token: { obrigatorio: true, tipo: 'string', minLength: 32, maxLength: 128 },
    senha: { obrigatorio: true, tipo: 'string', minLength: 6, maxLength: 200 },
  }),
  authController.redefinirSenha
);

module.exports = router;

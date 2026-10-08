const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const { validate } = require('../validators/validate');
const { limitarLogin, limitarRecuperacao, conferirLimite } = require('../middlewares/rateLimit');
const { authenticate, authenticateSem2fa } = require('../middlewares/auth');
const authService = require('../services/auth.service');

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

// Segunda etapa do login, para quem ligou a verificação em duas etapas. O
// limite de tentativas é o mesmo do login, contado pelo e-mail do desafio:
// errar o código conta como errar a senha.
async function limitarSegundoFator(req, res, next) {
  let email;
  try {
    email = await authService.emailDoDesafio(req.body?.desafio);
  } catch (err) {
    return next(err);
  }
  return conferirLimite(req, res, next, email);
}

router.post(
  '/login/2fa',
  validate({
    desafio: { obrigatorio: true, tipo: 'string', maxLength: 2000 },
    codigo: { obrigatorio: true, tipo: 'string', maxLength: 20 },
  }),
  limitarSegundoFator,
  authController.segundoFator
);

router.post('/sair', authController.sair);
// Com a verificação exigida da gestão (configuração `exigir_2fa_gestao`),
// quem ainda não ligou alcança só estas: as que ligam a verificação e a que
// encerra as próprias sessões.
router.post('/sair-de-todos', authenticateSem2fa, authController.sairDeTodos);

// As rotas que conferem senha ou código na própria conta usam o mesmo limite
// do login, pelo e-mail da conta logada.
const limitarPelaConta = (req, res, next) => conferirLimite(req, res, next, req.usuario.email);

router.get('/2fa', authenticateSem2fa, authController.situacao2fa);
router.post('/2fa/iniciar', authenticateSem2fa, authController.iniciar2fa);
router.post(
  '/2fa/ativar',
  authenticateSem2fa,
  validate({
    senha: { obrigatorio: true, tipo: 'string', maxLength: 200 },
    codigo: { obrigatorio: true, tipo: 'string', maxLength: 20 },
  }),
  limitarPelaConta,
  authController.ativar2fa
);
router.post(
  '/2fa/desativar',
  authenticate,
  validate({
    senha: { obrigatorio: true, tipo: 'string', maxLength: 200 },
    codigo: { obrigatorio: true, tipo: 'string', maxLength: 20 },
  }),
  limitarPelaConta,
  authController.desativar2fa
);
router.post(
  '/2fa/codigos',
  authenticate,
  validate({ codigo: { obrigatorio: true, tipo: 'string', maxLength: 20 } }),
  limitarPelaConta,
  authController.novosCodigos
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

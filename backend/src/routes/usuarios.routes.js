const { Router } = require('express');
const usuariosController = require('../controllers/usuarios.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { validate } = require('../validators/validate');

const router = Router();

router.use(authenticate);

router.get('/me', usuariosController.me);
router.get('/', authorize('administrador', 'gestor'), usuariosController.listar);
router.post(
  '/',
  authorize('administrador'),
  validate({
    nome: { obrigatorio: true, tipo: 'string', minLength: 3 },
    email: { obrigatorio: true, tipo: 'string', email: true },
    senha: { obrigatorio: true, tipo: 'string', minLength: 6 },
    perfil: { obrigatorio: true, enum: ['solicitante', 'tecnico', 'gestor', 'administrador'] },
  }),
  usuariosController.criar
);

module.exports = router;

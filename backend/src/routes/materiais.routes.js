const { Router } = require('express');
const materiaisController = require('../controllers/materiais.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { validate } = require('../validators/validate');

const router = Router();

router.use(authenticate);

// O catálogo é lido por quem vai lançar consumo — inclusive o técnico.
router.get('/', materiaisController.listar);

router.post(
  '/',
  authorize('administrador', 'gestor'),
  validate({
    nome: { obrigatorio: true, tipo: 'string', minLength: 2, maxLength: 150 },
    unidade_medida: { obrigatorio: true, tipo: 'string', minLength: 1, maxLength: 30 },
  }),
  materiaisController.criar
);

router.patch(
  '/:id',
  authorize('administrador', 'gestor'),
  validate({
    nome: { tipo: 'string', minLength: 2, maxLength: 150 },
    unidade_medida: { tipo: 'string', minLength: 1, maxLength: 30 },
  }),
  materiaisController.atualizar
);

module.exports = router;

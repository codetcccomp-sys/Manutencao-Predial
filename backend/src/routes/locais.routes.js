const { Router } = require('express');
const locaisController = require('../controllers/locais.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { validate } = require('../validators/validate');

const router = Router();

router.use(authenticate);

router.get('/', locaisController.listar);
router.post(
  '/',
  authorize('administrador', 'gestor'),
  validate({ unidade: { obrigatorio: true, tipo: 'string', minLength: 2 } }),
  locaisController.criar
);

module.exports = router;

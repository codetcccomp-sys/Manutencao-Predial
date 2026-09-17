const { Router } = require('express');
const locaisController = require('../controllers/locais.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { validate } = require('../validators/validate');

const router = Router();

router.use(authenticate);

router.get('/', locaisController.listar);

const CAMPOS_LOCAL = {
  unidade: { tipo: 'string', minLength: 2, maxLength: 150 },
  bloco: { tipo: 'string', maxLength: 100 },
  pavimento: { tipo: 'string', maxLength: 100 },
  setor: { tipo: 'string', maxLength: 100 },
  ambiente: { tipo: 'string', maxLength: 150 },
};

router.post(
  '/',
  authorize('administrador', 'gestor'),
  validate({ ...CAMPOS_LOCAL, unidade: { ...CAMPOS_LOCAL.unidade, obrigatorio: true } }),
  locaisController.criar
);

router.patch(
  '/:id',
  authorize('administrador', 'gestor'),
  validate(CAMPOS_LOCAL),
  locaisController.atualizar
);

module.exports = router;

const { Router } = require('express');
const categoriasController = require('../controllers/categorias.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { validate } = require('../validators/validate');

const router = Router();

router.use(authenticate);

// Lida por qualquer autenticado: é o que preenche o seletor na abertura do
// chamado.
router.get('/', categoriasController.listar);

router.post(
  '/',
  authorize('administrador', 'gestor'),
  validate({ nome: { aparar: true, obrigatorio: true, tipo: 'string', minLength: 3, maxLength: 50 } }),
  categoriasController.criar
);

// Categoria não é apagada: chamados antigos continuam apontando para ela, e a
// RN10 proíbe excluir registro com histórico. Renomear é o que resta.
router.patch(
  '/:id',
  authorize('administrador', 'gestor'),
  validate({ nome: { aparar: true, obrigatorio: true, tipo: 'string', minLength: 3, maxLength: 50 } }),
  categoriasController.atualizar
);

module.exports = router;

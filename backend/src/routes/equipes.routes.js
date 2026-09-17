const { Router } = require('express');
const equipesController = require('../controllers/equipes.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { validate } = require('../validators/validate');

const router = Router();

router.use(authenticate);

// Leitura é liberada a qualquer perfil autenticado: o técnico precisa saber
// de que equipe faz parte, e o solicitante vê quem atende seu chamado.
router.get('/', equipesController.listar);
router.get('/:id', equipesController.buscarPorId);

router.post(
  '/',
  authorize('administrador', 'gestor'),
  validate({ nome: { obrigatorio: true, tipo: 'string', minLength: 2, maxLength: 100 } }),
  equipesController.criar
);

router.patch(
  '/:id',
  authorize('administrador', 'gestor'),
  validate({ nome: { tipo: 'string', minLength: 2, maxLength: 100 } }),
  equipesController.atualizar
);

router.post(
  '/:id/tecnicos',
  authorize('administrador', 'gestor'),
  validate({ usuario_id: { obrigatorio: true, tipo: 'number' } }),
  equipesController.adicionarTecnico
);

router.delete(
  '/:id/tecnicos/:usuarioId',
  authorize('administrador', 'gestor'),
  equipesController.removerTecnico
);

module.exports = router;

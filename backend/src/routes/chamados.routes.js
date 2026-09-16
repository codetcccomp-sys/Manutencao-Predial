const { Router } = require('express');
const chamadosController = require('../controllers/chamados.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { validate } = require('../validators/validate');

const router = Router();

router.use(authenticate);

router.post(
  '/',
  authorize('solicitante', 'administrador', 'gestor'),
  validate({
    titulo: { obrigatorio: true, tipo: 'string', minLength: 3 },
    descricao: { obrigatorio: true, tipo: 'string', minLength: 5 },
    categoria_id: { obrigatorio: true, tipo: 'number' },
    local_id: { obrigatorio: true, tipo: 'number' },
    prioridade: { enum: ['baixa', 'media', 'alta', 'critica'] },
  }),
  chamadosController.criar
);

router.get('/', chamadosController.listar);
router.get('/:id', chamadosController.buscarPorId);

router.patch(
  '/:id/atribuir',
  authorize('administrador', 'gestor'),
  chamadosController.atribuir
);

router.patch(
  '/:id/estado',
  validate({
    estado: {
      obrigatorio: true,
      enum: ['em_triagem', 'atribuido', 'em_andamento', 'aguardando_material', 'concluido', 'cancelado'],
    },
  }),
  chamadosController.mudarEstado
);

router.post(
  '/:id/avaliacao',
  authorize('solicitante'),
  validate({ nota: { obrigatorio: true, tipo: 'number' } }),
  chamadosController.avaliar
);

module.exports = router;

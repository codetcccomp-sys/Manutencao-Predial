const { Router } = require('express');
const priorizacaoController = require('../controllers/priorizacao.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { validate } = require('../validators/validate');

const router = Router();

router.use(authenticate);

// A regra vigente é lida por qualquer autenticado: quem abre um chamado tem
// o direito de saber por que critério ele será classificado.
router.get('/vigente', priorizacaoController.vigente);

router.post(
  '/simular',
  authorize('administrador', 'gestor'),
  validate({
    urgencia: { obrigatorio: true, tipo: 'number', min: 1, max: 4 },
    impacto: { obrigatorio: true, tipo: 'number', min: 1, max: 4 },
    risco: { obrigatorio: true, tipo: 'number', min: 1, max: 4 },
  }),
  priorizacaoController.simular
);

// O histórico de versões é informação de auditoria da política, não do dia a
// dia: fica com a gestão.
router.get('/', authorize('administrador', 'gestor'), priorizacaoController.listar);

router.post(
  '/',
  authorize('administrador'),
  validate({
    versao: { obrigatorio: true, tipo: 'string', minLength: 1, maxLength: 20 },
    peso_urgencia: { obrigatorio: true, tipo: 'number', min: 1, max: 10 },
    peso_impacto: { obrigatorio: true, tipo: 'number', min: 1, max: 10 },
    peso_risco: { obrigatorio: true, tipo: 'number', min: 1, max: 10 },
    limiar_media: { obrigatorio: true, tipo: 'number', min: 1, max: 120 },
    limiar_alta: { obrigatorio: true, tipo: 'number', min: 1, max: 120 },
    limiar_critica: { obrigatorio: true, tipo: 'number', min: 1, max: 120 },
    risco_critico_minimo: { obrigatorio: true, tipo: 'number', min: 1, max: 4 },
    observacao: { tipo: 'string', maxLength: 500 },
  }),
  priorizacaoController.criar
);

module.exports = router;

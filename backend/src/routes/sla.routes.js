const { Router } = require('express');
const slaController = require('../controllers/sla.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { validate } = require('../validators/validate');

const router = Router();

router.use(authenticate);

// Qualquer perfil lê: o solicitante precisa saber em quanto tempo espera
// resposta, e o técnico, contra que prazo está trabalhando.
router.get('/', slaController.listar);

router.patch(
  '/:prioridade',
  authorize('administrador', 'gestor'),
  // Teto de um ano: um prazo maior que isso é quase sempre engano de
  // digitação, e um prazo absurdo torna o indicador de atraso inútil sem
  // deixar rastro de que foi configurado errado.
  validate({ prazo_horas: { obrigatorio: true, tipo: 'number', min: 1, max: 8760 } }),
  slaController.atualizar
);

module.exports = router;

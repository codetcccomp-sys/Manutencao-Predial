const { Router } = require('express');
const slaController = require('../controllers/sla.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { validate } = require('../validators/validate');

const router = Router();

router.use(authenticate);

// Qualquer perfil lê: o solicitante precisa saber em quanto tempo espera
// resposta, e o técnico, contra que prazo está trabalhando.
router.get('/', slaController.listar);

// Expediente e feriados vêm antes de /:prioridade, senão "expediente" seria
// lido como o nome de uma prioridade.
router.get('/expediente', slaController.expediente);
router.put('/expediente', authorize('administrador', 'gestor'), slaController.definirExpediente);
router.get('/feriados', slaController.feriados);
router.post(
  '/feriados',
  authorize('administrador', 'gestor'),
  validate({
    data: { obrigatorio: true, tipo: 'string' },
    descricao: { obrigatorio: true, tipo: 'string', minLength: 3, maxLength: 150, aparar: true },
  }),
  slaController.adicionarFeriado
);
// RN12: versões da política de prazos. Só a gestão: traz o nome de quem alterou.
router.get('/historico', authorize('administrador', 'gestor'), slaController.historico);

router.delete('/feriados/:data', authorize('administrador', 'gestor'), slaController.removerFeriado);

router.patch(
  '/:prioridade',
  authorize('administrador', 'gestor'),
  // Teto de um ano: um prazo maior que isso é quase sempre engano de
  // digitação, e um prazo absurdo torna o indicador de atraso inútil sem
  // deixar rastro de que foi configurado errado.
  validate({
    prazo_horas: { tipo: 'inteiro', min: 1, max: 8760 },
    contagem: { enum: ['corridas', 'uteis'] },
  }),
  slaController.atualizar
);

module.exports = router;

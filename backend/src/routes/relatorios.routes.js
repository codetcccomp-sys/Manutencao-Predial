const { Router } = require('express');
const relatoriosController = require('../controllers/relatorios.controller');
const { authenticate, authorize } = require('../middlewares/auth');

const router = Router();

// Relatório agrega chamados de toda a organização, inclusive de quem não é
// do time de quem consulta. Só gestão enxerga.
router.use(authenticate, authorize('administrador', 'gestor'));

router.get('/resumo', relatoriosController.resumo);
router.get('/desempenho', relatoriosController.desempenho);
router.get('/tecnicos', relatoriosController.porTecnico);

module.exports = router;

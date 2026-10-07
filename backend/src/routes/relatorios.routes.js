const { Router } = require('express');
const relatoriosController = require('../controllers/relatorios.controller');
const { authenticate, authorize } = require('../middlewares/auth');

const router = Router();

// Relatório agrega chamados de toda a organização, inclusive de quem não é
// do time de quem consulta. Só gestão enxerga.
router.use(authenticate, authorize('administrador', 'gestor'));

router.get('/resumo', relatoriosController.resumo);
router.get('/desempenho', relatoriosController.desempenho);
router.get('/serie', relatoriosController.serie);
router.get('/preventiva', relatoriosController.preventiva);
router.get('/tecnicos', relatoriosController.porTecnico);

// RF10: exportação. Dois formatos porque servem a coisas diferentes — o PDF
// é o consolidado pronto para circular e arquivar; a planilha é analítica,
// uma linha por chamado, para a gestão cruzar o que a tela não previu.
router.get('/exportar/chamados.csv', relatoriosController.exportarChamadosCsv);
router.get('/exportar/resumo.pdf', relatoriosController.exportarResumoPdf);

module.exports = router;

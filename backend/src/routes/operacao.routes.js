const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const execucoes = require('../services/execucoes.service');

const router = Router();

// O lado de dentro das tarefas agendadas: quem lê é a gestão, pela tela, com
// login — e não o agendador, com o segredo. As rotas de /tarefas continuam
// fechadas para pessoas.
router.use(authenticate, authorize('administrador', 'gestor'));

router.get(
  '/agendador',
  asyncHandler(async (req, res) => {
    res.json({ tarefas: await execucoes.saude() });
  })
);

module.exports = router;

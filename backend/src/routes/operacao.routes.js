const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const execucoes = require('../services/execucoes.service');
const erros = require('../services/erros.service');

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

// Os erros de servidor guardados (migração 028). Só o administrador: a pilha
// mostra caminhos de arquivo e nomes de função, que a gestão não precisa ver.
router.get(
  '/erros',
  authorize('administrador'),
  asyncHandler(async (req, res) => {
    res.json(await erros.listar({ limite: req.query.limite }));
  })
);

module.exports = router;

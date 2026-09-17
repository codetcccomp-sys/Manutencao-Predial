const { Router } = require('express');
const notificacoesController = require('../controllers/notificacoes.controller');
const { authenticate } = require('../middlewares/auth');

const router = Router();

router.use(authenticate);

// Não há filtro por perfil aqui: o escopo é sempre o próprio usuário, imposto
// no serviço pelo id do token e não por parâmetro da requisição.
router.get('/', notificacoesController.listar);
router.patch('/:id/lida', notificacoesController.marcarComoLida);

module.exports = router;

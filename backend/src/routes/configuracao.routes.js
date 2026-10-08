const { Router } = require('express');
const configuracaoController = require('../controllers/configuracao.controller');
const { authenticate, authorize } = require('../middlewares/auth');

const router = Router();

router.use(authenticate);

// A gestão lê (a tela de aprovação diz se a exigência está ligada); só a
// administração muda: decidir quem consegue entrar é da administração da
// instalação. O serviço confere chave e tipo de cada valor.
router.get('/', authorize('administrador', 'gestor'), configuracaoController.listar);
router.patch('/', authorize('administrador'), configuracaoController.definir);

module.exports = router;

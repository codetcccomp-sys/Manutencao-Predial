const { Router } = require('express');
const distribuicaoController = require('../controllers/distribuicao.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { validate } = require('../validators/validate');
const { PRIORIDADES } = require('../services/distribuicao.service');

const router = Router();

// Quem decide para onde o chamado vai sem passar pela triagem é quem faz a
// triagem: a gestão. Nem a leitura é de outro perfil — o técnico vê a regra
// no histórico do chamado que recebeu.
router.use(authenticate, authorize('administrador', 'gestor'));

router.get('/', distribuicaoController.listar);

router.post(
  '/',
  validate({
    categoria_id: { obrigatorio: true, tipo: 'number' },
    equipe_id: { obrigatorio: true, tipo: 'number' },
    unidade: { tipo: 'string', maxLength: 150 },
    bloco: { tipo: 'string', maxLength: 100 },
    tecnico_id: { tipo: 'number' },
    prioridade: { enum: PRIORIDADES },
  }),
  distribuicaoController.criar
);

// Nulo em tecnico_id é a forma de tirar o plantonista; o validador deixa
// passar nulo, e o serviço distingue "nulo" de "não informado".
router.patch(
  '/:id',
  validate({
    equipe_id: { tipo: 'number' },
    tecnico_id: { tipo: 'number' },
    prioridade: { enum: PRIORIDADES },
    ativo: { tipo: 'boolean' },
  }),
  distribuicaoController.atualizar
);

module.exports = router;

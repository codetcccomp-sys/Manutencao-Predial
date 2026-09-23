const { Router } = require('express');
const usuariosController = require('../controllers/usuarios.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { validate } = require('../validators/validate');

const router = Router();

router.use(authenticate);

router.get('/me', usuariosController.me);
router.get('/', authorize('administrador', 'gestor'), usuariosController.listar);
router.post(
  '/',
  authorize('administrador'),
  validate({
    nome: { aparar: true, obrigatorio: true, tipo: 'string', minLength: 3 },
    email: { obrigatorio: true, tipo: 'string', email: true },
    senha: { obrigatorio: true, tipo: 'string', minLength: 6 },
    perfil: { obrigatorio: true, enum: ['solicitante', 'tecnico', 'gestor', 'administrador'] },
  }),
  usuariosController.criar
);

router.patch(
  '/:id',
  authorize('administrador'),
  validate({
    nome: { aparar: true, tipo: 'string', minLength: 3 },
    perfil: { enum: ['solicitante', 'tecnico', 'gestor', 'administrador'] },
  }),
  usuariosController.atualizar
);

// Atende pedido de remoção (LGPD, docs/lgpd.md §5).
//
// POST e não DELETE: o recurso não é apagado. Um DELETE que deixa a linha no
// banco engana quem lê a rota, e este é o pior lugar para enganar — alguém
// pode acabar "completando" o DELETE mais tarde, achando que corrige uma
// implementação pela metade, e levar junto todo o histórico do prédio.
//
// Só administrador, e o serviço ainda recusa a própria conta: a ação não tem
// desfazer, então exige um segundo par de olhos.
router.post('/:id/anonimizar', authorize('administrador'), usuariosController.anonimizar);

module.exports = router;

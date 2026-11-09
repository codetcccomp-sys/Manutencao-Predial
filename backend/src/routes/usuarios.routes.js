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
    senha: { obrigatorio: true, tipo: 'string', minLength: 10, maxLength: 200 },
    perfil: { obrigatorio: true, enum: ['solicitante', 'tecnico', 'gestor', 'administrador'] },
  }),
  usuariosController.criar
);

// RF01: autocadastro sob aprovação. A gestão aprova junto com a
// administração: é quem recebe os chamados de quem se cadastra, e o pedido só
// cria solicitante — nunca um perfil interno.
router.post('/aprovar', authorize('administrador', 'gestor'), usuariosController.aprovar);
router.post('/recusar', authorize('administrador', 'gestor'), usuariosController.recusar);

router.patch(
  '/:id',
  authorize('administrador'),
  validate({
    nome: { aparar: true, tipo: 'string', minLength: 3 },
    perfil: { enum: ['solicitante', 'tecnico', 'gestor', 'administrador'] },
    ativo: { tipo: 'boolean' },
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

// Para quem perdeu o celular e os códigos de recuperação. Só o administrador,
// e a pessoa tem as sessões derrubadas: quem pediu talvez não tenha sido ela.
router.post('/:id/2fa/redefinir', authorize('administrador'), usuariosController.redefinir2fa);

module.exports = router;

const { Router } = require('express');
const equipamentosController = require('../controllers/equipamentos.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { validate } = require('../validators/validate');

const router = Router();

router.use(authenticate);

const CAMPOS = {
  codigo: { tipo: 'string', maxLength: 40, aparar: true },
  nome: { tipo: 'string', minLength: 2, maxLength: 150, aparar: true },
  categoria_id: { tipo: 'number' },
  local_id: { tipo: 'number' },
  fabricante: { tipo: 'string', maxLength: 100 },
  modelo: { tipo: 'string', maxLength: 100 },
  numero_serie: { tipo: 'string', maxLength: 100 },
  data_instalacao: { tipo: 'string' },
  observacao: { tipo: 'string', maxLength: 2000 },
};

router.get('/', equipamentosController.listar);

// Antes de /:id: senão "codigo" seria lido como um id.
router.get('/codigo/:codigo', equipamentosController.buscarPorCodigo);

router.get('/:id', equipamentosController.buscarPorId);

router.post(
  '/',
  authorize('administrador', 'gestor'),
  validate({
    ...CAMPOS,
    codigo: { ...CAMPOS.codigo, obrigatorio: true },
    nome: { ...CAMPOS.nome, obrigatorio: true },
    categoria_id: { ...CAMPOS.categoria_id, obrigatorio: true },
    local_id: { ...CAMPOS.local_id, obrigatorio: true },
  }),
  equipamentosController.criar
);

// Desativar é PATCH com `ativo: false`, como nos outros cadastros: o
// equipamento retirado continua no histórico dos chamados que teve.
router.patch('/:id', authorize('administrador', 'gestor'), validate(CAMPOS), equipamentosController.atualizar);

module.exports = router;

const { Router } = require('express');
const planosController = require('../controllers/planos.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { validate } = require('../validators/validate');

const router = Router();

// Plano preventivo é instrumento da gestão (NBR 5674: quem planeja a
// manutenção). O técnico recebe o que o plano gera — o chamado —, não o plano.
router.use(authenticate, authorize('administrador', 'gestor'));

const CAMPOS = {
  titulo: { tipo: 'string', minLength: 3, maxLength: 200, aparar: true },
  descricao: { tipo: 'string', minLength: 5, maxLength: 4000 },
  equipamento_id: { tipo: 'number' },
  local_id: { tipo: 'number' },
  categoria_id: { tipo: 'number' },
  prioridade: { enum: ['baixa', 'media', 'alta', 'critica'] },
  repetir_a_cada: { tipo: 'number', min: 1, max: 366 },
  unidade_repeticao: { enum: ['dia', 'semana', 'mes', 'ano'] },
  proxima_execucao: { tipo: 'string' },
  antecedencia_dias: { tipo: 'number', min: 0, max: 60 },
  tecnico_id: { tipo: 'number' },
};

router.get('/', planosController.listar);
router.get('/:id', planosController.buscarPorId);

router.post(
  '/',
  validate({
    ...CAMPOS,
    titulo: { ...CAMPOS.titulo, obrigatorio: true },
    descricao: { ...CAMPOS.descricao, obrigatorio: true },
    repetir_a_cada: { ...CAMPOS.repetir_a_cada, obrigatorio: true },
    unidade_repeticao: { ...CAMPOS.unidade_repeticao, obrigatorio: true },
    proxima_execucao: { ...CAMPOS.proxima_execucao, obrigatorio: true },
  }),
  planosController.criar
);

router.patch('/:id', validate(CAMPOS), planosController.atualizar);

// Antecipa a próxima execução: o serviço precisa ser feito antes da data
// (a vistoria do Corpo de Bombeiros foi marcada, por exemplo).
router.post('/:id/gerar', planosController.gerarAgora);

module.exports = router;

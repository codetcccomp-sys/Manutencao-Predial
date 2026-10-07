const { Router } = require('express');
const chamadosController = require('../controllers/chamados.controller');
const materiaisController = require('../controllers/materiais.controller');
const anexosController = require('../controllers/anexos.controller');
const comentariosController = require('../controllers/comentarios.controller');
const { authenticate, authorize } = require('../middlewares/auth');
const { receberArquivo } = require('../middlewares/upload');
const { validate } = require('../validators/validate');

const router = Router();

router.use(authenticate);

router.post(
  '/',
  authorize('solicitante', 'administrador', 'gestor'),
  validate({
    titulo: { obrigatorio: true, tipo: 'string', minLength: 3 },
    descricao: { obrigatorio: true, tipo: 'string', minLength: 5 },
    // Local e categoria são obrigatórios, a menos que venha o equipamento:
    // aí os dois são os dele (o caminho do QR Code). Quem confere é o serviço.
    categoria_id: { tipo: 'number' },
    local_id: { tipo: 'number' },
    equipamento_id: { tipo: 'number' },
    prioridade: { enum: ['baixa', 'media', 'alta', 'critica'] },
  }),
  chamadosController.criar
);

router.get('/', chamadosController.listar);
router.get('/:id', chamadosController.buscarPorId);

// RN03: o solicitante corrige o que escreveu enquanto o chamado não foi
// atribuído; a gestão edita como ação autorizada. Quem pode depende do
// estado e da relação com o chamado, então a checagem fica no serviço.
router.patch(
  '/:id',
  validate({
    titulo: { tipo: 'string', minLength: 3, maxLength: 200 },
    descricao: { tipo: 'string', minLength: 5 },
    categoria_id: { tipo: 'number' },
    local_id: { tipo: 'number' },
    equipamento_id: { tipo: 'number' },
  }),
  chamadosController.editar
);

router.patch(
  '/:id/atribuir',
  authorize('administrador', 'gestor'),
  validate({
    tecnico_id: { tipo: 'number' },
    equipe_id: { tipo: 'number' },
    // Obrigatória só na reatribuição; quem sabe se é o caso é o serviço, que
    // conhece o estado atual do chamado.
    justificativa: { tipo: 'string', maxLength: 1000 },
  }),
  chamadosController.atribuir
);

// RN09: reabertura tem regras próprias — quem pode, janela de tempo e
// justificativa —, por isso não é apenas mais uma transição de estado.
router.post(
  '/:id/reabertura',
  validate({ justificativa: { obrigatorio: true, tipo: 'string', minLength: 10, maxLength: 1000 } }),
  chamadosController.reabrir
);

router.patch(
  '/:id/estado',
  validate({
    estado: {
      obrigatorio: true,
      enum: ['em_triagem', 'atribuido', 'em_andamento', 'aguardando_material', 'concluido', 'cancelado'],
    },
    // Obrigatório só na conclusão (RN07); a checagem condicional fica no
    // serviço, que é quem conhece o estado de destino.
    servico_realizado: { tipo: 'string', maxLength: 4000 },
    observacao: { tipo: 'string', maxLength: 2000 },
  }),
  chamadosController.mudarEstado
);

// RF07: diagnóstico e tempo empregado, preenchidos ao longo do atendimento.
router.patch(
  '/:id/execucao',
  validate({
    diagnostico: { tipo: 'string', maxLength: 4000 },
    tempo_empregado_minutos: { tipo: 'number', min: 1, max: 100000 },
  }),
  chamadosController.registrarExecucao
);

// RF04: registrar os fatores e definir a prioridade. Só gestão — a RN05 diz
// que somente gestores alteram prioridade.
router.patch(
  '/:id/priorizacao',
  authorize('administrador', 'gestor'),
  validate({
    urgencia: { obrigatorio: true, tipo: 'number', min: 1, max: 4 },
    impacto: { obrigatorio: true, tipo: 'number', min: 1, max: 4 },
    risco: { obrigatorio: true, tipo: 'number', min: 1, max: 4 },
    prioridade: { enum: ['baixa', 'media', 'alta', 'critica'] },
    justificativa: { tipo: 'string', maxLength: 1000 },
  }),
  chamadosController.priorizar
);

router.post(
  '/:id/avaliacao',
  authorize('solicitante'),
  validate({ nota: { obrigatorio: true, tipo: 'number', min: 1, max: 5 } }),
  chamadosController.avaliar
);

// Materiais consumidos no atendimento. O perfil não basta para autorizar
// aqui — o que vale é a relação com este chamado (técnico designado ou
// gestão), então a checagem fica no controller, com o chamado em mãos.
router.get('/:id/materiais', materiaisController.listarDoChamado);

router.post(
  '/:id/materiais',
  validate({
    material_id: { obrigatorio: true, tipo: 'number' },
    quantidade: { obrigatorio: true, tipo: 'number', min: 0.01 },
  }),
  materiaisController.registrarNoChamado
);

router.delete('/:id/materiais/:materialId', materiaisController.removerDoChamado);

// Comentários (RF08 e a segunda metade da RN03: depois que a janela de edição
// fecha, é por aqui que o solicitante acrescenta o que faltou). Como nos
// materiais, quem autoriza é a relação com o chamado, não o perfil — a
// checagem fica no serviço, que reaproveita a mesma regra de leitura.
router.get('/:id/comentarios', comentariosController.listar);

router.post(
  '/:id/comentarios',
  validate({ texto: { obrigatorio: true, tipo: 'string', minLength: 2, maxLength: 4000 } }),
  comentariosController.criar
);

// Anexos. Como nos materiais, quem autoriza é a relação com o chamado, então
// a checagem fica no controller.
router.get('/:id/anexos', anexosController.listar);
router.post('/:id/anexos', receberArquivo, anexosController.anexar);
router.get('/:id/anexos/:anexoId/conteudo', anexosController.baixar);
router.delete('/:id/anexos/:anexoId', anexosController.remover);

module.exports = router;

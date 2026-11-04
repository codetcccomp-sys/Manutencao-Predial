const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const execucoes = require('../services/execucoes.service');
const erros = require('../services/erros.service');
const armazenamentoUso = require('../services/armazenamentoUso.service');
const telemetria = require('../services/telemetria.service');

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

// Quanto do banco está ocupado. A gestão vê porque é ela quem decide ligar o Storage
// (docs/piloto.md, 2.1.2); o número é só tamanho, sem dado de pessoa.
router.get(
  '/armazenamento',
  asyncHandler(async (req, res) => {
    res.json(await armazenamentoUso.uso());
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

// Uso e desempenho (migração 031): contadores por dia, sem pessoa. Só o administrador, como os
// erros: é leitura de operação, e a gestão não precisa dela para o que faz.
router.get(
  '/telemetria',
  authorize('administrador'),
  asyncHandler(async (req, res) => {
    res.json(await telemetria.resumo({ dias: req.query.dias }));
  })
);

module.exports = router;

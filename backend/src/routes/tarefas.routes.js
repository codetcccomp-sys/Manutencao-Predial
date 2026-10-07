const { Router } = require('express');
const atrasosService = require('../services/atrasos.service');
const preventivaService = require('../services/preventiva.service');
const execucoes = require('../services/execucoes.service');
const { autenticarAgendador } = require('../middlewares/cron');
const { asyncHandler } = require('../utils/asyncHandler');

const router = Router();

// Tudo aqui é chamado por um agendador externo, nunca por uma pessoa: não há
// `authenticate`, e o que protege é o segredo compartilhado.
router.use(autenticarAgendador);

/**
 * RF08: avisa quem precisa saber que um chamado passou do prazo.
 *
 * POST, e não GET, porque a chamada muda estado. Alguns agendadores só fazem
 * GET; o de escolha faz POST, e manter o método honesto evita que um
 * pré-carregador de link ou um crawler dispare a tarefa por acidente.
 */
router.post(
  '/notificar-atrasos',
  asyncHandler(async (req, res) => {
    res.json(await execucoes.registrar('notificar-atrasos', () => atrasosService.notificarAtrasados()));
  })
);

// Manutenção preventiva: gera os chamados dos planos que entraram na janela
// de antecedência. Uma vez por dia basta (o plano tem granularidade de dia),
// mas rodar mais vezes é inofensivo: cada execução prevista vira no máximo
// um chamado, garantido pelo índice único de plano + data.
const gerarPreventivas = asyncHandler(async (req, res) => {
  res.json(await execucoes.registrar('gerar-preventivas', () => preventivaService.gerarVencidos()));
});
router.post('/gerar-preventivas', gerarPreventivas);

// O Vercel Cron (backend/vercel.json) só faz GET, com o mesmo
// `Authorization: Bearer <CRON_SECRET>`. O GET aqui não abre porta nova: sem o
// segredo é 401 como no POST, então crawler ou pré-carregador de link não
// dispara nada — e a geração é idempotente de qualquer forma.
router.get('/gerar-preventivas', gerarPreventivas);

// Só leitura, para conferir de fora se a varredura está dando conta sem
// precisar disparar nada.
router.get(
  '/atrasos-pendentes',
  asyncHandler(async (req, res) => {
    res.json({ pendentes: await atrasosService.pendentes() });
  })
);

module.exports = router;

const { Router } = require('express');
const atrasosService = require('../services/atrasos.service');
const criticosService = require('../services/criticos.service');
const preventivaService = require('../services/preventiva.service');
const execucoes = require('../services/execucoes.service');
const conferenciaEmail = require('../services/conferenciaEmail.service');
const { autenticarAgendador } = require('../middlewares/cron');
const { asyncHandler } = require('../utils/asyncHandler');

const router = Router();

// Tudo aqui é chamado por um agendador externo, nunca por uma pessoa: não há
// `authenticate`, e o que protege é o segredo compartilhado.
router.use(autenticarAgendador);

/**
 * RF08: avisa quem precisa saber que um chamado passou do prazo, e a gestão de que um
 * crítico está há mais de 15 minutos sem ninguém.
 *
 * POST, e não GET, porque a chamada muda estado. Alguns agendadores só fazem
 * GET; o de escolha faz POST, e manter o método honesto evita que um
 * pré-carregador de link ou um crawler dispare a tarefa por acidente.
 */
router.post(
  '/notificar-atrasos',
  asyncHandler(async (req, res) => {
    // A mesma passagem de 15 minutos também procura os críticos que ninguém atendeu (achado 3):
    // um agendador só, e o painel de saúde das tarefas cobre os dois. O aviso de atraso vai
    // primeiro, e uma falha do segundo aparece como falha da tarefa, em vez de passar calada.
    const resultado = await execucoes.registrar('notificar-atrasos', async () => ({
      ...(await atrasosService.notificarAtrasados()),
      ...(await criticosService.notificarCriticosSemAtendimento()),
    }));
    // De hora em hora, aproveitando a passagem: o login no servidor de e-mail ainda vale?
    await conferenciaEmail.conferirSeVencida();
    res.json(resultado);
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

// Saúde das tarefas, para a conferência diária do GitHub (workflow publicacao.yml). É a mesma
// leitura do painel da gestão (/operacao/agendador), mas com o segredo do agendador em vez de
// login: em 09/11/2026 o agendador externo parou na queda da API e ficou dias desligado sem
// ninguém ver, porque o aviso só aparecia para quem abrisse o painel.
router.get(
  '/saude',
  asyncHandler(async (req, res) => {
    // Confere o e-mail antes de responder, se a última conferência passou da hora: a
    // conferência pós-deploy chega aqui minutos depois de uma senha trocada na Vercel.
    await conferenciaEmail.conferirSeVencida();
    res.json({ tarefas: await execucoes.saude() });
  })
);

module.exports = router;

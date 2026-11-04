const { Router } = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../middlewares/errorHandler');
const { ipDoCliente } = require('../middlewares/rateLimit');
const telemetria = require('../services/telemetria.service');

const router = Router();

/**
 * Teto por cliente, só em memória: o IP serve para contar dentro da janela e nunca vai ao banco.
 *
 * É por instância (na Vercel, cada função tem o seu mapa), então não é um limite exato; é o que
 * basta, porque o que se escreve já é limitado por outras vias: os nomes vêm de listas fechadas,
 * cada contagem tem teto e o erro da tela tem o teto por minuto de `erro_aplicacao`. O limite só
 * impede que um único cliente faça a rota virar uma fonte de carga.
 */
const JANELA_MS = 60_000;
const MAX_POR_JANELA = Number(process.env.TELEMETRIA_MAX_POR_MINUTO) || 60;
const MAX_CLIENTES = 5000;
const clientes = new Map();

function limitarTelemetria(req, res, next) {
  const agora = Date.now();
  const ip = ipDoCliente(req);
  let janela = clientes.get(ip);
  if (!janela || agora - janela.inicio >= JANELA_MS) {
    // Mapa grande demais: recomeça. Perder a contagem de todos é melhor que crescer sem fim.
    if (clientes.size >= MAX_CLIENTES) clientes.clear();
    janela = { inicio: agora, n: 0 };
    clientes.set(ip, janela);
  }
  janela.n += 1;
  if (janela.n > MAX_POR_JANELA) {
    return next(new AppError('Muitos envios de uso. Tente de novo em instantes.', 429, 'LIMITE_DE_TELEMETRIA'));
  }
  return next();
}

// Sem login, de propósito: uma falha na tela de entrada também precisa chegar. Nada aqui diz quem é
// a pessoa (migração 031) e nada aqui age em nome de ninguém, por isso também não vale a trava de
// CSRF das escritas autenticadas (middlewares/auth.js): não há conta para um site de fora usar.
router.use(limitarTelemetria);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    await telemetria.registrar(req.body ?? {});
    res.status(204).end();
  })
);

router.post(
  '/erro',
  asyncHandler(async (req, res) => {
    await telemetria.registrarErroDaTela(req.body ?? {});
    res.status(202).json({ recebido: true });
  })
);

module.exports = router;

const authService = require('../services/auth.service');
const { asyncHandler } = require('../utils/asyncHandler');
const { registrarTentativa, ipDoCliente } = require('../middlewares/rateLimit');
const recuperacaoService = require('../services/recuperacao.service');

/**
 * O endereço do APP, que é para onde o link de redefinição leva.
 *
 * Antes isto era `${req.protocol}://${req.get('host')}` — o endereço de quem
 * respondeu à requisição, ou seja, a própria API. O e-mail saía com
 * `http://...-backend-....vercel.app/redefinir-senha`, e esse caminho não
 * existe na API: `/redefinir-senha` é uma rota do React, e o que a API expõe
 * é `POST /auth/redefinir-senha`, que é outra coisa. Quem clicava caía num
 * 404, e o único jeito de recuperar a senha ficava quebrado de ponta a ponta
 * — com o e-mail chegando certinho, o que torna o defeito mais difícil de
 * desconfiar, não menos.
 *
 * O `http` sem "s" vinha do mesmo lugar: atrás do proxy da Vercel o Express
 * só enxerga o `x-forwarded-proto` se `trust proxy` estiver ligado, e não
 * estava.
 *
 * `URL_APP` resolve os dois de uma vez, e é a única forma correta: front e
 * back são duas aplicações em domínios diferentes, então a API não tem como
 * deduzir o endereço do app a partir da requisição que recebeu. Sem a
 * variável, cai no endereço da requisição — que é o certo em
 * desenvolvimento, onde as duas coisas sobem na mesma máquina.
 */
function urlDoApp(req) {
  const configurada = String(process.env.URL_APP || '').trim();
  if (configurada) return configurada.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`.replace(/\/api$/, '');
}

const registrar = asyncHandler(async (req, res) => {
  const usuario = await authService.registrar(req.body);
  res.status(201).json({ usuario });
});

const login = asyncHandler(async (req, res) => {
  const ip = ipDoCliente(req);

  try {
    const resultado = await authService.login(req.body);
    await registrarTentativa(req.body.email, ip, true);
    res.json(resultado);
  } catch (err) {
    // Só conta como tentativa falha o que foi de fato credencial recusada.
    // Um erro de infraestrutura não é sinal de ataque e não deve empurrar
    // ninguém em direção ao bloqueio.
    if (err.code === 'CREDENCIAIS_INVALIDAS') {
      await registrarTentativa(req.body.email, ip, false);
    }
    throw err;
  }
});

/**
 * A resposta é sempre a mesma, exista ou não a conta. É o mesmo princípio do
 * login: um endpoint público que diferenciasse os casos viraria uma consulta
 * de "este e-mail tem cadastro?" aberta a qualquer um.
 */
const solicitarRecuperacao = asyncHandler(async (req, res) => {
  const pedido = await recuperacaoService.solicitar(req.body.email, ipDoCliente(req));

  if (pedido) {
    const urlBase = urlDoApp(req);
    const link = await recuperacaoService.enviarEmail(pedido, urlBase);

    // Sem SMTP configurado o e-mail vira log; registrar o link aqui é o que
    // mantém a funcionalidade utilizável em desenvolvimento e numa instalação
    // ainda sem servidor de e-mail.
    if (!require('../services/email.service').estaConfigurado()) {
      console.info(`[recuperacao] link gerado (SMTP ausente): ${link}`);
    }
  }

  res.json({
    mensagem:
      'Se houver uma conta ativa com este e-mail, enviamos um link de redefinição. Verifique sua caixa de entrada.',
  });
});

const redefinirSenha = asyncHandler(async (req, res) => {
  await recuperacaoService.redefinir(req.body.token, req.body.senha);
  res.json({ mensagem: 'Senha redefinida. Entre com a nova senha.' });
});

module.exports = { registrar, login, solicitarRecuperacao, redefinirSenha };

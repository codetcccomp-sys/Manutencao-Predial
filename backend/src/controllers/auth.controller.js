const authService = require('../services/auth.service');
const { asyncHandler } = require('../utils/asyncHandler');
const { registrarTentativa, ipDoCliente } = require('../middlewares/rateLimit');
const recuperacaoService = require('../services/recuperacao.service');

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
    const urlBase = `${req.protocol}://${req.get('host')}`.replace(/\/api$/, '');
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

const authService = require('../services/auth.service');
const { asyncHandler } = require('../utils/asyncHandler');
const { registrarTentativa, ipDoCliente } = require('../middlewares/rateLimit');
const recuperacaoService = require('../services/recuperacao.service');
const sessao = require('../services/sessao.service');

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
// Endereços em que o palpite pelo `Host` é seguro: são os de desenvolvimento,
// onde front e back sobem na mesma máquina.
const HOST_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function urlDoApp(req) {
  const configurada = String(process.env.URL_APP || '').trim();
  if (configurada) return configurada.replace(/\/+$/, '');

  // Sem `URL_APP`, a única pista disponível é o cabeçalho `Host` — e quem
  // escolhe esse cabeçalho é quem faz a requisição, não o servidor. Um pedido
  // com `Host: sitedoatacante.exemplo` e o e-mail da vítima faria o link de
  // redefinição apontar para o atacante, e o token da vítima chegaria por
  // e-mail num endereço que ele controla. O endpoint é público e não exige
  // autenticação nenhuma, então basta saber o e-mail de alguém.
  //
  // `trust proxy`, que este mesmo trabalho ligou para corrigir o `http://`,
  // torna isso pior: passa a confiar também no `X-Forwarded-Proto`.
  //
  // Por isso o palpite vale só para host local. Em qualquer outro caso, sem a
  // variável configurada, não há endereço em que confiar — e mandar um link
  // errado é pior que não mandar.
  const host = req.get('host') || '';
  return HOST_LOCAL.test(host) ? `${req.protocol}://${host}` : null;
}

const registrar = asyncHandler(async (req, res) => {
  const usuario = await authService.registrar(req.body);
  res.status(201).json({ usuario });
});

const login = asyncHandler(async (req, res) => {
  const ip = ipDoCliente(req);

  try {
    const resultado = await authService.login(req.body);

    // Senha certa com segundo fator ligado ainda não é login: não zera o
    // contador de falhas. Zerar aqui deixaria quem tem a senha roubada
    // recomeçar as tentativas de código a cada nova digitação da senha.
    if (resultado.requer2fa) {
      return res.json({ requer_2fa: true, desafio: resultado.desafio });
    }

    await registrarTentativa(req.body.email, ip, true);
    const token = sessao.emitir(res, req, resultado.conta);
    res.json({ token, usuario: resultado.usuario });
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

    if (urlBase) {
      const link = await recuperacaoService.enviarEmail(pedido, urlBase);

      // Sem SMTP configurado o e-mail vira log; registrar o link aqui é o que
      // mantém a funcionalidade utilizável em desenvolvimento e numa instalação
      // ainda sem servidor de e-mail.
      if (!require('../services/email.service').estaConfigurado()) {
        console.info(`[recuperacao] link gerado (SMTP ausente): ${link}`);
      }
    } else {
      // Configuração faltando, não erro de quem pediu. A resposta continua a
      // mesma de sempre — distinguir aqui contaria a qualquer um se o e-mail
      // tem cadastro —, mas o pedido é descartado para não ocupar vaga no
      // limite de pendentes por uma hora.
      console.error(
        `[recuperacao] URL_APP não configurada e o Host "${req.get('host')}" não é local; ` +
          'e-mail não enviado. Cadastre URL_APP com o endereço do app.'
      );
      await recuperacaoService.descartar(pedido.pedidoId);
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

const segundoFator = asyncHandler(async (req, res) => {
  const ip = ipDoCliente(req);
  const email = await authService.emailDoDesafio(req.body.desafio);

  try {
    const resultado = await authService.segundoFator(req.body);
    await registrarTentativa(email, ip, true);
    const token = sessao.emitir(res, req, resultado.conta);
    res.json({ token, usuario: resultado.usuario });
  } catch (err) {
    if (err.code === 'CODIGO_INVALIDO') await registrarTentativa(email, ip, false);
    throw err;
  }
});

// Sair não exige sessão válida: o cookie de uma sessão já expirada também
// precisa ser apagado.
const sair = asyncHandler(async (req, res) => {
  sessao.encerrar(res, req);
  res.status(204).send();
});

const sairDeTodos = asyncHandler(async (req, res) => {
  await sessao.revogarTodas(req.usuario.id);
  sessao.encerrar(res, req);
  res.status(204).send();
});

const situacao2fa = asyncHandler(async (req, res) => {
  res.json(await authService.situacao2fa(req.usuario.id));
});

const iniciar2fa = asyncHandler(async (req, res) => {
  res.json(await authService.iniciar2fa(req.usuario));
});

/**
 * Senha ou código errados nas telas da própria conta contam no limite do
 * login, pelo e-mail da conta. Sem isso, quem tivesse uma sessão alheia
 * chutaria o código de 6 dígitos sem freio para gerar códigos de recuperação
 * próprios — e a próxima entrada já não dependeria do celular da vítima.
 */
async function contandoFalhas(req, acao) {
  try {
    return await acao();
  } catch (err) {
    if (err.code === 'CODIGO_INVALIDO' || err.code === 'SENHA_INCORRETA') {
      await registrarTentativa(req.usuario.email, ipDoCliente(req), false);
    }
    throw err;
  }
}

// Ligar e desligar sobem a versão da sessão (as outras caem); esta, de quem
// fez a mudança, é reemitida para a pessoa não ser deslogada pelo próprio ato.
const ativar2fa = asyncHandler(async (req, res) => {
  const { conta, codigos } = await contandoFalhas(req, () => authService.ativar2fa(req.usuario.id, req.body));
  const token = sessao.emitir(res, req, conta);
  res.json({ codigos_recuperacao: codigos, ...sessao.tokenNoCorpo(req, token) });
});

const desativar2fa = asyncHandler(async (req, res) => {
  const conta = await contandoFalhas(req, () => authService.desativar2fa(req.usuario.id, req.body));
  const token = sessao.emitir(res, req, conta);
  res.json(sessao.tokenNoCorpo(req, token));
});

const novosCodigos = asyncHandler(async (req, res) => {
  const codigos = await contandoFalhas(req, () => authService.novosCodigos(req.usuario.id, req.body.codigo));
  res.json({ codigos_recuperacao: codigos });
});

module.exports = {
  registrar,
  login,
  segundoFator,
  sair,
  sairDeTodos,
  situacao2fa,
  iniciar2fa,
  ativar2fa,
  desativar2fa,
  novosCodigos,
  solicitarRecuperacao,
  redefinirSenha,
};

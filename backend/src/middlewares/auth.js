const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { AppError } = require('./errorHandler');
const { tokenDa, exigeCabecalhoCsrf } = require('../services/sessao.service');
const configuracaoService = require('../services/configuracao.service');

const PERFIS_DA_GESTAO = ['gestor', 'administrador'];

/**
 * Quem está pedindo, conferido no banco a cada requisição.
 *
 * Até aqui bastava a assinatura do JWT: o `payload` virava `req.usuario`
 * inteiro, perfil incluído. O token vale 8 horas, e durante esse tempo ele era
 * a verdade — não o banco. Três consequências, todas silenciosas:
 *
 * - **conta desativada continuava entrando** até o token expirar. Desligar
 *   alguém pela tela de Usuários não tirava o acesso de ninguém;
 * - **conta anonimizada a pedido também** — a pessoa pedia para sair, o
 *   administrador atendia, e a sessão aberta seguia listando e comentando
 *   chamados, agora assinados por "Usuário removido";
 * - **o perfil vinha do token**: um gestor rebaixado a solicitante continuava
 *   gestor por até 8 horas, e um técnico promovido não via a tela nova.
 *
 * O custo é uma consulta por requisição, por chave primária. A alternativa —
 * token curto com renovação — resolve o mesmo problema com mais peças móveis
 * e ainda deixa uma janela; esta não deixa nenhuma.
 *
 * O token continua provando QUEM é (a assinatura). O que a pessoa PODE fazer
 * vem do banco, que é onde a decisão de desligar, rebaixar ou anonimizar fica
 * registrada.
 *
 * Com a exigência ligada (configuração `exigir_2fa_gestao`), gestão sem a
 * verificação em duas etapas entra, mas só alcança a própria conta: as rotas
 * que ligam a verificação usam `authenticateSem2fa`; todas as outras recusam
 * com DOIS_FATORES_OBRIGATORIO, e a tela leva a pessoa para Minha conta.
 *
 * Recusar o login em vez disso trancaria para fora justamente quem precisa
 * entrar para ligar a verificação.
 */
function autenticar({ permitirSem2fa = false } = {}) {
  return async function authenticate(req, res, next) {
    const recebido = tokenDa(req);

    if (!recebido) {
      return next(new AppError('Token de autenticação não informado.', 401));
    }

    // Escrita autenticada só pelo cookie precisa do cabeçalho próprio da tela:
    // é o que um formulário de outro site não consegue mandar (ver
    // sessao.service).
    if (exigeCabecalhoCsrf(req, recebido.origem)) {
      return next(new AppError('Requisição sem a origem esperada.', 403, 'CSRF'));
    }

    let payload;
    try {
      payload = jwt.verify(recebido.token, process.env.JWT_SECRET);
    } catch (err) {
      return next(new AppError('Token inválido ou expirado.', 401));
    }

    // O desafio do segundo fator é um token assinado pela mesma chave, mas não
    // é sessão: ele só serve para POST /auth/login/2fa.
    if (payload.tipo) {
      return next(new AppError('Token inválido ou expirado.', 401));
    }

    try {
      const { rows } = await pool.query(
        `SELECT id, nome, email, perfil, ativo, anonimizado_em, sessao_versao,
                totp_ativado_em IS NOT NULL AS tem_2fa
           FROM usuario WHERE id = $1`,
        [payload.id]
      );
      const conta = rows[0];

      // Mesma resposta para os quatro casos. Dizer "sua conta foi desativada" a
      // quem apresenta um token contaria a um token vazado o que aconteceu com
      // a conta; o que a pessoa legítima precisa saber é entrar de novo.
      //
      // A versão é o que torna a sessão revogável: trocar a senha ou pedir
      // "sair de todos os aparelhos" sobe a versão, e todo token emitido antes
      // deixa de valer na hora — não em 8 horas. Token sem versão (emitido
      // antes desta mudança) conta como versão 0, que é a de todo mundo que
      // ainda não revogou nada.
      if (!conta || !conta.ativo || conta.anonimizado_em || (payload.sv ?? 0) !== conta.sessao_versao) {
        return next(new AppError('Sessão encerrada. Entre novamente.', 401, 'SESSAO_ENCERRADA'));
      }

      // A configuração só é lida para quem ela pode alcançar: gestão sem a
      // verificação. Para o resto, continua uma consulta por requisição.
      const pendente2fa =
        PERFIS_DA_GESTAO.includes(conta.perfil) && !conta.tem_2fa && (await configuracaoService.exige2faGestao());
      if (pendente2fa && !permitirSem2fa) {
        return next(
          new AppError(
            'A administração exige a verificação em duas etapas para o seu perfil. Ligue em Minha conta para continuar.',
            403,
            'DOIS_FATORES_OBRIGATORIO'
          )
        );
      }

      req.usuario = { id: conta.id, nome: conta.nome, email: conta.email, perfil: conta.perfil };
      // Cookie ou cabeçalho: decide se uma sessão reemitida pode voltar no
      // corpo da resposta (ver sessao.service, `tokenNoCorpo`).
      req.origemDaSessao = recebido.origem;
      next();
    } catch (err) {
      // Banco fora do ar não é "token inválido": responder 401 aqui mandaria o
      // navegador deslogar todo mundo por uma falha que não é de ninguém.
      next(err);
    }
  };
}

const authenticate = autenticar();
const authenticateSem2fa = autenticar({ permitirSem2fa: true });

function authorize(...perfisPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return next(new AppError('Usuário não autenticado.', 401));
    }
    if (!perfisPermitidos.includes(req.usuario.perfil)) {
      return next(new AppError('Acesso negado para o seu perfil.', 403));
    }
    next();
  };
}

module.exports = { authenticate, authenticateSem2fa, authorize, PERFIS_DA_GESTAO };

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { errorHandler, AppError } = require('./middlewares/errorHandler');
const { NOME_SISTEMA } = require('./config/marca');

const app = express();

// Atrás do proxy da Vercel, sem isto, `req.protocol` responde "http" mesmo
// numa conexão HTTPS: o Express ignora o `x-forwarded-proto` até que se diga
// em quem confiar. O sintoma foi um link de redefinição de senha saindo por
// e-mail com `http://`.
app.set('trust proxy', 1);

/**
 * De onde o navegador pode chamar esta API.
 *
 * A regra anterior era um regex só, exigindo o sufixo `-tec-code` — o nome que
 * a Vercel dá aos deploys da equipe. Isso deixava de fora, sem ninguém notar,
 * o endereço mais curto que a própria Vercel também atribui ao projeto:
 * `manutencao-predial-frontend.vercel.app` batia na API e era recusado. Abrir
 * o sistema por ele dava tela de login que não loga.
 *
 * Agora são duas coisas separadas, e é essa separação que evita a repetição:
 *
 * - `DOMINIOS_FIXOS`: os endereços estáveis. Endereço novo entra AQUI, numa
 *   linha, e é o que faltou quando `conserva-predial.vercel.app` foi
 *   acrescentado ao projeto.
 * - `PREVIEW_VERCEL`: os deploys de branch, cujo nome é gerado e não dá para
 *   listar um a um.
 */
const DOMINIOS_FIXOS = [
  'https://conserva-predial.vercel.app',
  'https://manutencao-predial-frontend.vercel.app',
  'https://manutencao-predial-frontend-tec-code.vercel.app',
  'http://localhost:5173',
  // O `vite preview`, que serve a build. É por ele que os testes de ponta a
  // ponta rodam: testar o servidor de desenvolvimento deixaria de fora tudo
  // que só aparece depois do empacotamento.
  'http://localhost:4173',
];

// Deploy de branch e de commit: `...-frontend-<hash>-tec-code.vercel.app` e
// `...-frontend-git-<branch>-tec-code.vercel.app`.
const PREVIEW_VERCEL =
  /^https:\/\/manutencao-predial-frontend-[a-z0-9-]+-tec-code\.vercel\.app$/;

function origemPermitida(origin) {
  // Sem `Origin` é chamada que não veio de navegador — o agendador do RF08,
  // um curl, um teste. O CORS não é o controle de acesso dessas: quem manda
  // nelas é o token, e é assim que o cron funciona.
  if (!origin) return true;
  return DOMINIOS_FIXOS.includes(origin) || PREVIEW_VERCEL.test(origin);
}

// Cabeçalhos de segurança (nosniff, HSTS, frame-ancestors, sem X-Powered-By…).
// Antes do CORS, para valerem também nas respostas de recusa. Os padrões do
// helmet servem a uma API que só devolve JSON: a CSP padrão (`default-src
// 'self'`) não atrapalha nada que este servidor responde, e o
// `Cross-Origin-Resource-Policy: same-origin` não se aplica às chamadas do
// frontend, que passam pelo CORS. A CSP da interface vive em frontend/vercel.json.
app.use(helmet());

app.use(
  cors({
    origin(origin, callback) {
      if (origemPermitida(origin)) return callback(null, true);

      // Um `new Error` cru aqui vira 500 com "Erro interno no servidor." — a
      // resposta mentia sobre o que tinha acontecido. Quem via a tela ia
      // procurar banco caído e servidor quebrado, enquanto a API estava
      // perfeitamente de pé e apenas recusando a origem. Agora diz o que é.
      // A pista de conserto vai para o log, não para a resposta: o nome do
      // arquivo e o da constante são detalhe de dentro, e a resposta de um
      // endpoint público não é lugar de contá-los. Quem precisa da instrução
      // é quem opera o servidor, e essa pessoa lê o log.
      console.error(
        `[cors] origem recusada: ${origin}. Cadastre-a em DOMINIOS_FIXOS, em backend/src/app.js.`
      );
      callback(new AppError('Origem não permitida.', 403, 'ORIGEM_NAO_PERMITIDA'));
    },
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', servico: `${NOME_SISTEMA} — API` });
});

// Checagem que realmente exercita o banco: /health sozinho responde "ok" mesmo
// com o banco inacessível, o que esconde falha de credencial, de rede ou de SSL.
//
// A consulta lê uma tabela de verdade, e não apenas now(): conexão aberta não
// significa acesso concedido. Um SELECT de relógio passaria igual se o papel
// da aplicação perdesse privilégio sobre o schema — que é exatamente o tipo de
// falha que este endpoint existe para revelar.
app.get('/health/db', async (req, res) => {
  try {
    const { rows } = await require('./config/db').query(
      'SELECT now() AS agora, (SELECT count(*) FROM categoria) AS categorias'
    );
    res.json({
      status: 'ok',
      banco: 'conectado',
      agora: rows[0].agora,
      categorias: Number(rows[0].categorias),
    });
  } catch (err) {
    // O motivo vai para o log, não para a resposta. Esta rota é pública, e a
    // mensagem do driver carrega host, porta, usuário do banco e o tipo de
    // falha de autenticação — o mapa que alguém de fora usaria para mirar no
    // banco. Quem opera o servidor lê o log; quem monitora de fora só precisa
    // saber que está fora.
    console.error('[health/db] banco indisponível:', err.message);
    res.status(503).json({ status: 'erro', banco: 'indisponivel' });
  }
});

app.use('/auth', require('./routes/auth.routes'));
app.use('/chamados', require('./routes/chamados.routes'));
app.use('/usuarios', require('./routes/usuarios.routes'));
app.use('/locais', require('./routes/locais.routes'));
app.use('/equipamentos', require('./routes/equipamentos.routes'));
app.use('/planos-preventivos', require('./routes/planos.routes'));
app.use('/categorias', require('./routes/categorias.routes'));
app.use('/equipes', require('./routes/equipes.routes'));
app.use('/materiais', require('./routes/materiais.routes'));
app.use('/relatorios', require('./routes/relatorios.routes'));
app.use('/notificacoes', require('./routes/notificacoes.routes'));
app.use('/sla', require('./routes/sla.routes'));
app.use('/regras-priorizacao', require('./routes/priorizacao.routes'));
app.use('/tarefas', require('./routes/tarefas.routes'));
app.use('/operacao', require('./routes/operacao.routes'));

app.use((req, res) => {
  res.status(404).json({ erro: { mensagem: 'Rota não encontrada.' } });
});

app.use(errorHandler);

module.exports = app;

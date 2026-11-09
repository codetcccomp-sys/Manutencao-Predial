const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { errorHandler, AppError } = require('./middlewares/errorHandler');
const { NOME_SISTEMA } = require('./config/marca');
const { idsInteiros, consultaSimples, semCaractereNulo } = require('./middlewares/entrada');

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

// Origens que quem opera a instalação acrescenta pelo ambiente, sem tocar no
// código: a demonstração publicada tem site próprio, e o endereço dela não deve
// entrar na lista que vale para a produção. Uma origem por item, separadas por
// vírgula, e o casamento é exato — não há padrão nem curinga aqui, de propósito.
// Lida a cada chamada, e não ao carregar o módulo, para o teste poder ligá-la.
function origensExtras() {
  return String(process.env.ORIGENS_EXTRAS || '')
    .split(',')
    .map((origem) => origem.trim());
}

function origemPermitida(origin) {
  // Sem `Origin` é chamada que não veio de navegador — o agendador do RF08,
  // um curl, um teste. O CORS não é o controle de acesso dessas: quem manda
  // nelas é o token, e é assim que o cron funciona.
  if (!origin) return true;
  return (
    DOMINIOS_FIXOS.includes(origin) || PREVIEW_VERCEL.test(origin) || origensExtras().includes(origin)
  );
}

// Cabeçalhos de segurança (nosniff, HSTS, frame-ancestors, sem X-Powered-By…).
// Antes do CORS, para valerem também nas respostas de recusa. Os padrões do
// helmet servem a uma API que só devolve JSON: a CSP padrão (`default-src
// 'self'`) não atrapalha nada que este servidor responde, e o
// `Cross-Origin-Resource-Policy: same-origin` não se aplica às chamadas do
// frontend, que passam pelo CORS. A CSP da interface vive em frontend/vercel.json.
app.use(helmet());

// Comprime o JSON das listas (RNF03). Medido no volume de teste: a lista de locais com
// os inativos (2.000 linhas) vai de 245 kB para 13 kB em gzip e a de contas (305), de 65 kB
// para 3 kB; em 4G lento, só o tempo de baixar a primeira passava de 3 s. Fica antes do CORS
// e das rotas para valer para todas. Abaixo de 1 kB (padrão da biblioteca) não comprime, e
// quem não manda Accept-Encoding recebe como antes. É aqui, e não na borda, porque a API
// não deve depender de a Vercel decidir comprimir: ela só garante o que está no código.
app.use(compression());

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
        `[cors] origem recusada: ${origin}. Cadastre-a em DOMINIOS_FIXOS, em backend/src/app.js ` +
          '(ou, numa instalação à parte, em ORIGENS_EXTRAS).'
      );
      callback(new AppError('Origem não permitida.', 403, 'ORIGEM_NAO_PERMITIDA'));
    },
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Filtro de consulta repetido ou aninhado é recusado antes de chegar a qualquer rota.
app.use(consultaSimples);
app.use(semCaractereNulo);

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
    // `demonstracao` sai do BANCO que esta API de fato usa, e não de uma
    // variável de ambiente: quem semeia dados de demonstração pela API confere
    // aqui, antes de escrever, que ela está ligada ao banco marcado como
    // descartável (database/guarda-demonstracao.js). Uma variável diria "demo"
    // mesmo com a URL do banco de produção colada por engano.
    const { rows } = await require('./config/db').query(
      `SELECT now() AS agora,
              (SELECT count(*) FROM categoria) AS categorias,
              coalesce((SELECT valor = 'true'::jsonb FROM configuracao WHERE chave = 'ambiente_demonstracao'), FALSE)
                AS demonstracao`
    );
    res.json({
      status: 'ok',
      banco: 'conectado',
      agora: rows[0].agora,
      categorias: Number(rows[0].categorias),
      demonstracao: rows[0].demonstracao,
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

// Todo roteador passa por `idsInteiros`: `/chamados/abc` responde 404 em vez de
// chegar ao banco e voltar como erro interno (middlewares/entrada.js).
const montar = (caminho, arquivo) => app.use(caminho, idsInteiros(require(arquivo)));
montar('/auth', './routes/auth.routes');
montar('/chamados', './routes/chamados.routes');
montar('/usuarios', './routes/usuarios.routes');
montar('/locais', './routes/locais.routes');
montar('/equipamentos', './routes/equipamentos.routes');
montar('/planos-preventivos', './routes/planos.routes');
montar('/categorias', './routes/categorias.routes');
montar('/equipes', './routes/equipes.routes');
montar('/materiais', './routes/materiais.routes');
montar('/relatorios', './routes/relatorios.routes');
montar('/notificacoes', './routes/notificacoes.routes');
montar('/sla', './routes/sla.routes');
montar('/regras-priorizacao', './routes/priorizacao.routes');
montar('/regras-distribuicao', './routes/distribuicao.routes');
montar('/configuracoes', './routes/configuracao.routes');
montar('/tarefas', './routes/tarefas.routes');
montar('/operacao', './routes/operacao.routes');
montar('/telemetria', './routes/telemetria.routes');

app.use((req, res) => {
  res.status(404).json({ erro: { mensagem: 'Rota não encontrada.' } });
});

app.use(errorHandler);

module.exports = app;

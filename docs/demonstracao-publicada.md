# Demonstração publicada

Uma cópia do sistema, no ar, com **dados fictícios**, para apresentar e deixar as
pessoas experimentarem sem encostar na produção. Tem site, API e banco próprios;
nada é compartilhado com a produção — nem o banco, nem os segredos.

| Peça | Onde | Endereço |
| --- | --- | --- |
| Site | Vercel, projeto `conserva-predial-demo` (`prj_tiAGeT3OPZMBBDATXjaMl44vzMtV`), pasta `demo/frontend` | https://conserva-predial-demo.vercel.app |
| API | Vercel, projeto `conserva-predial-demo-api` (`prj_v75bgKfi6OeUCaLOKCYdrS2yrFjT`), pasta `backend` | https://conserva-predial-demo-api.vercel.app |
| Banco | Supabase, projeto **só da demonstração**, em São Paulo (`sa-east-1`) | — |

Os dois projetos da Vercel acompanham a `main`. O site é a mesma build do
`frontend/`; o que muda é o `demo/frontend/vercel.json` (o `/api` aponta para a API
da demonstração) e a variável `VITE_AMBIENTE=demonstracao`, que liga a faixa
"Ambiente de demonstração" em todas as telas. Um teste
(`frontend/testes/vercelDemonstracao.test.js`) impede que o `/api` do site da demo
aponte para a produção e que a política de segurança diverja da dela.

## O que só você pode fazer

Senhas e chaves não passam por chat, commit nem log. São **cinco colagens** e a
criação do banco, nesta ordem.

### 1. O banco (Supabase)

Crie um projeto **novo, só para a demonstração**, na região **South America (São
Paulo)**: o aviso de privacidade promete São Paulo, e a API fica em `gru1`, perto
dele. Anote a senha do banco num gerenciador de senhas.

> O plano Free permite dois projetos ativos, e a produção é um. O outro projeto da
> conta ("codetcccomp-sys's Project", `gdlhhkqfgcgmrvpokeuw`, também em São Paulo) está
> pausado e, segundo o `docs/piloto.md`, vazio: pode ser restaurado em vez de criar um
> terceiro. Se tiver dado dentro, a trava (abaixo) recusa e você cria um novo.

Em **Connect**, copie duas strings do mesmo projeto (troque `[YOUR-PASSWORD]` pela
senha do banco):

- **Session pooler** (porta **5432**) — vai para o GitHub (`DEMO_DATABASE_URL`);
- **Transaction pooler** (porta **6543**) — vai para a Vercel (`DATABASE_URL`).

> ⚠️ **Confira que não é o projeto da produção** (`manutencao-predial-prod`). A trava
> do passo 3 recusa o da produção pelo endereço, mas é bem mais simples acertar aqui.

### 2. A API (Vercel → `conserva-predial-demo-api` → Settings → Environment Variables)

Marque **Sensitive** e o ambiente **Production** nas três:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | a string do **Transaction pooler** (6543) |
| `JWT_SECRET` | **um valor novo**: `openssl rand -hex 32` |
| `CRON_SECRET` | **outro valor novo**: `openssl rand -hex 32` |

> 🔴 **Nunca copie `JWT_SECRET` nem `CRON_SECRET` da produção.** O token de sessão
> carrega só `{id, sv}`. Se a demonstração assinasse com a chave da produção, qualquer
> pessoa que se cadastrasse na demo teria um token que a API de produção também aceita
> — e o administrador de lá tem um `id` baixo (3), que numa demonstração nova
> qualquer cadastro pode receber.

Já estão cadastradas por mim, e não são segredo: `ORIGENS_EXTRAS` (o site da demo, para
o CORS) e `URL_APP`. Deixe `SMTP_*` **em branco**: a demonstração não envia e-mail (o
código tolera a ausência; é o mesmo caminho do desenvolvimento).

### 3. O GitHub (repositório → Settings → Secrets and variables → Actions → New repository secret)

| Segredo | Valor |
| --- | --- |
| `DEMO_DATABASE_URL` | a string do **Session pooler** (5432) do banco da demonstração |
| `DEMO_ADMIN_SENHA` | a senha do administrador da demo — **só você** a usa, e diferente de qualquer outra |
| `DEMO_SENHA` | a senha das contas de exemplo — esta você entrega a quem for experimentar. Ao menos 10 caracteres e fora das senhas comuns (uma frase serve): o semeador cria as contas pela API, que recusa as fracas |

### 4. Rodar

1. **Actions → Demonstração publicada → Run workflow** (deixe "semear" marcado). Ele
   aplica a trava, migra, marca o banco como de demonstração, cria o administrador
   `admin@conserva.demo`, semeia as contas e os chamados de exemplo pela API e
   espalha as datas.
2. **Redeploy da API**: variável de ambiente só vale para deploys novos. Em
   `conserva-predial-demo-api` → Deployments → o último → Redeploy. (Se o semeador
   falhar por a API ainda não ter a chave do banco, é isto: redeploy e rode de novo.)
3. Confira: `https://conserva-predial-demo-api.vercel.app/health/db` deve responder
   `"banco":"conectado"` e `"demonstracao":true`.
4. Abra `https://conserva-predial-demo.vercel.app` e entre.

### 5. Ligar a conferência pós-deploy da demo

Depois que a demo responder, crie a variável do repositório `CONFERIR_DEMONSTRACAO` com o valor `sim`
(Settings → Secrets and variables → Actions → **Variables**). A partir daí o workflow
`Conferência pós-deploy` chama a API da demo a cada deploy dela e todo dia às 07:41: `/health/db` tem
de responder com o banco conectado e `demonstracao: true`, e nenhum roteador pode dar 5xx (sem
`CRON_SECRET`, `/tarefas` responde 503 e a conferência acusa). Sem a variável, só a produção é
conferida: em 12/11/2026 a API da demo ainda estava sem `DATABASE_URL` e sem `CRON_SECRET`.

## O que as travas garantem

- **O banco de produção nunca é semeado.** `backend/database/guarda-demonstracao.js`
  recusa qualquer endereço com a referência da produção; recusa banco que já tenha
  conta ou chamado e não carregue a marca `ambiente_demonstracao`; e só grava a marca
  num banco **vazio**. Quem escreve a marca é esse script, nunca o semeador.
- **O semeador só escreve numa API que se diz de demonstração.** Antes de criar
  qualquer coisa, `frontend/video/semear.mjs` pergunta a `/health/db`, que lê a marca
  do **banco** da API (uma variável de ambiente não serviria: diria "demo" com a URL
  da produção colada ao lado). Recusa também os endereços da produção e não tem senha
  padrão fora do banco local.
- **O agendador não abre para a internet.** Sem `CRON_SECRET` a rota `/tarefas`
  responde 503; com segredo errado, 401 (`backend/src/middlewares/cron.js`).

## Para quem for experimentar

As contas de exemplo (todas com a senha `DEMO_SENHA`) são públicas por natureza:

| Perfil | E-mail |
| --- | --- |
| Gestora | `ana.ribeiro@conserva.demo` |
| Técnicos | `paulo.tavares@`, `carlos.menezes@`, `rita.alencar@conserva.demo` |
| Solicitantes | `jorge.pacheco@`, `marta.coelho@`, `lucia.fontes@`, `sergio.vasques@conserva.demo` |

O cadastro público continua aberto (cria solicitante) e qualquer um pode abrir
chamado: a faixa avisa que os dados são fictícios e podem ser apagados. O
**administrador** (`admin@conserva.demo`) não é para distribuir — com ele se liga a
exigência de 2FA e se desativam as contas de exemplo.

## Na véspera da apresentação

O que foi semeado em outubro parece quebrado em dezembro: chamados abertos há semanas,
tudo em atraso, alerta de crítico em toda parte. Recomece:

1. No **SQL Editor do projeto da demonstração** (confira o nome do projeto no canto),
   cole o conteúdo de `backend/database/reiniciar-demonstracao.sql` e rode. Ele só
   apaga o banco se estiver marcado como de demonstração; na produção, recusa.
2. **Actions → Demonstração publicada → Run workflow.**
3. Confira `/health/db` e entre com uma conta de exemplo.

Os planos preventivos da demonstração geram chamados pelo agendador diário
(06:00 UTC); a tela de Preventiva tem o botão "Gerar agora" para mostrar ao vivo.

## Cuidados

- **O Supabase Free pausa o projeto após cerca de uma semana sem atividade**
  (`docs/piloto.md` §2.3.1). O agendador diário da demonstração faz uma consulta por
  dia, o que costuma bastar; confira o painel na semana da apresentação. Pausado, o
  Restore do painel o traz de volta.
- **O primeiro deploy da API, antes das três variáveis, sai sem banco e sem login.** É
  esperado: ela sobe, mas `/health/db` responde 503 e o login dá erro (sem
  `JWT_SECRET` ela não assina nem aceita token). Resolve-se no passo 4.2.
- **A API herda o `backend/vercel.json`**, inclusive o cron diário. Se a Vercel recusar
  o deploy por limite de crons do plano, é essa a causa.
- **A demonstração não é a produção.** Mudança de código chega nas duas (as duas
  seguem a `main`); a diferença está só no que está listado aqui. Endereço de site
  novo da demonstração entra em `ORIGENS_EXTRAS` e em `demo/frontend/vercel.json`.

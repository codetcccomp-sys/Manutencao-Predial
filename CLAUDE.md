# Conserva Predial — guia para quem mexe no código

Sistema de chamados de manutenção predial. API Express + PostgreSQL (`backend/`)
e PWA React/Vite (`frontend/`), publicados na Vercel, com o banco no Supabase.
O README tem o detalhe de cada área; este arquivo diz o que não se descobre
sem ler tudo, e o que **não** existe.

## Stack (a de verdade)

- **Backend**: Node 22 e 24 (`engines`; o CI testa as duas, e a Vercel roda 24), Express, `pg` com SQL cru. **Não há ORM nem Prisma.**
  O schema vive em `backend/database/migrations/NNN_*.sql`, aplicado por
  `database/migrate.js`.
- **Frontend**: React, Vite, Tailwind, React Router. **É PWA, não React
  Native**: nada de WatermelonDB; armazenamento local, se vier, é IndexedDB.
- **Testes**: Jest + Supertest (backend), Vitest + Testing Library (componentes),
  Playwright (ponta a ponta, projetos `computador` e `celular`; `firefox` só com `E2E_FIREFOX=1` e `edge`
  (Microsoft Edge de verdade) só com `E2E_EDGE=1`, cada um no seu job do CI: `npm run e2e:firefox`, `npm run e2e:edge`).
- **Segurança**: sessão em cookie HttpOnly, 2FA por TOTP, CSP estrita
  (`style-src 'self'`: estilo escrito como texto no HTML é bloqueado).

## Comandos

```bash
# Backend (cd backend)
npm ci
npm run dev                      # http://localhost:3333
npm run migrate                  # aplica as pendentes
npm run migrate -- --status      # lista aplicadas e pendentes
npm test                         # toda a suíte, em série (usa o banco do .env)
npm run test:sla                 # só prazo, horas úteis e atraso
node tests/mutacao.js [texto]    # teste de mutação; filtra pela descrição

# Frontend (cd frontend)
npm ci
npm run dev                      # http://localhost:5173
npm test                         # Vitest
npm run build
npm run e2e                      # sobe API (3333) e preview (4173) sozinho
npm run mutacao -- [vitest|playwright|todas] [texto]
```

O e2e precisa das variáveis `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
`DB_PASSWORD`, `E2E_ADMIN_EMAIL` e `E2E_ADMIN_SENHA` (o administrador sai de
`node database/semear-admin.js`), e de `PLAYWRIGHT_CHROMIUM` quando o Chromium
já existe na máquina. Os valores do CI estão em `.github/workflows/ci.yml`.

Não existe `prisma:validate`. A validação do schema é o próprio `npm run migrate`
num banco limpo, mais `backend/tests/migracoes.test.js`.

## Regras de negócio como estão implementadas

- **Prioridade**: enum `baixa | media | alta | critica`. Sai da regra de
  priorização vigente (urgência, impacto e risco — `priorizacao.service`); a
  gestão pode divergir com justificativa. **Na abertura o solicitante não escolhe
  a prioridade**: responde três perguntas de situação (`dominio/situacao.js`) e o
  servidor calcula (`prioridadeNaAbertura` em `chamados.service`). A `prioridade`
  enviada por solicitante é ignorada, não recusada (aba com PWA antigo); a da regra
  de distribuição é o **mínimo**; sem informação nenhuma o chamado nasce `media`, não
  `baixa`.
- **Prazo (SLA)**: mora na tabela `sla` (`prazo_horas` e `contagem`, corridas ou
  úteis), nunca em constante no código. O valor vigente em produção veio da
  folha de validação da instituição: ver `docs/piloto.md` §2.4. Mudar o SLA só
  afeta chamados novos (o prazo é calculado na abertura).
- **Estados do chamado**: `aberto → em_triagem → atribuido → em_andamento ↔
  aguardando_material → concluido`, e `cancelado` (só a gestão cancela).
- **Conclusão** exige a descrição do serviço (RN07) **e a confirmação de uso de
  EPI** (`epi_confirmado: true`, gravada com quem e quando). Vale também para a
  preventiva. A reabertura zera a do chamado; a anterior fica na linha do tempo.
- **Aderência ao Termo v1.2** (`backend/tests/aderenciaAoTermo.test.js`): chamado atribuído **só à equipe**
  é de todos os técnicos dela (fila, detalhe e aviso) até alguém **iniciar**, que é assumir (RN06); **aguardando
  material exige o motivo** de 10+ caracteres (RN08); **depois de 48 h só a gestão reabre**, e o histórico
  diz que foi fora da janela (RN05). O solicitante não reabre fora da janela.
- **Alerta de primeiro atendimento**: chamado `critica`, `corretiva` e ainda em
  `aberto` há mais de 15 min aparece como alerta para a gestão (`sem_atendimento_critico`,
  calculado na consulta como `em_atraso`; faixa no Layout, selo no cartão, aviso
  no chamado). "Atendido" é sair de `aberto`. O 15 é a constante de
  `backend/src/config/atendimento.js`, não uma coluna de `sla`. **Também avisa fora da tela**:
  a passagem de 15 min do agendador (`/tarefas/notificar-atrasos`) manda sino e e-mail à gestão
  ativa, uma vez por chamado (`criticos.service`, `chamado.critico_notificado_em`, migração 030).
  O e-mail sai da conta do Gmail dos demais avisos; trocar por domínio da instituição é do dono.
- **Anexos**: até 10 por chamado por padrão; a administração define de 1 a 20 na tela de Usuários (RF03,
  configuração `anexos_por_chamado`; o teto é de `config/anexos.js`). 422 `LIMITE_DE_ANEXOS`, conferido sob
  cadeado por chamado, e aviso à gestão aos 70% do banco (`GET /operacao/armazenamento`).
  Ligar o Storage é decisão e ação do dono (chave de serviço), nunca de código.
- **Cadastro público**: `POST /auth/registrar` responde 202 com o mesmo corpo para e-mail novo e
  repetido (não devolve conta nem token; o 409 é só da administração), tem teto por IP e por dia
  (`rateLimit.limitarCadastro`, tabela `tentativa_cadastro`, migração 029) e exige senha nova de 10+
  caracteres fora da lista de comuns (`utils/senha.js`). Teste que cria conta pela API não precisa de
  nada: `tests/apoio/ambiente.js` abre o teto; só `cadastroSeguro.test.js` o aperta. Senha de teste
  tem de ter 10+ caracteres e não ser comum (`senha-teste-123`, não `senha123`).
- **Avaliação (RF09)**: avaliar **é** confirmar a solução; quem discorda reabre. `nota` inteira de 1 a 5 e
  `comentario` opcional (até 1000). A confirmação entra na linha do tempo (sem o texto do comentário) e volta em
  `chamado.avaliacao`, só enquanto o chamado está `concluido`. Uma por chamado; reenviar troca e atualiza a data.
- **Versões do SLA (RN12)**: toda alteração por `sla.service.atualizar` grava uma linha em `sla_versao` (migração
  032: prazo, régua, vigência, autor). **`UPDATE sla` por SQL direto não deixa versão**: na produção, altere pela
  tela. A migração só vale lá depois de `npm run migrate`; antes disso o prazo muda e o histórico fica vazio.
- **Materiais (RF07)**: o técnico designado (ou a gestão) lança na tela do chamado, escolhendo do catálogo
  (Cadastros › Materiais, sem nome repetido). Só com o atendimento aberto: concluído ou cancelado recusa (409), e
  quem precisa corrigir reabre. Lançar, corrigir e retirar entram na linha do tempo, com quem fez. A API existia
  sem tela até 13/11/2026: o teste de API passava e ninguém conseguia lançar (`e2e/materiais.spec.js` impede a volta).
- **Equipamento**: tem só `ativo BOOLEAN`.
- **Sem conexão**: o service worker guarda as *leituras* (fila e chamado). Escrita
  falha na hora e a tela diz que nada foi registrado. É decisão deliberada
  (ver o cabeçalho de `frontend/public/sw.js`): sincronizar depois exigiria
  resolver conflito, e conflito mal resolvido vira registro de manutenção falso.

### Diretrizes recebidas e ainda não implementadas

Dependem de decisão do dono do projeto antes de qualquer código:

- Enum de ciclo de vida do ativo (`ATIVO`, `EM_MANUTENCAO`, `DEPRECIADO`,
  `DESCARTADO`) no lugar de `ativo BOOLEAN`. Sugestão: `EM_MANUTENCAO` derivado
  dos chamados abertos, não gravado.
- Fila local de escritas offline. Sugestão: só ações que apenas acrescentam
  (comentários), nunca mudança de estado.

## Convenções do repositório

- Comentário explica o **porquê**, em português, e cita a regra (RN07, RF04…).
- Toda trava nova ganha teste **e** mutação em `tests/mutacao.js` ou
  `testes/mutacao.mjs`. Mutação que passa despercebida é teste decorativo.
  Mexeu num trecho que uma mutação cita? Atualize o `de` dela: `mutacoesEmDia.test.js`
  (backend e frontend) falha o CI com mutação desatualizada.
- **Entrada malformada é 4xx, nunca 500** (`middlewares/entrada.js`): roteador novo entra em `app.js` por
  `montar` (confere `:id` e afins); campo inteiro no corpo é `tipo: 'inteiro'` (`'number'` só com casa decimal);
  filtro de consulta numérico ou de lista usa `filtroInteiro`/`filtroDeLista`. Todo 5xx vai para o painel de
  erros do administrador: não pode ser provocado por endereço digitado errado.
- **`require` do backend é sempre literal** (`require('./x')`, nunca `require(variavel)`): a Vercel só empacota o que
  enxerga de forma estática. Com variável, os testes passam (o arquivo está no disco) e a função publicada responde
  500 em tudo com "Cannot find module" (10/11/2026, PR #102). `tests/empacotamento.test.js` confere.
- **Depois de cada deploy, a API publicada é chamada** (`.github/workflows/publicacao.yml`, no aviso de deploy da
  Vercel e todo dia às 07:41 de Brasília): `/health`, `/health/db` e cada roteador de `app.js` abaixo de 500, na
  produção e, com a variável `CONFERIR_DEMONSTRACAO = sim`, na demo (`scripts/conferir-publicacao.js`; endereços
  lidos dos `vercel.json`). Com o segredo `CRON_SECRET` no GitHub (o mesmo da Vercel), confere também as tarefas
  agendadas em `/tarefas/saude`: o aviso de atraso ficou parado de 09/11/2026 em diante sem ninguém ver. Falhou, o GitHub manda e-mail. Não desfaz o deploy sozinho: o rollback na Vercel é decisão de quem administra.
- Migração nova é aditiva e roda inteira numa transação. Em produção aplica-se
  pelo mesmo `migrate`, nunca colando SQL sem registrar em `migracao`; faça antes
  um ensaio com `BEGIN … ROLLBACK`.
- Teste novo entra em `docs/matriz-de-testes.md`, numa linha da seção da regra que ele
  prova (arquivo e título exato) ou na tabela "Outras suítes". O
  `backend/tests/matrizDeTestes.test.js` falha se a matriz citar o que não existe ou
  deixar um arquivo de teste de fora.
- As suítes do backend criam contas `@exemplo.com` e o teardown global as
  apaga. Teste que deixa chamado com data no passado **polui as médias** das
  suítes de relatório: apague o que criar, ou volte as datas juntas.
- **Dia é dia de Brasília, não de UTC.** O servidor e o banco rodam em UTC, e das
  21h à meia-noite em Brasília já é o dia seguinte lá (00h–03h UTC). Filtro por
  dia em coluna de instante usa `AT TIME ZONE` com `config/fuso.js`, nunca
  `::date` solto. Teste que depende de "hoje" só se prova num banco **vazio**
  e nessa janela: o banco de desenvolvimento, cheio de dados antigos, esconde o
  defeito, e o do CI, que nasce vazio, o mostra.
- O aviso de privacidade (`frontend/src/pages/Privacidade.jsx`) e `docs/lgpd.md`
  andam juntos: a página descreve o que o sistema faz. Mudou dado guardado, prazo,
  hospedagem ou contato? Mude os dois. Não nomeia controlador nem cita base legal
  enquanto a instituição não existir, e o teste impede que prometa o que não é feito.
  As funções do backend na Vercel ficam em `gru1` (`backend/vercel.json`), junto do
  banco em `sa-east-1`: sem isso a Vercel usa `iad1` e cada consulta cruza o
  continente (117 ms contra 2 ms, medido). O aviso afirma São Paulo, e um teste lê
  o `vercel.json` para que as duas coisas não se separem.
- **Há uma demonstração publicada** (`docs/demonstracao-publicada.md`): site, API e
  banco próprios, com dados fictícios. Os dois projetos da Vercel dela
  (`conserva-predial-demo`, pasta `demo/frontend`; `conserva-predial-demo-api`, pasta
  `backend`) seguem a `main`. Regras: nada é compartilhado com a produção, e
  `JWT_SECRET` e `CRON_SECRET` da demo são **valores novos**, nunca os da produção
  (o token é só `{id, sv}`: a mesma chave faria o token da demo valer na produção).
  O semeador (`frontend/video/semear.mjs`) e o workflow `demonstracao.yml` só escrevem
  num banco marcado como de demonstração (`backend/database/guarda-demonstracao.js`)
  e numa API que o confirma em `/health/db`; endereço novo do site da demo entra em
  `ORIGENS_EXTRAS` da API e em `demo/frontend/vercel.json`, nunca em `DOMINIOS_FIXOS`.
  `reiniciar-demonstracao.sql` apaga o schema inteiro e só roda no banco marcado.
- **Erros de servidor (5xx) ficam em `erro_aplicacao`** (migração 028), porque na Vercel Hobby os logs
  duram 1 hora. Sem usuário, IP, query string nem corpo; e-mail na mensagem sai mascarado; 30 dias; teto
  de 100 por minuto. Só o administrador lê (`GET /operacao/erros`, tela de Usuários). Mexeu no que ela
  guarda? Mude `docs/lgpd.md` e o aviso de privacidade junto. A migração só vale em produção depois de
  `npm run migrate` lá: antes disso gravar falha em silêncio e vai só para o console, e **ler** (painel de
  erros, painel de uso) responde vazio, e não 500: código novo que lê tabela de migração nova tolera `42P01`.
- **Medida de desempenho (RNF03) só vale com build de produção.** Com `NODE_ENV=development` no shell,
  o `vite build` empacota o React de desenvolvimento: o StrictMode dobra toda chamada à API e as telas
  ficam mais lentas (o documento de projeto chegou a sair com tempo inflado por isso). Confira com
  `grep -c "Invalid hook call" dist/assets/index-*.js`: tem de dar 0. A API comprime as respostas
  (`compression` em `app.js`, `tests/compressao.test.js`; a lista de locais cai de 245 kB para 13 kB): sem
  isso, em 4G lento a tela de Cadastros passa de 3 s só pelo tempo de baixar. O site publicado se mede
  com o workflow `desempenho.yml` (runner nos EUA: é teto, não o tempo de quem usa).
- **Monitoramento é próprio e anônimo** (`frontend/src/monitoramento/`, `telemetria_diaria`, migração 031): a tela
  vai pelo **modelo** da rota (`/chamados/:id`), nunca pelo caminho; nada fica no aparelho; "Não rastrear" desliga.
  Tela nova entra em `TELAS` e ação nova (`registrarAcao('...')`) em `ACOES`, em `telemetria.service.js` (um teste
  confere); coluna nova na tabela exige decisão de privacidade (um teste barra) e mudar a página de cookies, o
  aviso de privacidade e `docs/lgpd.md`. A migração só vale em produção depois de `npm run migrate` lá.
- **Páginas de informação** (`/privacidade`, `/termos`, `/cookies`, `/suporte`, 404) descrevem o que o
  sistema faz, como o aviso de privacidade: mudou o que se guarda no aparelho ou o contato? Mude a
  página e `docs/lgpd.md` (seção 8). Nenhum cookie nem script de análise entra sem consentimento prévio
  e sem mudar a página de cookies (um teste falha se aparecer). Rota nova ganha título **e descrição**
  em `titulosDeRota.js`, e, se for atrás do login, uma linha `Disallow` em `frontend/public/robots.txt`
  (`Indexacao.test.js`). Todo site sai com `noindex` (HTML e `X-Robots-Tag`; o `vercel.json` da demo
  repete o da produção, e um teste confere): é pedido a robôs, não controle de acesso.
- Telas de gestão são sob demanda (`telaSobDemanda` em `App.jsx`); a fila, o chamado e o formulário de
  abertura ficam no arquivo principal porque o técnico os lê sem conexão. Tela offline nova não entra na lista
  sob demanda (um teste confere). O `AnuncioDeRota` espera o `h1` que chega depois.
- Tela nova entra na lista de `frontend/e2e/acessibilidade.spec.js`: o axe falha o e2e com
  violação de WCAG 2.2 AA. Texto não usa cinza cru do Tailwind (use os tokens: `contraste.test.js`
  barra), `<select>` e `<input>` levam rótulo, link dentro de frase leva `underline`, e rota nova
  ganha título em `frontend/src/dominio/titulosDeRota.js` (o teste confere cada rota do `App.jsx`).
  Não use `role="tab"` sem setas, `tabpanel` e `aria-controls`: grupo de botões com `aria-pressed`.
- **Tela não narra a si mesma**: título sem subtítulo explicando para que serve (pedido do dono, 12/11/2026;
  `telaSemNarracao.test.js` barra frase fixa no `descricao` do `CabecalhoDePagina`). Texto só entra quando a pessoa
  precisa dele para agir: `ajuda` do campo, consequência ao lado do botão, estado vazio, erro, aviso legal.
- Tela de um registro só (chamado, equipamento) que não carrega usa `ui/RegistroIndisponivel`: diz a causa
  (404, 403, sem conexão, falha), tem `h1` e caminho de volta. Não volte à caixa de erro solta.
- Mexeu em tela: rode o e2e nos dois projetos. Ele já pegou alvo de toque
  pequeno e formulário vazando no celular que o jsdom não vê.

## Segredos e produção

- Senhas, `service_role` do Supabase, `CRON_SECRET` e `.env` nunca vão para chat,
  commit ou log. Quem administra digita direto no Supabase, GitHub ou Vercel.
- **O script `backend/database/limpar-demonstracao.sql` já rodou em produção, em
  12/10/2026. Não rode de novo lá: ele apaga todos os chamados, e desde então
  são reais** (`docs/piloto.md` §2.0). Serve para banco de demonstração ou de
  homologação.
- **A produção pode carregar dados de apresentação** (`docs/apresentacao-na-producao.md`): chamados com
  protocolo `SMP-…-DEMOnn` e contas `@conserva.invalid` inativas, semeados por
  `backend/database/semear-apresentacao.sql`, que recusa rodar onde há chamado real. Tirar é com
  `remover-apresentacao.sql`, que só apaga o que o seed criou; o `limpar-demonstracao.sql` (tudo)
  continua proibido onde houver uso real. Mexeu no seed? Os avisos têm de nascer com `email_enviado_em`
  e as contas inativas, senão a gestão real recebe e-mail de dado inventado (o teste confere).
- O cadastro da produção (37 locais da "Sede", 9 planos preventivos) é de teste,
  mantido para a apresentação, em dezembro de 2026. **Os planos estão desativados
  desde 12/10/2026** para não gerarem chamados de teste no meio do piloto. Para
  reativar, em cada plano ajuste a "Próxima execução" para uma data futura e só
  então marque ativo: com a data antiga, o agendador geraria chamados já vencidos
  (`docs/piloto.md` §2.0).
- `exigir_2fa_gestao` e `cadastro_exige_aprovacao` são chaves da tabela
  `configuracao`, ligadas pela tela de Usuários. Ligar muda quem consegue
  entrar: não é efeito colateral de deploy.

# Sistema de Manutenção Predial

Sistema de abertura e acompanhamento de chamados de manutenção predial, com
perfis de acesso, fluxo de atendimento auditado e relatórios de desempenho.

- **Backend**: Node/Express, PostgreSQL, autenticação JWT
- **Frontend**: React + Vite + Tailwind
- **Hospedagem**: Vercel (duas aplicações) com PostgreSQL no Supabase

## Perfis e permissões

| Perfil | O que enxerga | O que faz |
| --- | --- | --- |
| `solicitante` | os chamados que abriu | abre chamado, anexa arquivo, avalia o atendimento concluído |
| `tecnico` | os chamados designados a ele | muda estado, lança material consumido, anexa arquivo |
| `gestor` | todos os chamados | tudo acima, mais triagem, atribuição, cadastros e relatórios |
| `administrador` | todos os chamados | tudo acima, mais criação de usuários de qualquer perfil |

O cadastro público cria sempre `solicitante`. Os demais perfis só são criados
por um administrador autenticado — do contrário bastaria mandar
`"perfil": "administrador"` no corpo do cadastro para escalar privilégio.

## Fluxo do chamado

```
aberto → em_triagem → atribuido → em_andamento → concluido
             ↑                         ↕              │
             │                aguardando_material     │
             └──────── reabertura (até 48h) ──────────┘
```

Qualquer estado (menos `concluido`) pode ir para `cancelado`, e cancelar um
serviço já em execução exige justificativa. As transições
são validadas no servidor, não só na interface, e cada mudança grava uma
linha em `historico_chamado`. O tempo parado em `aguardando_material` é
acumulado à parte e descontado das métricas de atendimento: é espera por
insumo, não trabalho da equipe.

## Prazo (SLA)

Cada chamado recebe um prazo na abertura, calculado a partir da prioridade
segundo a tabela `sla` — editável por gestor e administrador na tela de
relatórios. Os valores iniciais são 4h para crítica, 24h para alta, 72h para
média e 168h para baixa.

Enquanto o chamado está em `aguardando_material`, o prazo anda junto: ao sair
desse estado, ele é empurrado exatamente pelo tempo que ficou suspenso. Sem
isso o sistema descontaria a espera da métrica de tempo de atendimento e
ainda assim deixaria o relógio do prazo correndo, cobrando duas coisas
incoerentes.

"Em atraso" é derivado, não um estado da máquina: um chamado está atrasado
quando não foi concluído nem cancelado e o prazo já passou. Como estado,
precisaria de transições para dentro e para fora de todos os outros e ainda
ficaria desatualizado entre uma escrita e outra.

Alterar um prazo vale para chamados abertos daí em diante; os já existentes
mantêm o prazo com que nasceram, para que uma mudança de política não
reescreva retroativamente o histórico de cumprimento.

## Como rodar

Requisitos: Node 22+ e PostgreSQL 16+.

```bash
# Banco
createdb smp

# Backend
cd backend
cp .env.example .env      # ajuste as credenciais
npm ci
npm run migrate           # cria/atualiza o schema
npm run dev               # http://localhost:3333

# Frontend, em outro terminal
cd frontend
npm ci
npm run dev               # http://localhost:5173
```

O frontend chama a API sempre pelo próprio domínio (`/api`): em
desenvolvimento o proxy do Vite encaminha para `localhost:3333`, em produção
um rewrite do `vercel.json` encaminha para o backend. Não há variável de
ambiente de URL da API para configurar, nem CORS no caminho.

## Migrações

O schema é versionado em `backend/database/migrations`, aplicado por
`npm run migrate`. Cada arquivo roda uma vez, dentro de uma transação, e fica
registrado na tabela `migracao`.

```bash
npm run migrate              # aplica as pendentes
npm run migrate -- --status  # lista aplicadas e pendentes
```

Para adotar o mecanismo num banco que já tem o schema criado por outro
caminho, use `--baseline=NNN` para marcar as migrações até `NNN` como
aplicadas sem executá-las.

## Testes

São três camadas, com propósitos distintos.

### Backend

```bash
cd backend
npm test -- --runInBand
```

Rodam contra um PostgreSQL de verdade, não contra mocks: o que está sendo
verificado inclui transação, bloqueio de linha, restrição de chave e
permissão — coisas que um mock de driver só simularia. `--runInBand` evita
que as suítes disputem o mesmo banco.

### Frontend: componentes

```bash
cd frontend
npm test
```

Vitest com jsdom. Sem banco e sem servidor, em segundos: é a rede fina, e
pega a maior parte das regressões de comportamento — o interceptor de sessão,
o nome do arquivo baixado, o contador do sino, a espera da busca, a janela da
RN03. Um teste aqui roda por commit sem custo.

### Frontend: ponta a ponta

```bash
cd frontend
npm run e2e
```

Playwright contra a **build**, não contra o servidor de desenvolvimento: é a
build que vai para produção, e testar o `vite dev` deixaria de fora tudo que
só aparece depois do empacotamento. O `playwright.config.js` sobe o backend e
o `vite preview` sozinho, e roda tudo em dois tamanhos de tela — computador e
celular.

Esta camada existe por um motivo específico: **geometria**. Todos os defeitos
de responsividade deste projeto — o cartão de chamado esticando a página, as
tabelas vazando do cartão, o painel de avisos saindo pela esquerda no celular,
o select de técnico crescendo com o e-mail mais longo — passaram por build
verde e por teste de componente. O jsdom devolve zero em
`getBoundingClientRect`: não existe como medi-los fora de um navegador.

O cenário de cada execução é semeado pela própria API, não por SQL. Inserir
direto no banco criaria estados que a aplicação nunca produz — um chamado sem
histórico, uma senha sem hash — e o teste passaria a verificar uma realidade
que não existe. A única exceção é o primeiro administrador
(`backend/database/semear-admin.js`), porque o cadastro público só cria
solicitante (RN01); esse script recusa rodar com `NODE_ENV=production`.

### Teste de mutação

```bash
cd frontend
npm run mutacao            # todas
npm run mutacao vitest     # só as rápidas
```

Um teste que passa não prova nada sozinho: ele pode estar passando pelo motivo
errado. A ferramenta quebra um comportamento específico de cada vez e confere
que a suíte acusa. Foi assim que se descobriu que a exceção do `/auth/login`
no interceptor de sessão podia ser apagada sem nenhum teste reclamar — o teste
que a cobria não guardava token, então passava por um caminho que não era o
verificado.

Não roda no CI: leva o tempo da suíte multiplicado pelo número de mutações. É
ferramenta de quem escreve ou revisa teste.

### No CI

`.github/workflows/ci.yml` tem três jobs: backend (PostgreSQL de serviço,
migrações pelo mesmo `npm run migrate`, suíte), frontend (testes de componente
e build) e ponta a ponta (PostgreSQL, migrações, administrador semeado,
Chromium e a suíte do Playwright). O relatório do Playwright fica guardado
como artefato quando algo falha.

## Rotas

Todas exigem `Authorization: Bearer <token>`, exceto `/health`, `/health/db`,
`/auth/registrar` e `/auth/login`.

| Método | Rota | Quem |
| --- | --- | --- |
| `POST` | `/auth/registrar` | público (cria `solicitante`) |
| `POST` | `/auth/login` | público (limitado por tentativa) |
| `POST` | `/auth/recuperar-senha`, `/auth/redefinir-senha` | público (token de uso único, 60 min) |
| `GET` | `/chamados?pagina=&limite=&estado=&categoria_id=&atrasados=` | autenticado, escopo conforme o perfil |
| `POST` | `/chamados` | solicitante, gestor, administrador |
| `GET` | `/chamados/:id` | quem tem acesso ao chamado |
| `PATCH` | `/chamados/:id/atribuir` | gestor, administrador |
| `PATCH` | `/chamados/:id/priorizacao` | gestor, administrador |
| `PATCH` | `/chamados/:id/estado` | gestão ou técnico designado |
| `PATCH` | `/chamados/:id/execucao` | gestão ou técnico designado |
| `POST` | `/chamados/:id/reabertura` | solicitante do chamado ou gestão, em até 48h |
| `POST` | `/chamados/:id/avaliacao` | solicitante, chamado concluído |
| `GET POST DELETE` | `/chamados/:id/materiais` | gestão ou técnico designado (leitura: quem vê o chamado) |
| `GET POST DELETE` | `/chamados/:id/anexos` | quem tem acesso ao chamado |
| `GET` | `/notificacoes` | o próprio usuário |
| `GET POST PATCH` | `/equipes`, `/materiais` | leitura autenticada, escrita para gestão |
| `GET PATCH` | `/sla`, `/sla/:prioridade` | leitura autenticada, escrita para gestão |
| `GET POST` | `/regras-priorizacao` | leitura da vigente autenticada, versão nova para administrador |
| `GET` | `/relatorios/resumo`, `/desempenho`, `/tecnicos` | gestor, administrador |

`GET /health/db` executa uma consulta e devolve 503 quando o banco está
inacessível — `/health` sozinho responde `ok` mesmo com o banco fora, o que
já escondeu falha de conexão em produção.

## Anexos

Aceita JPEG, PNG, WebP e PDF, até 4 MB. O tipo declarado pelo cliente não é
suficiente: o conteúdo é conferido pelos primeiros bytes do arquivo. O
conteúdo fica em `bytea` no próprio banco, porque o sistema de arquivos das
funções serverless é efêmero — um caminho gravado em disco apontaria para um
arquivo que já não existe na requisição seguinte. Se o volume crescer, o
passo seguinte é migrar para armazenamento de objetos.

## Priorização

O gestor registra três fatores na triagem — urgência, impacto e risco, em
escala de 1 a 4 — e o sistema sugere a prioridade por uma regra versionada
(tabela `regra_priorizacao`), combinando pesos e limiares. Risco que atinge o
mínimo configurado impõe prioridade crítica, prevalecendo sobre o cálculo.

O gestor pode registrar prioridade diferente da sugerida, mas aí a exceção
exige justificativa: ficam gravados o que foi sugerido, o que foi registrado,
por quem, quando e sob qual versão da regra. Publicar uma versão nova encerra
a vigência da anterior, que continua existindo para explicar decisões antigas.

Os pesos e limiares iniciais são um ponto de partida com pesos neutros,
pendente de validação institucional — não uma calibração pronta.

## Ciclos de atendimento

Um chamado concluído pode ser reaberto pelo solicitante ou pela gestão em até
48 horas, com justificativa. A reabertura preserva todo o histórico, move a
descrição do serviço do ciclo anterior para lá e inicia um novo ciclo com
prazo próprio: o prazo anterior já foi gasto, e o que sinaliza a falha do
atendimento é a contagem de reaberturas.

Reatribuir um chamado já distribuído mantém o estado do atendimento e exige
justificativa. Cancelar um serviço já em execução é exceção administrativa e
também exige motivo registrado.

## Comentários

A RN03 fecha a janela de edição do solicitante quando o chamado é atribuído,
mas não fecha a porta: dali em diante "alterações deverão ocorrer por
comentário ou ação autorizada". O comentário é essa porta — é como quem abriu
acrescenta o que faltou sem mexer no texto que já orientou a triagem, e como
quem atende pede informação sem mudar o estado do chamado.

Quem enxerga o chamado enxerga a conversa dele: a autorização é a mesma da
leitura, e não um controle próprio, porque dois critérios de visibilidade para
o mesmo chamado divergiriam na primeira mudança. Cada comentário avisa os
demais envolvidos — nunca quem escreveu — e, sem técnico designado, a gestão
entra no lugar, que é quem responde pelo chamado enquanto ele não tem dono.

Comentário não entra no histórico. O histórico registra transição de estado
(anterior → novo), e um comentário não é transição: forçá-lo lá exigiria
colunas de estado nulas e faria a auditoria de fluxo conviver com conversa.

Não há edição nem exclusão de comentário, por decisão: é registro do
atendimento, como o histórico. Um texto que some depois de lido tiraria do
registro justamente a parte que alguém quis apagar. Chamado encerrado também
não recebe comentário novo — quem discorda do desfecho reabre, que tem janela
e justificativa próprias —, mas a conversa continua legível.

Não existe comentário interno, visível só para a equipe. O Termo não pede, e
um eixo de visibilidade pela metade é pior que nenhum: toda leitura do chamado
teria de respeitá-lo, e esquecer uma delas vaza justamente o que deveria ser
reservado.

## Notificações

Cada atribuição e cada mudança de estado grava uma notificação para o
usuário afetado. Se houver SMTP configurado, ela também vira e-mail; sem
SMTP, o envio vira registro em log e nada mais no sistema muda. O despacho
acontece depois do commit da transação: enquanto ela está aberta a
notificação ainda pode desaparecer num rollback, e avisar sobre algo que não
aconteceu é pior que não avisar.

Os dois canais previstos pela RF08 existem: o aviso interno, no sino do
cabeçalho, e o e-mail. O interno não depende de nada estar configurado, e é
o que sobra quando não há SMTP.

### Aviso de atraso

O atraso é a única notificação que não nasce de uma ação de usuário: ninguém
clica em "passou do prazo". Ela depende de um gatilho de tempo, que é um
agendador externo batendo numa rota:

```
POST /tarefas/notificar-atrasos
Authorization: Bearer <CRON_SECRET>
```

A rota varre os chamados em aberto com prazo vencido, grava o aviso para o
solicitante e para o técnico designado — ou para a gestão, quando não há
técnico, que é o caso em que ninguém mais pode agir — e marca o chamado como
avisado **para aquele prazo**. Se o prazo mudar depois (repriorização, tempo
suspenso devolvido, reabertura), um novo estouro volta a avisar; enquanto o
prazo for o mesmo, o aviso sai uma vez só, por mais vezes que a varredura
rode.

Configuração:

1. Defina `CRON_SECRET` nas variáveis de ambiente (Vercel → Settings →
   Environment Variables) com um valor aleatório longo, e **redeploy** — as
   variáveis são congeladas na build. Sem essa variável a rota responde 503:
   ela falha fechada, para que esquecer a configuração num ambiente novo não
   deixe um gatilho de trabalho aberto na internet.
2. Aponte um agendador para a rota a cada 15 minutos. Serviços gratuitos como
   o cron-job.org servem; o cron da Vercel no plano Hobby roda uma vez por
   dia, o que chegaria tarde demais para um chamado crítico de 4 horas.
3. O segredo vai no cabeçalho `Authorization`, nunca na query string. URL
   aparece em log de acesso, em histórico de proxy e no cabeçalho `Referer`:
   segredo que trafega na URL vaza sozinho, sem ninguém atacar nada. A rota
   recusa o segredo por query de propósito.

Para conferir sem disparar nada, `GET /tarefas/atrasos-pendentes` (mesmo
cabeçalho) devolve quantos chamados estão vencidos sem aviso. A varredura
responde quantos chamados notificou, quantos avisos gerou e se sobrou
trabalho para a próxima passagem — sem esse retorno, um agendamento quebrado
e um agendamento sem nada a fazer seriam indistinguíveis dos dois lados.

Cada execução tem teto: o alcance é chamados × destinatários, não a soma, e
uma varredura sem limite poderia gerar milhares de avisos numa transação só,
dentro de uma função com limite de tempo. O que passar do teto fica para a
passagem seguinte — a marcação é persistente, nada se perde.

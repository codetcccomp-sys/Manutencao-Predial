# Conserva Predial — Sistema de Manutenção

Sistema de abertura e acompanhamento de chamados de manutenção predial, com
perfis de acesso, fluxo de atendimento auditado e relatórios de desempenho.

- **Backend**: Node/Express, PostgreSQL, autenticação JWT
- **Frontend**: React + Vite + Tailwind
- **Hospedagem**: Vercel (duas aplicações) com PostgreSQL no Supabase

## Sobre o projeto

**É um trabalho de conclusão de curso**, construído a partir do Termo de
Abertura de Projeto v1.2. O sistema funciona e está no ar, mas não está em uso
por nenhuma instituição.

**Os dados que estão lá são fictícios.** Os 73 chamados, as 9 pessoas e as
avaliações foram criados para exercitar o sistema e demonstrá-lo. Nenhum
descreve manutenção que aconteceu de verdade, e por isso **não sustentam
conclusão sobre eficiência** — o §4.3 do Termo separa as duas coisas com todas
as letras. Ver [docs/dados-demonstracao.md](docs/dados-demonstracao.md), que
explica como reconhecê-los e como apagá-los.

O cadastro no endereço público é aberto: qualquer pessoa consegue criar uma
conta de solicitante. É assim de propósito enquanto o sistema é demonstração,
e é a primeira coisa a fechar se ele passar a atender um prédio real.

### Documentos

| | |
| --- | --- |
| [docs/piloto.md](docs/piloto.md) | O protocolo para usar o sistema num prédio real: o que configurar antes do primeiro chamado, o que medir, o que declarar como limitação |
| [docs/dados-demonstracao.md](docs/dados-demonstracao.md) | O que é fictício, como reconhecer e como apagar antes do uso real |
| [docs/lgpd.md](docs/lgpd.md) | Dados pessoais, retenção e o procedimento de remoção sob pedido |
| [docs/apresentacao.md](docs/apresentacao.md) | Roteiro da demonstração ao vivo e checklist dos pitches de dezembro |

Os quatro são artefatos acadêmicos. Nenhum foi adotado ou assinado por
instituição alguma.

## Endereços

| | Endereço |
| --- | --- |
| Sistema | <https://conserva-predial.vercel.app> |
| API | <https://manutencao-predial-backend-delta.vercel.app> |

O frontend responde também em `manutencao-predial-frontend.vercel.app`, o nome
que a Vercel deu ao projeto. O endereço curto foi **acrescentado**, não
trocado: renomear o projeto derruba o nome antigo, e no backend isso
arrebentaria em silêncio duas coisas de uma vez — o `VITE_API_URL` do frontend
e o agendador do aviso de atraso (RF08), que passaria a receber 404, se
desligaria sozinho e pararia de registrar sem avisar ninguém.

Por isso o endereço da API continua o que é. Ele quase não é lido por pessoas:
aparece no agendador e neste documento, e o custo de mexer é maior que o
incômodo de ser feio.

## Perfis e permissões

| Perfil | O que enxerga | O que faz |
| --- | --- | --- |
| `solicitante` | os chamados que abriu | abre chamado, anexa arquivo, avalia o atendimento concluído |
| `tecnico` | os chamados designados a ele | inicia, espera material e conclui; lança material consumido; anexa arquivo. **Não cancela** (RN05) |
| `gestor` | todos os chamados | tudo acima, mais triagem, priorização, atribuição, cancelamento, cadastros e relatórios |
| `administrador` | todos os chamados | tudo acima, mais gestão de usuários (criar, mudar perfil, desativar, anonimizar) e a regra de priorização |

O cadastro público cria sempre `solicitante`. Os demais perfis só são criados
por um administrador autenticado — do contrário bastaria mandar
`"perfil": "administrador"` no corpo do cadastro para escalar privilégio.

**Cadastro sob aprovação (RF01).** Com a opção ligada em **Usuários**
("Novos cadastros precisam de aprovação", só o administrador muda), quem se
cadastra pelo link público fica esperando a gestão: a conta nasce inativa, o
login com a senha certa responde que o cadastro aguarda aprovação, e senha
errada responde como sempre, sem revelar que o pedido existe. Gestor e
administrador veem os pedidos no painel inicial e em Usuários, e aprovam ou
recusam um a um ou em lote. Aprovar avisa a pessoa por e-mail; recusar apaga
o pedido (nunca entrou no sistema, então não há histórico a preservar, e
guardar nome e e-mail de quem foi recusado seria reter dado sem finalidade).
A migração deixa a opção desligada: ligar é decisão de quem administra.

**Entrar com Google.** Com `GOOGLE_CLIENT_ID` definido no backend (o ID do
cliente OAuth, que é público), a tela de login mostra o botão do Google. O
servidor confere a credencial do botão: assinatura com as chaves públicas do
Google, emitida para este sistema, não vencida, e com o e-mail garantido pelo
Google (Gmail ou conta de organização; uma conta Google criada com e-mail de
outro provedor não entra por aqui, porque o Google não é dono daquele
e-mail). Conta que já existe com o e-mail entra nela, e a verificação em duas
etapas continua sendo pedida; conta nova nasce solicitante e passa pela
aprovação, se ligada. Com `GOOGLE_DOMINIO` (por exemplo `escola.edu.br`), só
contas Google daquela organização entram: é o login institucional. Sem
`GOOGLE_CLIENT_ID`, nada muda, e o script do Google nem é carregado. Passo a
passo em `docs/piloto.md`, §2.1.6.

### Quem sai da conta

Desativar uma pessoa, trocar o perfil dela ou anonimizá-la são as saídas da
conta, e têm as mesmas travas:

- **ninguém faz isso na própria conta**, e o **último administrador ativo**
  não sai;
- **técnico com chamado em aberto não sai**: o servidor recusa com
  `CHAMADOS_EM_ABERTO` (422) e diz quantos chamados reatribuir. A conta
  deixaria de entrar e o chamado ficaria designado a ela — fora do filtro
  "sem técnico" e fora da fila de qualquer pessoa, parado até estourar o prazo;
- **conta anonimizada não volta**: não reativa, não muda de perfil e não é
  anonimizada de novo. O procedimento e a razão estão em
  [docs/lgpd.md](docs/lgpd.md).

Reativar e renomear não são bloqueados.

## Fluxo do chamado

```
aberto → em_triagem → atribuido → em_andamento → concluido
             ↑                         ↕              │
             │                aguardando_material     │
             └──────── reabertura (até 48h) ──────────┘
```

Qualquer estado ainda em aberto pode ir para `cancelado`, mas **só a gestão
cancela** (RN05): o técnico designado muda o estado do próprio trabalho, não
decide que o serviço deixa de existir — isso tiraria o chamado da fila sem que
quem distribui soubesse. Cancelar um serviço já em execução exige
justificativa. As transições
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

### Horas corridas ou horas úteis

Cada prioridade escolhe a régua (`sla.contagem`): **corridas** (o padrão, e o
que existia) ou **úteis**, contadas só dentro do expediente da instituição
(tabela `expediente`, por dia da semana; seg a sex, 8h às 18h, de partida) e
fora dos feriados cadastrados (`feriado`). Um chamado médio de 72h aberto na
sexta às 17h, em horas corridas, vence na segunda às 17h, depois de um fim de
semana em que ninguém trabalha; em horas úteis, vence sete dias de expediente
depois. Para o imprevisto grave (crítica, alta) a régua corrida costuma ser a
certa; para o resto, a útil é a honesta.

A conta é do banco, numa função só (`prazo_sla`, sobre `somar_horas_uteis` e
`horas_uteis_entre`, migração 021), usada na abertura, na repriorização e na
reabertura. A espera por material devolve ao prazo o **expediente** que
consumiu (dois dias de espera num fim de semana não valem dois dias de prazo),
e fica guardada em `tempo_suspenso_util` para a repriorização refazer a conta
desde a abertura. Sem nenhum dia de expediente cadastrado, não há hora útil
para contar e vale a régua corrida. Preventivas não usam SLA: o prazo delas é o
fim do dia previsto.

Rotas: `PATCH /sla/:prioridade` (`prazo_horas` e/ou `contagem`),
`GET PUT /sla/expediente` (a semana inteira de uma vez),
`GET POST /sla/feriados`, `DELETE /sla/feriados/:data`.

## Segurança

O que o código faz, e onde procurar:

- **A sessão obedece ao banco.** O token (JWT, 8 h por padrão) só prova quem
  é a pessoa; a cada requisição o servidor confere a conta no banco. Desativar,
  anonimizar ou trocar o perfil de alguém encerra a sessão na hora, em vez de
  esperar o token vencer — antes disso a pessoa desligada continuava entrando
  por até 8 horas. Erro do banco nessa checagem é 500, não 401: um 401 mandaria
  todo mundo de volta ao login por uma falha que não é deles.
- **A sessão fica num cookie que script nenhum lê.** O token ia para o
  `localStorage`, onde qualquer script da página o alcança: um XSS levaria a
  sessão embora para ser usada de outro lugar. Agora ele viaja num cookie
  `conserva_sessao` `HttpOnly`, `SameSite=Strict` e `Secure` (atrás da Vercel),
  e a tela guarda só nome e perfil, para se desenhar. O que sobrou de token no
  aparelho de quem já usava o sistema é apagado na primeira carga. Contra CSRF,
  além do `SameSite`, toda escrita autenticada pelo cookie exige o cabeçalho
  `X-Conserva: 1`, que a tela manda e um formulário de outro site não consegue
  mandar (`403 CSRF` sem ele). `Authorization: Bearer` continua aceito: é como
  os testes e qualquer cliente que não seja o navegador falam com a API.
- **Sessão revogável.** Cada conta tem uma versão de sessão, e todo token
  carrega a versão em que foi emitido. Redefinir a senha, pedir "sair de todos
  os aparelhos" (tela **Minha conta**), ligar ou desligar a verificação em duas
  etapas e a redefinição dela pelo administrador sobem a versão: todas as
  sessões abertas daquela pessoa caem na hora. Antes, quem tivesse roubado a
  sessão continuava dentro por até 8 horas depois de a vítima trocar a senha.
- **Verificação em duas etapas (TOTP).** Opcional por pessoa, e a
  administração pode exigi-la de gestores e administradores (tela de
  **Usuários**): quem ainda não ligou entra, mas a API só atende Minha conta
  até ligar (`403 DOIS_FATORES_OBRIGATORIO`), e a tela leva a pessoa para lá.
  Ligada na tela **Minha conta**: QR Code para o
  aplicativo autenticador (Google/Microsoft Authenticator, Aegis, o do
  gerenciador de senhas), confirmação com um código e a senha antes de valer
  (só a sessão aberta não cadastra outro aplicativo), e 8 códigos de
  recuperação de uso único, mostrados uma vez e guardados só como hash. Com
  ela ligada, a senha certa devolve um desafio de 5 minutos, e só o código abre
  a sessão; o código usado não vale de novo, e errar senha ou código — no login
  ou na própria conta — conta no mesmo limite do login. A sessão reemitida ao
  ligar ou desligar volta só no cookie: no corpo da resposta, um script
  injetado na página a levaria embora. Quem perdeu o celular e os códigos pede ao
  administrador, que redefine pela tela de **Usuários** ("Redefinir duas
  etapas"); a pessoa entra só com a senha e liga de novo. Implementação própria
  do RFC 6238 em `backend/src/utils/totp.js`, conferida contra os vetores do
  RFC em `tests/totp.test.js`.
- **Autorização no servidor.** Perfil e relação com o chamado são conferidos
  na API; a tela esconder um botão é só cortesia (o cancelamento do técnico,
  por exemplo, também é recusado se alguém chamar a rota à mão).
- **Senhas** com bcrypt. **Login**: 5 falhas por e-mail ou 20 por IP em 15
  minutos bloqueiam novas tentativas. **Recuperação de senha**: token de uso
  único, 15 pedidos por IP por hora e 100 envios por dia, com a mesma resposta
  para e-mail cadastrado ou não — a recusa não pode servir para descobrir quem
  tem conta.
- **Cabeçalhos de segurança.** A API usa `helmet` (nosniff, HSTS,
  frame-ancestors, sem `X-Powered-By`), e a interface sai com uma CSP estrita
  em `frontend/vercel.json`: scripts, estilos, imagens e conexões só da própria
  origem (mais `data:` e `blob:` nas imagens, para os anexos), sem
  `'unsafe-inline'` — o React aplica estilo pelo CSSOM, que a política não
  bloqueia. O `vite preview` serve os mesmos cabeçalhos, então o e2e
  (`e2e/seguranca.spec.js`) roda com a política da produção e falha se o
  navegador relatar qualquer violação. Se uma tela nova precisar de recurso de
  fora (fonte, imagem, API), a CSP precisa ser aberta de propósito, naquele
  arquivo; o teste acusa antes de chegar à produção.
- **Dependências.** O `npm audit` (só o que vai para produção, severidade alta
  ou crítica) roda em `.github/workflows/auditoria.yml` quando um
  `package*.json` muda e uma vez por semana, e o Dependabot
  (`.github/dependabot.yml`) abre PR de atualização: patch e minor agrupados por
  semana, versão maior sozinha. O `bcrypt` 6 e o `nodemailer` 10 entraram assim
  — o primeiro valida os hashes gravados pelo 5 (formato igual), e o segundo é
  coberto por `tests/emailSmtp.test.js`, que envia por SMTP de verdade a um
  servidor de mentira.
- **Banco fechado para a API automática do Supabase.** O Supabase publica o
  schema `public` em `/rest/v1/`, com a chave `anon`, que é pública. Tabelas e
  sequências foram fechadas para `anon` e `authenticated` na migração 005; as
  funções, na 023 — o PostgreSQL concede `EXECUTE` de toda função nova a
  `PUBLIC`, e os dois papéis herdam dele. Só o `smp_backend`, com que a API em
  Express conecta, lê tabela e executa função; `tests/migracoes.test.js`
  confere no banco migrado que nenhuma função ficou para `PUBLIC`.
- **Conexão com o banco por TLS verificado.** Em produção a aplicação não sobe
  sem o certificado da autoridade do Supabase, que já está em
  `backend/database/supabase-ca.crt` (`DB_CA_CERT` o substitui sem novo
  deploy). A alternativa, `sslmode=require`, criptografa mas não confere quem
  está do outro lado.
- **Anexos** conferidos pelo conteúdo do arquivo, não pelo tipo declarado.
- **Dados pessoais**: retenção, base legal e procedimento de remoção em
  [docs/lgpd.md](docs/lgpd.md).

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

**Em produção, aplique sempre por `npm run migrate`, nunca colando o SQL à
mão.** Colar funciona — foi o que aconteceu com a 015 e a 016 —, mas o
objeto passa a existir sem a linha correspondente em `migracao`, e a
divergência fica invisível até o `migrate` seguinte: ele tenta refazer a
migração "pendente", esbarra em "já existe" e para, bloqueando as que vêm
depois. Se já colou, registre o nome do arquivo em `migracao` (é o que
`--baseline` faz) e confira com `npm run migrate -- --status`.

## Testes

São três camadas, com propósitos distintos.

### Backend

```bash
cd backend
npm test
```

Rodam contra um PostgreSQL de verdade, não contra mocks: o que está sendo
verificado inclui transação, bloqueio de linha, restrição de chave e
permissão — coisas que um mock de driver só simularia.

As suítes do backend compartilham um banco só, então `npm test` já roda com
`--runInBand`. Em paralelo elas disputam as mesmas tabelas e uma delas falha
de vez em quando — mais ou menos uma execução em três, sempre uma suíte
diferente. O flag era documentado aqui e o script não o usava: quem rodasse
`npm test` sem ler esta seção via falha intermitente e ia procurar bug onde
não havia.

Custa 15 segundos (13s contra 28s). Uma suíte que falha em uma execução a cada
três ensina a ignorar falha vermelha, e aí ela deixa de servir para qualquer
coisa. Se precisar da velocidade e souber do risco, `npm run test:paralelo`.

**A suíte limpa depois de si.** Os testes abrem chamados de verdade, e num
banco que vive entre as rodadas eles se acumulavam: o de desenvolvimento
chegou a 20.169, acima do teto de 20.000 da exportação, e um teste de
exportação passou a falhar sem que o código estivesse errado. Agora, ao fim
da execução, um gancho (`tests/apoio/globalTeardown.js`) apaga os chamados
abertos por contas `@exemplo.com` e o que depende deles, e depois as próprias
contas de teste que não deixaram nada para trás.

As contas também precisam sair, e por um motivo menos óbvio que o teto da
exportação: o aviso de atraso vai para toda a gestão quando o chamado não tem
técnico, então o custo de cada varredura cresce com o número de gestores no
banco. Com 9.000 contas de gestor acumuladas, a suíte `atrasos` passou a
estourar os 5 s do Jest (`volta a avisar quando o prazo muda…`, 5001 ms) — uma
falha intermitente sem nada de errado no código. Depois da limpeza, a rodada
seguinte passa 25 de 25. Uma conta de teste que ainda é autora de algo
(comentário, anexo, histórico) fica, e o administrador semeado para a ponta a
ponta (`E2E_ADMIN_EMAIL`, por padrão `admin_e2e@exemplo.com`) nunca é apagado.

A limpeza recusa rodar com `DATABASE_URL` ou `NODE_ENV=production` — é o
caminho do banco real —, e deixa de fora de propósito as contas anonimizadas,
cujo chamado o sistema promete preservar. Suíte que anonimiza uma conta apaga
o que criou por id (`apagarChamados`, em `tests/apoio/limpeza.js`). Não rode
duas execuções do Jest ao mesmo tempo no mesmo banco: o gancho de uma apaga as
contas que a outra ainda está usando.

### Frontend: componentes

```bash
cd frontend
npm test
```

Vitest com jsdom. Sem banco e sem servidor, em segundos: é a rede fina, e
pega a maior parte das regressões de comportamento — o interceptor de sessão,
o nome do arquivo baixado, o contador do sino, a espera da busca, a janela da
RN03. Um teste aqui roda por commit sem custo.

### Animações

O sistema anima a entrada das telas, os números dos indicadores, as barras dos
relatórios, os modais, o painel de avisos e a lista de chamados. São duas
camadas, e a divisão é de propósito:

- **CSS** (`tailwind.config.js`, `animate-pagina-in`, `animate-modal-in`,
  `animate-fundo-in`, `animate-aviso-in`) para o que é só entrar e sair. A regra
  global de `prefers-reduced-motion` em `index.css` zera a duração de todas.
- **GSAP** (`src/animacao/`) para o que CSS não faz bem: `NumeroAnimado` conta de
  um valor ao outro, e `useEntrada` faz os elementos marcados com `data-anim`
  entrarem em sequência, de desfocados para nítidos. O GSAP anima por JavaScript
  e não obedece à regra do CSS, então `reduzMovimento()` (em `movimento.js`) é a
  mesma regra para ele: quem pediu menos movimento recebe o valor final na hora.
  Custa cerca de 30 kB comprimidos no pacote.

Além da entrada em sequência, duas peças da Fase 2:

- **`useListaAnimada`** (FLIP) faz o cartão que continua na lista deslizar do lugar
  antigo para o novo ao filtrar, e o que chega entra em sequência. Os itens se
  identificam por `data-flip="<id>"`, e as posições são medidas relativas ao
  contêiner, para a rolagem da página não parecer movimento. O retrato anterior
  **sobrevive ao esqueleto de carregamento**: toda troca de filtro nestas telas troca a
  lista por um esqueleto, e sem isso todo item pareceria novo.
- **`PainelDeResumo`** é o painel que desliza da direita (botão ao lado de cada cartão
  de chamado) para espiar um chamado sem sair da lista. Usa `GET /chamados/:id`, a
  mesma permissão da tela de detalhe, e vive num **portal no `body`**: o cartão leva
  `transform` durante o FLIP, e um `transform` no ancestral prenderia o `position: fixed`
  do painel ao cartão. Foco, Tab e Esc vêm de `useJanelaModal`, o mesmo do diálogo de
  confirmação.

A Fase 3 acrescenta o **gráfico de chamados por dia** nos relatórios
(`GraficoDeLinhas`, SVG puro, sem biblioteca de gráficos): a linha é revelada da
esquerda para a direita por um recorte que cresce, a dica segue o mouse e o toque, e
as setas percorrem os dias pelo teclado com a leitura numa região `aria-live`. Os
números vêm de `GET /relatorios/serie`, que conta o dia no fuso da instituição (um
chamado aberto às 22h em Brasília nasce às 01h em UTC, e contá-lo no dia seguinte
faria o gráfico discordar de quem o abriu) e no mesmo recorte do resto do relatório.
Um **quadro kanban com arrastar** ficou de fora de propósito: quase toda transição
de estado exige dado que um "soltar" não traz (justificativa, técnico, serviço
realizado) e tem regras (RN05, reabertura), então virar arrastar-e-soltar seria
uma funcionalidade nova, com um fluxo de confirmação por transição, e não um efeito.

Três cuidados que quem mexer aqui precisa manter:

1. **`backwards`, nunca `both`/`forwards`, nas animações CSS.** O quadro final
   ficaria aplicado depois do fim, e um `filter` ou `transform` residual cria um
   bloco de contenção novo: o `position: fixed` do painel de avisos e dos modais
   passaria a se ancorar no elemento animado em vez da janela. Pelo mesmo motivo
   `useEntrada` usa `clearProps`.
2. **Funciona com a CSP estrita.** O GSAP escreve estilo pelo CSSOM
   (`elemento.style`), que a política sem `'unsafe-inline'` não bloqueia. O
   `e2e/seguranca.spec.js` roda com animação ligada para provar isso.
3. **Estado final sempre no primeiro quadro quando não há movimento.** Os testes de
   componente (jsdom, sem `matchMedia`) e os 59 e2e de fluxo rodam assim, e por
   isso não esperam relógio. `e2e/animacao.spec.js` é o que exercita o movimento de
   verdade, nos dois tamanhos de tela.

### Frontend: ponta a ponta

```bash
cd frontend
npm run e2e
```

Playwright contra a **build**, não contra o servidor de desenvolvimento: é a
build que vai para produção, e testar o `vite dev` deixaria de fora tudo que
só aparece depois do empacotamento. O `playwright.config.js` sobe o backend e
o `vite preview` sozinho, e roda tudo em dois tamanhos de tela — computador e
celular. Por padrão roda com movimento reduzido (`reducedMotion: 'reduce'`), para
a entrada animada de cada tela não somar meio segundo a cada navegação; as specs
`animacao` e `seguranca` pedem movimento por conta própria.

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

cd backend
node tests/mutacao.js          # as travas de sessão, 2FA, privilégios, preventiva, horas úteis, anexos e distribuição
node tests/mutacao.js sessão   # só as que têm "sessão" na descrição
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

`.github/workflows/auditoria.yml` é separado do CI de propósito: advisory novo
aparece sem ninguém ter mexido no código, e dentro do `ci.yml` ele deixaria
vermelha qualquer PR sem relação com a falha.

`.github/workflows/backup.yml` faz o backup diário do banco de produção: dump,
**restauração num PostgreSQL descartável com as contagens conferidas contra a
origem**, e só então o arquivo cifrado vira artefato (30 dias). Precisa dos
segredos `BACKUP_DATABASE_URL` e `BACKUP_PASSPHRASE`; como cadastrar e como
restaurar estão em [docs/piloto.md](docs/piloto.md), §2.3.

## Rotas

Exceto as indicadas como públicas, `/health`, `/health/db` e as de agendador,
todas exigem a sessão: o cookie `conserva_sessao` gravado pelo login (com
`X-Conserva: 1` nas escritas) ou `Authorization: Bearer <token>`.

| Método | Rota | Quem |
| --- | --- | --- |
| `POST` | `/auth/registrar` | público (cria `solicitante`) |
| `POST` | `/auth/login` | público (limitado por tentativa). Com duas etapas ligadas, responde `{ requer_2fa, desafio }` em vez da sessão |
| `POST` | `/auth/login/2fa` | público: `{ desafio, codigo }` — código do aplicativo ou de recuperação; mesmo limite do login |
| `GET POST` | `/auth/google` | público: `GET` diz se o login com Google está ligado (`{ client_id }`); `POST { credencial }` entra como o login, ou responde `202 { aguardando_aprovacao }` |
| `POST` | `/auth/sair` | público (apaga o cookie) |
| `POST` | `/auth/sair-de-todos` | autenticado: derruba todas as sessões da própria conta |
| `GET POST` | `/auth/2fa`, `/auth/2fa/iniciar`, `/auth/2fa/ativar` e `/auth/2fa/desativar` (senha + código), `/auth/2fa/codigos` | autenticado, na própria conta; senha e código errados contam no limite do login |
| `POST` | `/auth/recuperar-senha`, `/auth/redefinir-senha` | público (token de uso único, 60 min; pedidos limitados por IP) |
| `GET` | `/chamados?pagina=&limite=&estado=&situacao=&categoria_id=&equipamento_id=&origem=&atrasados=&sem_tecnico=&busca=&ordenar=` | autenticado, escopo conforme o perfil. `situacao` = `abertos` ou `encerrados`; `origem` = `corretiva` ou `preventiva`; `ordenar` = `recentes` ou `prazo`; `busca` casa protocolo ou título |
| `POST` | `/chamados` | solicitante, gestor, administrador. Com `equipamento_id`, local e categoria podem ser omitidos (vêm do equipamento) |
| `GET` | `/chamados/:id` | quem tem acesso ao chamado |
| `PATCH` | `/chamados/:id` | solicitante do chamado, até a atribuição (RN03); gestão, até o chamado encerrar |
| `PATCH` | `/chamados/:id/atribuir` | gestor, administrador |
| `PATCH` | `/chamados/:id/priorizacao` | gestor, administrador |
| `PATCH` | `/chamados/:id/estado` | gestão ou técnico designado; **cancelar, só a gestão** (RN05) |
| `PATCH` | `/chamados/:id/execucao` | gestão ou técnico designado |
| `POST` | `/chamados/:id/reabertura` | solicitante do chamado ou gestão, em até 48h |
| `POST` | `/chamados/:id/avaliacao` | solicitante, chamado concluído |
| `GET POST` | `/chamados/:id/comentarios` | quem tem acesso ao chamado; em chamado encerrado, só leitura |
| `GET POST DELETE` | `/chamados/:id/materiais` | gestão ou técnico designado (leitura: quem vê o chamado) |
| `GET POST DELETE` | `/chamados/:id/anexos` | quem tem acesso ao chamado |
| `GET` | `/usuarios/me` | o próprio usuário |
| `GET` | `/usuarios` | gestor, administrador |
| `POST PATCH` | `/usuarios`, `/usuarios/:id` | administrador |
| `POST` | `/usuarios/:id/anonimizar` | administrador (ver [docs/lgpd.md](docs/lgpd.md)) |
| `POST` | `/usuarios/aprovar`, `/usuarios/recusar` | gestor, administrador (corpo `{ "ids": [...] }`; só toca em pedidos pendentes) |
| `GET PATCH` | `/configuracoes` | leitura: gestor, administrador; alteração: administrador. Chaves: `cadastro_exige_aprovacao`, `exigir_2fa_gestao` (só liga quem já tem a própria verificação) |
| `POST` | `/usuarios/:id/2fa/redefinir` | administrador (quem perdeu o celular e os códigos) |
| `GET PATCH` | `/notificacoes`, `/notificacoes/:id/lida` | o próprio usuário |
| `GET POST PATCH` | `/locais`, `/categorias` | leitura autenticada, escrita para gestão |
| `POST` | `/locais/importar` | gestor, administrador |
| `GET POST PATCH` | `/equipes`, `/materiais` | leitura autenticada, escrita para gestão |
| `POST DELETE` | `/equipes/:id/tecnicos`, `/equipes/:id/tecnicos/:usuarioId` | gestor, administrador |
| `GET PATCH` | `/sla`, `/sla/:prioridade` | leitura autenticada, escrita para gestão |
| `GET` | `/regras-priorizacao/vigente` | qualquer autenticado: quem abre um chamado pode saber por qual critério ele será classificado |
| `GET POST` | `/regras-priorizacao`, `/regras-priorizacao/simular` | gestor, administrador (o `POST /regras-priorizacao`, que publica versão nova, só o administrador) |
| `GET POST PATCH` | `/regras-distribuicao`, `/regras-distribuicao/:id` | gestor, administrador |
| `GET` | `/relatorios/resumo`, `/desempenho`, `/tecnicos` | gestor, administrador |
| `GET` | `/relatorios/serie?de=&ate=` | gestor, administrador. Abertos e concluídos por dia, no fuso da instituição; um ponto por dia (zero nos dias vazios), no máximo 366, com `truncado: true` quando corta |
| `GET` | `/relatorios/preventiva?de=&ate=` | gestor, administrador. Cumprimento do plano preventivo, recortado pela data prevista |
| `GET` | `/relatorios/exportar/chamados.csv`, `/relatorios/exportar/resumo.pdf` | gestor, administrador |
| `GET` | `/equipamentos?local_id=&busca=`, `/equipamentos/codigo/:codigo` | autenticado (desativados só para a gestão, com `incluir_inativos=true`) |
| `GET` | `/equipamentos/:id` | autenticado; gestão e técnico recebem a ficha com histórico e planos, o solicitante só o cadastro |
| `POST PATCH` | `/equipamentos`, `/equipamentos/:id` | gestor, administrador |
| `GET POST PATCH` | `/planos-preventivos`, `/planos-preventivos/:id` | gestor, administrador |
| `POST` | `/planos-preventivos/:id/gerar` | gestor, administrador (antecipa a próxima execução) |
| `POST GET` | `/tarefas/notificar-atrasos`, `/tarefas/atrasos-pendentes` | só o agendador, com `Authorization: Bearer <CRON_SECRET>` (ver Notificações) |
| `POST GET` | `/tarefas/gerar-preventivas` | só o agendador, com o mesmo segredo; o GET é o do Vercel Cron (ver Manutenção preventiva) |

`GET /health/db` executa uma consulta e devolve 503 quando o banco está
inacessível — `/health` sozinho responde `ok` mesmo com o banco fora, o que
já escondeu falha de conexão em produção. O 503 diz só que o banco está fora;
o motivo (que traz host, usuário e tipo de falha) vai para o log, porque a rota
é pública.

## Locais

Os cinco níveis — unidade, bloco, pavimento, setor e ambiente — são colunas de
uma tabela plana, e só `unidade` é obrigatória. O rótulo legível é montado na
consulta pulando os níveis vazios (`Prédio A / B / Térreo / Sala 101`), e vem
pronto do servidor no detalhe do chamado, no relatório por local e na planilha,
para que as três telas não escrevam o mesmo endereço de três jeitos.

Desde a migração 014 o conjunto dos cinco níveis é chave natural: um índice
único sobre os valores normalizados (`lower(btrim(...))`, com `NULL` valendo
vazio) impede que o mesmo ambiente entre duas vezes, por maiúscula, por espaço
sobrando ou por reenvio de planilha. Tentar cadastrar um repetido devolve 409,
não erro interno. A própria migração consolida o que já tivesse entrado
duplicado: os chamados passam a apontar para o sobrevivente de menor id, que
herda `ativo` do grupo.

### Carga em massa

`POST /locais/importar` recebe `{ "csv": "..." }` — o arquivo como texto, não
como upload. A tela de cadastros tem o seletor de arquivo e um modelo para
baixar.

- separador `;`, `,` ou tabulação, detectado pelo cabeçalho; aspas, aspas
  escapadas e BOM tratados;
- cabeçalho obrigatório, com os nomes das colunas — a ordem não importa, e
  coluna desconhecida é recusada em vez de adivinhada;
- no máximo 500 linhas por arquivo;
- **tudo ou nada**: qualquer linha inválida recusa o arquivo inteiro e devolve
  a lista completa de problemas, linha a linha, em `erro.detalhes`;
- reenviar o mesmo arquivo não duplica nada, então corrigir uma linha e mandar
  a planilha inteira de volta é o caminho normal;
- locais do arquivo que existem mas estão desativados são apontados no
  relatório — não são reativados em silêncio.

No navegador, um arquivo que não for UTF-8 válido é lido como Windows-1252,
que é o que o Excel no Windows grava: sem isso "Térreo" entraria no banco
corrompido e ninguém notaria até o primeiro relatório.

## Equipamentos e manutenção preventiva

O chamado sempre teve local; agora pode ter também **equipamento** (o split da
sala 204, a bomba de recalque, o quadro elétrico do bloco B). O equipamento é
opcional no chamado — nem todo problema é de um — e, quando informado, o local
precisa ser o dele. O código da etiqueta é guardado em maiúsculas, sem espaços
(`bomba-01` e `BOMBA-01 ` são a mesma etiqueta), e é por ele que o endereço
`/chamados/novo?equipamento=CODIGO` abre um chamado já com equipamento, local
e categoria escolhidos. A ficha do equipamento (`/equipamentos/:id`) mostra o
histórico de chamados dele e quantos corretivos teve nos últimos 12 meses.

A **manutenção preventiva** é o que a ABNT NBR 5674 põe no centro da gestão de
manutenção: o que verificar, a cada quanto tempo, onde e por quem. Um plano
(`plano_preventivo`) tem o roteiro do serviço, o equipamento ou o local, a
periodicidade (`3` + `mes`, e não 90 dias), a próxima data, a antecedência
com que o chamado deve ser gerado e, opcionalmente, o técnico responsável.

- O Vercel Cron (`backend/vercel.json`, uma vez por dia) chama
  `GET /tarefas/gerar-preventivas` com o `CRON_SECRET`, que gera um chamado por
  execução que entrou na janela de antecedência. O chamado é comum — mesma
  máquina de estados, conclusão exige o serviço descrito (RN07) — com
  `origem = 'preventiva'`, o plano de onde veio e a data prevista.
- O prazo da preventiva é o fim do dia previsto (no fuso da instituição), e não
  o SLA por prioridade, que foi pensado para o imprevisto. Repriorizar não
  muda o dia combinado.
- Com responsável, o chamado nasce atribuído a ele, passando pelos estados do
  fluxo (aberto → em triagem → atribuído) no histórico; sem responsável, ou com
  o responsável desativado, entra na triagem.
- As datas do plano são sempre `data_inicio + n períodos`: um mensal que começa
  num dia 31 cai no último dia de fevereiro e volta ao dia 31 em março.
- Uma execução, um chamado: o índice único (plano, data prevista) garante isso
  mesmo com duas passagens do agendador ao mesmo tempo. Se o agendador ficar
  parado, a passagem seguinte gera só a execução mais recente, e o histórico
  do chamado diz quantas venceram sem chamado.

O relatório `/relatorios/preventiva` mede o **cumprimento do plano**: das
execuções que já podem ser julgadas (concluídas ou vencidas), quantas foram
feitas até o prazo. As que ainda estão no prazo não entram, para o indicador
do mês não oscilar a cada dia. O mesmo relatório lista os planos com execução
vencida e os equipamentos com mais corretivos — o sinal de que falta (ou falha)
a preventiva deles.

## Celular: instalação, uso sem conexão e etiquetas com QR Code

**Instalável.** O frontend tem manifesto (`public/manifest.webmanifest`) e
service worker (`public/sw.js`): no celular, "Adicionar à tela inicial" abre o
sistema como aplicativo, sem a barra do navegador, com o ícone da marca.

**Sem conexão, para consultar.** O técnico na casa de máquinas, no subsolo,
continua vendo a fila e o chamado que abriu por último: as leituras da fila,
do chamado, dos comentários e da ficha do equipamento são "rede primeiro", com
a última resposta guardada como reserva. A reserva volta marcada, e a tela
mostra a faixa **"Sem conexão"** dizendo que aquilo é a última versão salva,
não o estado de agora. Escrever sem conexão **não** fica guardado para depois:
sincronizar mais tarde exigiria resolver conflito (outra pessoa pode ter
reatribuído ou cancelado enquanto isso), e conflito resolvido errado é registro
de manutenção falso. A ação falha na hora com "nada foi registrado". Os dados
guardados são apagados no login e no logout, para um aparelho compartilhado não
mostrar a fila de uma pessoa a outra. O service worker só é registrado na build
de produção.

**Etiquetas com QR Code** (`/etiquetas`, gestão): imprima e cole no equipamento
ou na porta da sala. O QR leva a `/chamados/novo?equipamento=CODIGO` (ou
`?local=ID`), que abre o formulário já com equipamento, local e categoria. Quem
lê sem estar logado passa pelo login e volta ao formulário: o login devolve ao
endereço pedido, aceitando só caminho interno (`destinoSeguro`, em
`Login.jsx`). O QR é desenhado em SVG pelo próprio React (sem `innerHTML`, a
CSP estrita não tem o que bloquear), e um teste o lê com um decodificador de
verdade para garantir que a etiqueta impressa abre o endereço certo.

## Anexos

Aceita JPEG, PNG, WebP e PDF, até 4 MB — o teto vem do limite de corpo das
funções da Vercel (4,5 MB). Foto de celular passa disso com facilidade, então
a tela reduz a foto antes de enviar (`src/dominio/prepararAnexo.js`): 1600 px
no lado maior, em JPEG, respeitando a orientação da câmera. Um PDF acima do
limite é recusado na hora, sem esperar o envio. O tipo declarado pelo cliente
não é suficiente: o conteúdo é conferido pelos primeiros bytes do arquivo, e
um envio malformado (corpo cortado, cabeçalho de parte quebrado) volta 400
`ENVIO_MALFORMADO`, não 500. O
conteúdo fica em `bytea` no próprio banco, porque o sistema de arquivos das
funções serverless é efêmero — um caminho gravado em disco apontaria para um
arquivo que já não existe na requisição seguinte.

Com `ANEXOS_ARMAZENAMENTO=supabase` (mais `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` e, opcional, `ANEXOS_BUCKET`, padrão `anexos`), os
anexos **novos** vão para um bucket **privado** do Supabase Storage e o banco
guarda só a chave do objeto. A API continua sendo o único caminho até o
arquivo: confere a permissão do chamado e só então lê o objeto com a chave de
serviço — não sai URL pública nem assinada para o navegador. Os anexos antigos
continuam no banco e continuam abrindo: cada linha diz onde está o seu arquivo
(`anexo.armazenamento`). Storage fora do ar vira 502 `ARMAZENAMENTO_INDISPONIVEL`,
sem linha órfã. A chave de serviço ignora as políticas de acesso do banco: fica
só nas variáveis do backend, nunca no frontend.

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

## Distribuição automática

A triagem do gestor continua sendo o caminho padrão. Para as rotinas que não
precisam dela (lâmpada, tomada, torneira pingando), a gestão cadastra uma
regra em **Cadastros › Distribuição**: a categoria, onde vale (a instituição
toda, uma unidade ou um bloco), a equipe e a prioridade. Nenhuma regra vem
cadastrada: sem regra, nada muda.

- O chamado aberto naquela categoria e naquele lugar nasce atribuído, com a
  prioridade da regra (a menos que quem abriu tenha dito outra) e o prazo da
  tabela de SLA. O histórico mostra os mesmos estados de uma triagem manual
  (aberto → em triagem → atribuído) e diz qual regra distribuiu.
- A regra mais específica vence: bloco, depois unidade, depois a instituição.
  Regra de equipe desativada cede à mais geral.
- Dentro da equipe, vai para o técnico de plantão da regra, se houver e
  estiver ativo; senão, para quem tem menos chamados em aberto (no empate,
  quem recebeu há mais tempo). Uma trava por equipe impede que duas aberturas
  simultâneas leiam a mesma carga e caiam no mesmo técnico.
- Sem técnico ativo na equipe, o chamado segue para a triagem, como sem regra.
- Distribuído, o chamado já está atribuído: pela RN03, o solicitante deixa de
  editar o texto e acrescenta o que faltou por comentário, como em qualquer
  chamado com técnico.
- Categoria e alcance não se editam: os chamados guardam a regra que os
  distribuiu (`regra_distribuicao_id`). Para mudar o alcance, desliga-se uma
  regra e cria-se outra.

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

### O agendador parou?

Cada passagem por `/tarefas/*` fica registrada em `execucao_tarefa` (início,
fim, sucesso, o que respondeu, o erro). `GET /operacao/agendador` (gestão)
diz, para cada tarefa, se está `ok`, `parada` (sem sucesso há mais que a
tolerância: 1 h para o aviso de atraso, 26 h para a preventiva), `falhando`
(a última passagem falhou, ou começou e não terminou) ou `nunca` (nenhuma
passagem: o job não foi criado). A tela inicial da gestão mostra um aviso
quando alguma não está `ok`. Antes disso, um agendador parado era silêncio —
e silêncio parece saúde.

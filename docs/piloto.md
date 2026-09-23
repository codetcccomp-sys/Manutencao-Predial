# Roteiro do piloto

O §4.3 do Termo de Abertura é explícito: dados fictícios demonstram que o
sistema funciona, mas não sustentam conclusão sobre eficiência. O piloto existe
para produzir essa conclusão — e ela depende menos do código do que da forma
como o período for conduzido.

Este documento é o roteiro: o que precisa estar pronto antes do primeiro
chamado real, o que medir, e o que declarar de antemão como limitação para que
não vire surpresa no meio do caminho.

---

## 1. A medida de antes

**Isto é o primeiro passo e é o mais fácil de perder.** O sistema não sabe nada
sobre como a manutenção era feita antes dele. Se o piloto começar sem a medida
do processo atual, o período terminará com números bonitos e nenhuma
comparação possível — o sistema terá funcionado, e a pergunta do §4.3 seguirá
sem resposta.

Antes de o primeiro chamado real entrar, registre, do jeito que der (planilha,
caderno, memória da equipe com data), para um período recente de duração igual
à do piloto:

| O que | Por que importa |
| --- | --- |
| Quantas solicitações de manutenção chegaram | Denominador de tudo |
| Por onde chegaram (WhatsApp, papel, verbalmente, e-mail) | Mostra o que o sistema substitui |
| Quanto tempo levou entre o pedido e o atendimento | É o indicador central |
| Quantas se perderam ou foram cobradas de novo | O que o registro formal resolve |
| Como se sabia o que estava pendente | Base da comparação de visibilidade |

Se não houver registro nenhum do período anterior — o que é comum, e é
justamente o problema que o sistema ataca —, **declare isso**. "Não havia
registro" é um resultado do diagnóstico, não uma falha do piloto; o que não se
pode é inventar um número de antes no fim.

### A planilha

[`medida-de-antes.xlsx`](medida-de-antes.xlsx) já tem as colunas da tabela
acima, com três abas: instruções, registro linha a linha e um resumo que se
calcula sozinho.

O resumo devolve exatamente os indicadores que o sistema vai medir depois —
tempo médio e mediano até o atendimento, percentual atendido, quanto se perdeu,
quanto foi cobrado de novo, distribuição por canal e por categoria. As sete
categorias da lista suspensa são as mesmas sete do banco, de propósito: se o
"antes" usar um vocabulário e o "depois" outro, a comparação precisa de
tradução no meio, e tradução no meio é onde o número se perde.

São 200 linhas. Se o período couber em menos, sobra; o resumo só conta o que
estiver preenchido.

---

## 2. Antes de abrir para as pessoas

### 2.1 Aviso de atraso (só você pode fazer)

Sem isto, a RF08 não acontece: o sistema registra o prazo, mostra "em atraso"
na tela, mas ninguém é avisado. Um piloto que mede cumprimento de prazo sem o
aviso mede o processo errado.

1. Gere um segredo, na sua máquina:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Cadastre-o como `CRON_SECRET` nas variáveis de ambiente do projeto
   `manutencao-predial-backend` na Vercel e **redeploy** — variável nova só
   vale a partir do próximo deploy. Confira o nome caractere a caractere: a
   Vercel aceita qualquer nome sem reclamar, e uma variável marcada como
   *Sensitive* depois **não pode ser renomeada** — corrigir exige apagar e
   recriar, porque o valor não é mais legível nem para quem o cadastrou.
3. Aponte um agendador externo (cron-job.org, EasyCron, o que preferir) para:
   ```
   POST https://manutencao-predial-backend-delta.vercel.app/tarefas/notificar-atrasos
   Authorization: Bearer <o segredo>
   a cada 15 minutos
   ```
   Ligue, no agendador, **a notificação de falha de execução** e a gravação da
   resposta no histórico. A notificação não é conforto: o backend não tem como
   saber que ninguém está chamando, então, se o agendador parar, nada no
   sistema acusa (ver as limitações no item 5). Quem pode perceber é o próprio
   agendador, e avisar você é o sinal que fecha esse furo.
4. Confira: a primeira chamada deve devolver `200` com um resumo. Sem o
   cabeçalho, deve devolver `401`.

   Atenção ao "executar teste" do agendador: ele costuma usar o que está no
   formulário, não o que está gravado. Um cabeçalho adicionado e não salvo dá
   `200` no teste e `401` em toda execução agendada. Salve, espere a próxima
   execução automática e confira o `200` **dela** no histórico — é o que prova
   que o que está gravado funciona.

   E, depois de corrigir qualquer coisa aqui, confira se o agendamento ainda
   está de pé: o agendador desativa o job sozinho após falhas seguidas. Um
   histórico que para de registrar — sem sequer uma linha de erro — é isso, e
   parece saúde: ninguém reclama porque ninguém está chamando. Corrigir o
   backend não reativa o job; ele precisa ser religado.

   Um `503` com `CRON_SEM_SEGREDO` significa que o processo não enxerga a
   variável, e isso tem três causas, em ordem de frequência: o nome está
   diferente de `CRON_SECRET` (um caractere basta), o deploy que atende o
   domínio é anterior ao cadastro, ou ela foi cadastrada em Preview em vez de
   Production. Nenhuma delas se distingue da outra pelo código — confira o
   nome primeiro, que é o mais fácil de errar e o mais difícil de ver.

> O segredo é seu e não deve passar por conversa, log ou commit. A rota é
> fail-closed: sem `CRON_SECRET` configurado ela recusa (503) em vez de ficar
> aberta.

### 2.2 E-mail (decisão, não obrigação)

> **Se configurar SMTP, configure `URL_APP` junto.** Ela guarda o endereço do
> APP — `https://conserva-predial.vercel.app` —, que é para onde o link de
> redefinição de senha aponta. Sem ela a API não tem como saber esse endereço:
> front e back são aplicações em domínios diferentes.
>
> A única pista que sobraria é o cabeçalho `Host` da requisição, e esse
> cabeçalho é escolhido por quem faz o pedido. Um pedido com
> `Host: sitedoatacante.exemplo` e o e-mail de alguém faria o link chegar na
> caixa da vítima apontando para o atacante — e o endpoint é público, não pede
> autenticação. Por isso, fora de desenvolvimento e sem `URL_APP`, o e-mail
> não é enviado e a falha vai para o log.

> **`DB_CA_CERT` é obrigatória, e a aplicação não sobe sem ela.**
>
> A conexão com o banco rodava sem verificar o certificado do servidor:
> criptografada e não autenticada. A documentação do Supabase é direta sobre o
> que isso significa — o modo `require` "sempre usa SSL, mas não verifica o
> certificado do servidor nem o hostname". Quem conseguisse se colocar entre a
> Vercel e o Supabase apresentaria um certificado qualquer, seria aceito, e a
> partir daí leria toda consulta, todo hash de senha e todo chamado, podendo
> ainda alterar as respostas no caminho.
>
> Baixe o certificado em **Dashboard → Project Settings → Database → SSL
> Configuration** e cole o PEM inteiro em `DB_CA_CERT`, nas variáveis do
> projeto do backend na Vercel. O certificado de uma CA é público: ele existe
> para ser distribuído, e não é segredo.
>
> A aplicação recusa subir em produção sem ele de propósito. A alternativa
> seria voltar ao modo fraco sozinha, e uma conexão interceptável que funciona
> normalmente não dá sinal nenhum de que está interceptável — descobre-se
> depois, se é que se descobre.

### Limite do pedido de recuperação de senha

O endpoint `POST /auth/recuperar-senha` tem dois tetos, e eles existem para
proteger coisas diferentes:

| Teto | Valor | Protege de |
| --- | --- | --- |
| Pedidos por IP | 15 por hora | script casual vindo de um endereço só |
| Envios no sistema | 100 por dia | esgotamento da cota do provedor |

O segundo é o que importa. O Gmail entrega cerca de 500 mensagens por dia, e
quando essa cota acaba **todo** e-mail do sistema para junto — inclusive o
aviso de atraso do RF08, que o sistema manda sozinho e que ninguém está
esperando na tela para notar que não chegou. Os 100 deixam 400 de folga para
o que o sistema precisa mandar por conta própria.

Estourar o teto trava a recuperação de senha e não trava o resto. É a escolha
certa porque a recuperação tem saída — um administrador redefine a senha pela
tela de Usuários — e o aviso de atraso não tem nenhuma.

Se um prédio grande passar a barrar gente de verdade, o número a mexer é o de
pedidos por IP, em `backend/src/middlewares/rateLimit.js`. Um prédio inteiro
sai por um IP só.


Sem `SMTP_HOST` configurado, as notificações existem só no sino do cabeçalho —
o envio vira registro em log e nada mais muda. Isso funciona, mas muda o que o
piloto mede: quem não abrir o sistema não fica sabendo de nada, e o tempo de
resposta passa a depender de alguém lembrar de entrar.

Duas saídas honestas:

- configurar SMTP antes de começar; ou
- começar sem e-mail e **registrar isso como condição do piloto**, para que o
  tempo de resposta medido seja lido à luz disso.

O que não serve é descobrir no fim que ninguém recebia aviso.

### 2.3 Backup, e a restauração testada

O Supabase mantém backup automático no plano em uso. Um backup que nunca foi
restaurado não é um backup — é uma suposição. Antes de entrar dado de pessoa
real:

1. Confira no painel do Supabase que o backup automático está ativo e qual é a
   janela de retenção do plano.
2. Faça um teste de restauração: restaure para um projeto ou branch separado e
   confira que `usuario`, `chamado` e `historico_chamado` voltam com conteúdo.
3. Anote quanto tempo o teste levou. Esse é o seu tempo de recuperação real, e
   é o número que interessa no dia em que fizer falta.

### 2.4 Carga inicial

Nesta ordem, porque cada passo depende do anterior:

1. **Locais** — pela importação de planilha em Cadastros → Locais (veja o
   README, seção "Carga em massa"). Baixe o modelo, preencha com os ambientes
   do prédio, envie. Reenviar não duplica, então errar e corrigir é barato.
2. **Categorias** — as sete que vêm no esquema inicial cobrem o caso comum;
   ajuste o vocabulário ao que a equipe já usa, porque categoria que ninguém
   reconhece vira "Outros" e estraga o relatório por categoria.
3. **SLA por prioridade** — em `/sla`. Os prazos padrão precisam ser
   confrontados com a realidade da equipe antes de começarem a valer: um SLA
   que ninguém consegue cumprir transforma "atrasado" em ruído, e o indicador
   de prazo deixa de significar qualquer coisa.

   **O relógio é de horas corridas.** `prazo_estimado = now() + prazo_horas`.
   Ele não para à noite, no fim de semana nem em feriado. A única pausa é
   `aguardando_material`, e essa é deliberada: espera por insumo é falha de
   suprimento, não da equipe de campo.

   Isso muda o que cada número significa. Com os padrões originais, um chamado
   crítico aberto numa sexta às 18h estaria atrasado no sábado às 22h, e um
   alto, no sábado à tarde — com equipe de horário comercial, os dois nasciam
   condenados.

   Ajustados em 20/09/2026, com a rotina da equipe ainda indefinida:

   | Prioridade | Antes | Agora | Atravessa |
   | --- | --- | --- | --- |
   | Crítica | 4h | **8h** | uma noite |
   | Alta | 24h | **48h** | um dia útil com folga |
   | Média | 72h | **120h** (5 dias) | um fim de semana |
   | Baixa | 168h | **240h** (10 dias) | com sobra |

   Folgados de propósito. Prazo apertado demais é pior que frouxo demais:
   se tudo nasce vermelho, "atrasado" vira ruído, ninguém olha mais, e o
   indicador morre. Frouxo se conserta com dado real; apertado destrói a
   medida antes de ela existir.

   A crítica em 8h segue curta de propósito. Se um chamado crítico estourar
   num fim de semana, o vermelho não é ruído — é o registro de que não havia
   ninguém para atender uma emergência, que é justamente o que o piloto
   precisa descobrir.

   **Revise no fim do piloto**, com o que a equipe de fato entregou:

   ```sql
   SELECT prioridade,
          count(*) AS concluidos,
          round(percentile_cont(0.5) WITHIN GROUP (
            ORDER BY extract(epoch FROM data_conclusao - data_abertura)/3600
          )::numeric, 1) AS mediana_horas,
          round(percentile_cont(0.9) WITHIN GROUP (
            ORDER BY extract(epoch FROM data_conclusao - data_abertura)/3600
          )::numeric, 1) AS p90_horas
     FROM chamado
    WHERE data_conclusao IS NOT NULL
    GROUP BY prioridade;
   ```

   O p90 é o candidato natural a prazo: é o que a equipe cumpre em nove de
   cada dez casos. Um SLA colado na mediana reprova metade dos chamados por
   construção.
4. **Pessoas** — pela tela de Usuários. O cadastro público só cria
   solicitante; técnico, gestor e administrador saem daqui. Deixe pelo menos
   dois administradores ativos: o sistema impede remover o último, mas dois
   evitam depender de uma pessoa só.

   > **Antes de qualquer outra coisa, crie um administrador com um e-mail que
   > você receba de verdade.** Em 20/09/2026 o único administrador do banco era
   > `admin@manutencaopredial.com` — conta de teste, num domínio que não
   > existe. A consequência não é cosmética: "esqueci minha senha" manda o link
   > para esse endereço, ele nunca chega, e o sistema se recusa a remover o
   > último administrador. Perder essa senha é ficar trancado para fora da
   > gestão de usuários, **sem caminho de volta pela aplicação** — só mexendo
   > direto no banco.
   >
   > A conta de teste pode continuar existindo; o que não pode é ser a única.

Confira antes de liberar: abrir um chamado de teste, triá-lo, atribuir,
concluir e avaliar. Depois cancele-o ou deixe-o marcado — e **não apague**:
não há exclusão no sistema, por decisão, e o primeiro chamado sempre fica no
histórico.

### 2.5 Dados pessoais (LGPD)

A partir do primeiro cadastro real, o banco passa a guardar nome, e-mail e o
histórico de quem pediu o quê e quando. O Termo (RNF01) pede que a política de
retenção seja definida **antes da homologação**; até aqui ela não existe.
Defina e escreva, mesmo que em uma página:

| Pergunta | O que precisa estar decidido |
| --- | --- |
| Que dados pessoais o sistema guarda | Nome, e-mail, perfil, autoria de chamados, comentários, avaliações e anexos |
| Com que base legal | Em geral, execução de atividade da instituição; confirme com quem responde por isso |
| Por quanto tempo | Chamado é registro de manutenção do patrimônio, costuma ter prazo próprio; conta de pessoa desligada, não |
| Quem pode ver o quê | Já está no código: solicitante vê o seu; técnico, o que lhe foi designado; gestão, tudo |
| Quem é o contato | Uma pessoa com nome, para pedido de acesso ou exclusão |

Ponto prático: **desativar uma pessoa não apaga o que ela escreveu**, e isso é
proposital — o histórico do chamado é registro de manutenção. Se a política
exigir remoção de dados pessoais, ela vai precisar ser um procedimento
explícito (anonimizar o nome, manter o chamado), e hoje esse procedimento não
existe no sistema. Decidir isso antes é bem mais barato do que depois.

---

## 3. O desenho do piloto

O §4.3 exige que período, unidade de análise e indicadores estejam definidos
**antes** da comparação. Preencha isto antes do primeiro chamado:

| Campo | Preencher |
| --- | --- |
| Período | De ___ a ___ (sugestão: 4 semanas; menos que 2 não dá amostra) |
| Unidade de análise | O chamado individual |
| Escopo | Quais prédios/blocos entram, e quais ficam de fora de propósito |
| Quem participa | Quantos solicitantes, quantos técnicos, quem faz triagem |
| O que continua fora do sistema | O que a equipe seguirá resolvendo por fora, e por quê |

Esse último campo é o mais revelador. Se, terminado o piloto, metade da
demanda tiver corrido por fora do sistema, os números de dentro não descrevem
a manutenção do prédio — descrevem o pedaço que alguém resolveu registrar. Vale
mais anotar isso desde o começo do que descobrir no fim.

### Indicadores que o sistema já entrega

Tudo abaixo sai de `/relatorios`, sem trabalho manual:

| Indicador | Onde |
| --- | --- |
| Chamados por estado, categoria, prioridade e local | Resumo |
| Demanda aberta e atrasada **por local** | Resumo → por local |
| Tempo médio, mediano e máximo de atendimento | Desempenho → geral |
| Tempo até a triagem, até o início e de execução | Desempenho → marcos (§2.6) |
| % concluído dentro do prazo | Desempenho → prazo |
| Abertos agora e quantos já estouraram | Desempenho → prazo |
| Nota média de avaliação | Desempenho → avaliações |
| Carga e conclusão por técnico | Técnicos |
| Uma linha por chamado, para cruzar o que a tela não previu | Exportar planilha |

O tempo de atendimento desconta a espera por material — é tempo líquido, o que
a equipe de fato controla. Ao comparar com a medida de antes, lembre que o
número informal de antes provavelmente era tempo bruto; compare o que for
comparável ou declare a diferença.

### Indicadores que o sistema não entrega

Precisam ser coletados à parte, e é melhor decidir agora como:

- **Demanda que não virou chamado.** Nenhum sistema mede o que não entra nele.
  Uma pergunta na reunião semanal ("o que vocês resolveram sem abrir chamado?")
  vale mais aqui do que qualquer consulta.
- **Satisfação de quem não avalia.** A avaliação é opcional e quem responde
  costuma ser quem ficou muito satisfeito ou muito insatisfeito.
- **Esforço de adoção.** Quanto tempo a equipe gastou aprendendo, e o que
  travou. Anote durante, não no fim.

---

## 4. Durante

Uma rotina semanal curta, sempre no mesmo dia:

1. Abrir o resumo e olhar **por local**: onde há demanda parada é onde o
   problema está, não onde há mais chamados.
2. Conferir que o agendador de atraso rodou. No histórico do serviço, olhe a
   **última linha**, não a cor delas: erros seguidos significam que ninguém
   está sendo avisado, e um histórico que simplesmente parou significa a mesma
   coisa, de forma mais discreta. Com a notificação de falha ligada, isso vira
   conferência de rotina em vez de vigilância — mas ela avisa sobre chamada
   que falha, não sobre chamada que deixou de acontecer, então a olhada
   continua valendo.
3. Exportar a planilha do período e guardar. É o dado bruto do piloto; se algo
   for reconfigurado no meio do caminho, a série exportada preserva o que
   havia.
4. Anotar, em uma linha, o que atrapalhou na semana. Esse caderno costuma valer
   mais que os indicadores na hora de decidir o que fazer depois.

Se algo quebrar: `GET /health/db` responde `503` quando o banco está
inacessível, e é a primeira coisa a checar antes de supor qualquer outra coisa.

---

## 5. Limitações declaradas

Conhecidas, decididas, e melhor ditas no começo:

- **Hierarquia de locais é plana.** Os cinco níveis são colunas, não uma
  árvore. Filtrar "tudo do Bloco A" funciona por texto, não por estrutura. Para
  um prédio, basta; para um campus com muitas unidades, vai incomodar.
- **Não há auditoria geral.** Existe histórico por chamado — transições de
  estado, quem e quando. Não existe trilha de quem alterou cadastro, SLA ou
  perfil de usuário.
- **Não há log estruturado.** Erros vão para o log da Vercel em texto. Para
  investigar um incidente, dá; para acompanhar tendência, não.
- **O aviso de atraso depende de serviço externo.** Se o agendador parar, o
  sistema não reclama — ninguém é avisado e nada indica isso na tela. A
  notificação de falha do agendador (item 2.1) cobre o caso em que a chamada
  acontece e dá erro; não cobre o caso em que ela simplesmente deixa de
  acontecer, que é por isso que a conferência do item 4 continua na rotina.
- **Não há exclusão de nada**, por decisão: locais e equipes são desativados,
  comentários e histórico não somem. Ver o item 2.5 sobre o que isso implica
  para dado pessoal.

---

## 6. No fim

Responder, com os números na mão e as três primeiras respostas por escrito:

1. O tempo entre pedido e atendimento caiu em relação à medida de antes? Em
   quanto, e com quantos chamados de amostra?
2. Alguma demanda se perdeu durante o piloto? (No sistema, não deveria; fora
   dele, veja o item 3.)
3. A gestão passou a saber onde está a demanda parada sem perguntar a ninguém?
4. O que a equipe pediu que o sistema não faz — em ordem do que mais atrapalhou.

A quarta pergunta é a que define o trabalho seguinte. As três primeiras são a
conclusão que o §4.3 pede.

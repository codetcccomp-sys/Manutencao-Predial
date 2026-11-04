# Dados pessoais e retenção

> ## O que este documento é, e o que não é
>
> **É um artefato acadêmico**, produzido para o trabalho de conclusão de curso
> que originou o sistema. Atende a RNF01 do Termo de Abertura v1.2, que pede a
> política de retenção definida antes da homologação.
>
> **Não é** política institucional adotada. Nenhuma instituição o aprovou,
> assinou ou formalizou, e ele não foi revisado por quem responde juridicamente
> por tratamento de dados. Quem o encontrar junto ao TCC não deve entendê-lo
> como compromisso firmado por ninguém além da equipe que o escreveu.
>
> Isso não o torna decorativo: o conteúdo foi levantado do banco de produção e
> do código, não de um modelo genérico, e o que ele descreve o sistema de fato
> faz — inclusive o procedimento de remoção da seção 5, que existe como rota
> testada. Se o piloto um dia rodar com dados de pessoas reais, este documento
> é a base pronta para a instituição revisar e adotar.

A RNF01 pede que a política de retenção esteja definida **antes da
homologação**. Este documento a define.

> **Decidido em 23/09/2026:** prazos de retenção (seção 2), base legal
> (seção 4), remoção sob pedido (seção 5) e plano de incidente (seção 6).
>
> **Restam dois 🔲.** Nenhum bloqueia o trabalho acadêmico — o raciocínio das
> alternativas já está escrito, que é o que a RNF01 pede. São campos a
> preencher **se e quando** o sistema passar a tratar dados de pessoas reais:
>
> 1. Em que instituição o piloto roda, e se ela é pública ou privada
>    (a justificativa das duas já está escrita, com o teste de ponderação
>    exigido no caso privado — falta marcar qual).
> 2. O nome dessa instituição como controladora.
>
> O resto é descrição do que o sistema já faz, e pode ser conferido no código.
>
> **Um terceiro ponto, para a instituição revisar** (seção 7): o banco e as
> funções que executam o sistema ficam em São Paulo (desde 13/10/2026; antes,
> as funções rodavam nos Estados Unidos), mas os provedores (Vercel, Supabase e
> Google, este no envio de e-mail) são empresas estrangeiras.

---

## 1. Que dados pessoais o sistema guarda

Levantado das tabelas em produção. "Pessoal" aqui inclui o que identifica uma
pessoa indiretamente, como o endereço de rede.

| Onde | O quê | Por que existe |
| --- | --- | --- |
| `usuario` | nome, e-mail, perfil, data de criação | Identificar quem pede e quem atende |
| `usuario` | `senha_hash` (bcrypt) | Autenticação. A senha em si não é guardada |
| `chamado` | quem abriu, quem atende, textos livres | O registro da manutenção |
| `comentario` | autor e texto livre | Conversa do chamado (RN03) |
| `historico_chamado` | quem mudou o estado e quando | Auditoria do fluxo (§2.4) |
| `avaliacao` | nota e comentário | RF09. Ligada ao chamado, não à pessoa |
| `anexo` | autor, nome do arquivo e **o arquivo** | Foto do problema |
| `notificacao` | destinatário e mensagem | Sino e e-mail |
| `equipe_tecnico` | quem está em qual equipe | Distribuição |
| `tentativa_login` | **e-mail e IP** de cada tentativa | Bloquear força bruta |
| `erro_aplicacao` | rota (sem query string), código e mensagem do erro, com e-mails mascarados; **sem usuário, IP nem corpo**. Do servidor (5xx) e da tela (método `TELA`, a tela pelo modelo da rota) | Achar defeito (a Vercel Hobby guarda os logs por 1 hora) |
| `telemetria_diaria` | **só contadores** por dia: aberturas por tela (pelo modelo da rota), ações e medidas de desempenho (soma, quantidade, pior valor); **nenhuma coluna de pessoa, sessão, IP ou aparelho** | Saber o que se usa e o que está lento (migração 031) |
| `tentativa_cadastro` | **IP** de cada pedido de cadastro, sem o e-mail | Conter cadastro em massa (a fila de pendentes e a CPU da função) |
| `recuperacao_senha` | **IP** de quem pediu, hash do token | Rastrear pedido de troca de senha |
| `usuario`, `codigo_recuperacao_2fa` | chave do aplicativo autenticador e data de ativação; códigos de recuperação em hash | Verificação em duas etapas (só de quem liga) |

Dois pontos que passam despercebidos:

**Os anexos são fotos, e foto tem gente dentro.** Uma foto de sala alagada pode
pegar uma pessoa no enquadramento sem que ninguém tenha pensado nisso. O
arquivo fica no banco (`anexo.conteudo`), não num serviço externo.

**Entrar com Google não traz dado novo.** Do Google, o sistema usa só o nome
e o e-mail da credencial, para achar ou criar a conta; não guarda a
credencial, nem foto, nem token de acesso ao Google, e não pede permissão a
nada além do login.

**`tentativa_login` guarda o e-mail de quem tentou entrar e errou** — inclusive
de quem não tem conta. É dado pessoal de gente que nunca se cadastrou.

**`telemetria_diaria` não é dado pessoal**, e é desenhada para continuar não sendo:
um número por (dia, o quê, onde), sem como voltar a uma pessoa. A tela vai pelo
**modelo** da rota (`/chamados/:id`), nunca pelo endereço real; quem grava confere
cada nome contra uma lista fechada; e nada é guardado no aparelho (seção 8). Um teste
(`backend/tests/telemetria.test.js`) falha se a tabela ganhar uma coluna.

---

## 2. Por quanto tempo

O que o sistema **já apaga sozinho**, sem ninguém pedir:

| Dado | Prazo | Onde está no código |
| --- | --- | --- |
| Tentativas de login | **24 horas** | `middlewares/rateLimit.js` |
| Pedidos de cadastro (só o IP) | **24 horas** | `middlewares/rateLimit.js` |
| Pedidos de redefinição de senha | **7 dias** | `services/recuperacao.service.js` |
| Erros de servidor e de tela | **30 dias** | `services/erros.service.js` |
| Contadores de uso e desempenho | **90 dias** | `services/telemetria.service.js` |

O que **nunca é apagado**, por decisão de projeto:

- **Chamados, histórico, comentários, avaliações e anexos.** São registro de
  manutenção do patrimônio, e o sistema não tem exclusão em lugar nenhum: o
  primeiro chamado fica no histórico para sempre.
- **Contas de usuário.** Desativar (`ativo = false`) tira a pessoa do sistema
  mas preserva o que ela escreveu, para o histórico do chamado não ficar com
  buracos.

### Prazos definidos

Dois prazos, porque são duas coisas diferentes:

| O quê | Prazo | Depois |
| --- | --- | --- |
| Chamado, histórico, comentário, avaliação, anexo | **5 anos** a partir da conclusão | Descarte |
| Conta de pessoa desligada | **2 anos** após o desligamento | Anonimização (seção 5) |
| Pedido de cadastro recusado | Nenhum | Apagado na recusa: a pessoa nunca entrou no sistema |

O registro de manutenção fica cinco anos porque é documentação do patrimônio,
não dado sobre a pessoa: o que interessa ali é o que foi feito no prédio. A
conta segue prazo mais curto porque o que ela guarda — nome e e-mail — é
sobre a pessoa e nada mais.

**Nenhum dos dois prazos é executado automaticamente hoje.** A anonimização de
conta existe como procedimento sob pedido (seção 5); o descarte de chamados
antigos não existe, e nada no sistema apaga chamado. Quando o piloto chegar
a cinco anos, isso precisará de código — o que é um problema de 2031, mas
ficar escrito evita que vire surpresa.

---

## 3. Quem pode ver o quê

Isto já está no código e é verificado por teste; não é uma promessa.

| Perfil | Alcance |
| --- | --- |
| `solicitante` | Só os chamados que abriu |
| `tecnico` | Só os chamados designados a ele |
| `gestor` | Todos os chamados, relatórios e cadastros |
| `administrador` | Tudo, mais a criação de usuários |

O cadastro público cria sempre `solicitante`. Os demais perfis só saem da mão
de um administrador autenticado.

---

## 4. Base legal e responsável

### Base legal

A base legal é escolhida por quem controla os dados, para uma atividade
concreta. Uma instituição é pública **ou** privada — não as duas. Mas o
sistema é software que pode ser instalado em qualquer uma delas, e por isso
esta seção tem dois níveis: o que vale para o sistema, e o que vale para o
prédio onde ele está rodando.

#### No nível do sistema: as duas hipóteses que cabem

| Se a instituição for | Base legal | LGPD |
| --- | --- | --- |
| Pública | Execução de política pública / atribuição legal | art. 7º, III |
| Privada | Legítimo interesse | art. 7º, IX |

Em nenhum dos dois casos é consentimento, e vale dizer por quê: consentimento
teria de ser **livre**, e quem precisa abrir chamado para consertar a própria
sala de trabalho não está em posição de recusar. Base legal escolhida errado é
pior que base legal ausente, porque parece resolvida.

O dado tratado é o mínimo para a finalidade — nome, e-mail e o que a pessoa
escreveu no chamado —, o que sustenta qualquer das duas.

**As duas não são equivalentes, e a diferença é do titular, não nossa:**

| | Pública (art. 7º, III) | Privada (art. 7º, IX) |
| --- | --- | --- |
| Titular pode se opor ao tratamento | Não, nos mesmos termos | **Sim** (art. 18, §2º) |
| Exige teste de ponderação registrado | Não | **Sim** |

Por isso "depende" não encerra o assunto: sob legítimo interesse existe um
direito que sob execução de política pública não existe do mesmo jeito. Deixar
os dois abertos sem dizer qual vale deixaria esse direito sem resposta.

#### No nível deste piloto

🔲 **Preencher quando souber onde o sistema vai rodar:**

| | |
| --- | --- |
| Instituição | `________________________` |
| Natureza | ( ) pública — art. 7º, III &nbsp;&nbsp; ( ) privada — art. 7º, IX |

É fato sobre a instituição, não escolha de projeto. A justificativa das duas
já está escrita acima; falta só marcar qual.

#### Teste de ponderação, para o caso privado

Escrito por antecipação. Se o piloto for numa instituição pública, esta parte
sobra sem custo; se for privada, ela é exigida e já existe — em vez de ser
redigida às pressas no dia em que alguém perguntar.

**Finalidade.** Receber, distribuir e acompanhar pedidos de manutenção predial,
e medir o desempenho do atendimento (§4.3 do Termo). Sem identificar quem pede
não há como avisar sobre o andamento nem apurar quem atendeu.

**Necessidade.** São tratados nome, e-mail institucional, perfil de acesso e o
que a pessoa escreveu no chamado. Não há coleta de dado sensível, de documento
de identificação, de telefone nem de endereço residencial. O IP é guardado só
para conter ataque de senha e cadastro em massa, por 24 horas, e no pedido de
recuperação, por 7 dias.

**Expectativa do titular.** Quem abre um chamado de manutenção espera ser
identificado nele: é a condição para o problema ser resolvido e para a pessoa
receber a resposta. Não há uso secundário — nada é usado para publicidade,
perfilamento ou avaliação de desempenho individual de quem pede.

**Salvaguardas.** Acesso por perfil, verificado por teste automatizado
(seção 3); senha guardada só como hash bcrypt; conexão com o banco verificada
por certificado; retenção definida (seção 2); e procedimento de anonimização
sob pedido (seção 5), que é o próprio direito de oposição sendo atendido na
prática.

**Conclusão.** O tratamento é o mínimo para a finalidade, está dentro da
expectativa de quem usa, e o titular tem como se opor — pelo procedimento da
seção 5. O legítimo interesse se sustenta.

### Quem responde pelo quê

São três papéis distintos, e amontoá-los numa linha só é o erro mais comum
deste tipo de documento.

**Controlador** — quem decide que o tratamento acontece, e responde por ele
perante a ANPD.

| | |
| --- | --- |
| Instituição | 🔲 `________________________` |

Não é a equipe do projeto. Quem decide que o prédio vai usar este sistema para
tratar dados de quem trabalha nele é a instituição; a equipe construiu e opera.
A distinção muda quem responde se algo der errado, e o documento anterior
sugeria, por omissão, o contrário.

**Contato do titular** — quem recebe e responde pedido de acesso, correção ou
remoção (seção 5).

| | |
| --- | --- |
| Nome | Issamuel Amorim de Sousa Júnior |
| Contato | `code.tcc.comp@gmail.com` |

**Uma pessoa, não a equipe.** Este papel não se divide: uma lista de cinco
nomes faz cada um supor que outro respondeu, e o pedido fica sem resposta
dentro do prazo. É o caso em que "todos" quer dizer "ninguém".

O nome acima é o de quem detém a conta administradora e a caixa que receberia
o pedido hoje — ou seja, quem de fato consegue atendê-lo.

> Este documento vive num repositório privado. Se ele for publicado junto com
> o TCC, o endereço vai junto — vale trocá-lo por um institucional antes, ou
> tirar esta linha da versão pública.

**Supervisão acadêmica**

| | |
| --- | --- |
| Professor responsável | Aucionio Miranda |

**Equipe técnica** — quem construiu e opera o sistema.

| Papel | Nome |
| --- | --- |
| Gerente do projeto | Abraão Henrique de Sousa Ribeiro |
| Integrante | Issamuel Amorim de Sousa Júnior |
| Integrante | Pedro Henrique Ferreira da Silva |
| Integrante | Francisco Osmano de Araújo Carvalho |
| Integrante | Maria Clara Araújo Sampaio |
| Integrante | Felipe Sousa Carvalho |

Os nomes da equipe vieram do bloco de aprovação do Termo de Abertura v1.2,
onde aparecem sem sobrenome completo. Num documento de proteção de dados isso
não identifica ninguém com segurança, e por isso os seis foram completados
com os nomes informados pelo próprio grupo.

---

## 5. Como atender um pedido de remoção

**Desativar uma pessoa não apaga o que ela escreveu, e isso é proposital.**
Para o pedido de remoção existe um procedimento separado.

### Na prática

Na tela **Usuários**, o botão **Anonimizar** da pessoa. O sistema pergunta
antes, porque a ação não tem volta. Por trás, a tela chama:

```
POST /usuarios/:id/anonimizar
```

Só administrador executa, e **ninguém executa na própria conta**: a ação não
tem desfazer e tira o acesso no mesmo instante, então exige um segundo par de
olhos.

**Técnico com chamado em aberto não é anonimizado, nem desativado, nem muda
de perfil.** A conta não entra mais, e o chamado ficaria designado a ninguém
que possa agir — fora do filtro "sem técnico" e fora da fila de qualquer
pessoa. O sistema recusa e diz quantos chamados estão pendentes; a gestão
reatribui (com justificativa e histórico, como pede o RF05) e depois conclui
a saída. A regra é a mesma nos três caminhos porque o estrago é o mesmo:
chamado parado sem responsável. Reativar e renomear não são bloqueados.

**A sessão aberta cai na hora.** Até a revisão de 24/09 o acesso dependia só
do token, que vale 8 horas: a pessoa anonimizada continuava entrando até ele
expirar. Agora cada requisição confere a conta no banco, e a sessão de quem
foi anonimizado — ou desligado, ou teve o perfil trocado — é encerrada na
requisição seguinte.

Conta anonimizada aparece como **Anonimizado** na lista, sem ações: não volta,
e a segunda anonimização é recusada.

Rodar duas vezes é recusado: a segunda passagem não teria o que apagar e só
moveria a data, fazendo parecer um pedido novo.

É `POST` e não `DELETE` de propósito. Um `DELETE` que deixa a linha no banco
engana quem lê a rota, e alguém poderia "completar" o DELETE mais tarde
achando que conserta uma implementação pela metade — levando junto todo o
histórico do prédio.

### Decidido: sim, por anonimização

A política exige atender pedido de remoção, e o atendimento é **anonimizar a
pessoa, preservando o registro da manutenção**.

Não é exclusão, e a diferença importa: apagar a linha de `usuario` arrastaria
ou quebraria todo chamado, comentário e evento de histórico ligado a ela — o
prédio perderia o registro do que foi consertado por causa de um pedido sobre
dado pessoal. Anonimizar separa as duas coisas: some quem era, fica o que foi
feito.

**O que a anonimização faz:**

| Campo | Vira |
| --- | --- |
| `nome` | `Usuário removido` |
| `email` | endereço-lápide em `.invalid`, que nenhum servidor entrega |
| `senha_hash` | valor impossível de casar com qualquer senha |
| `ativo` | `false` |
| `anonimizado_em` | data do pedido, para provar que foi atendido |

Apaga junto o que só existe por causa da pessoa: suas notificações, suas
tentativas de login e seus pedidos de recuperação de senha — este último é o
que guarda IP. A contagem de cadastros (`tentativa_cadastro`) não guarda e-mail nem
nada que a ligue a uma pessoa: não há o que apagar por pedido, e ela some sozinha
em 24 horas.

Preserva chamados, comentários, avaliações, anexos e histórico, agora
assinados por "Usuário removido".

É irreversível por definição: nada guarda o nome original.

> **Limite conhecido, e declarado de propósito.** A anonimização alcança os
> campos da pessoa, não o texto que outras pessoas escreveram. Se alguém citou
> um nome no corpo de um comentário, aquele nome continua lá. Varrer texto
> livre em busca de nomes daria falso positivo em palavra comum e falso
> negativo em apelido — e apagar por engano o conteúdo técnico do chamado é
> dano certo contra risco incerto.
>
> O procedimento para esse caso é manual: quem receber o pedido busca o nome
> nos comentários e edita os que existirem. Não é automático, e fingir que é
> seria pior.

---

## 6. O que fazer se houver vazamento

### O plano

Ao suspeitar de acesso indevido, nesta ordem:

1. **Trocar `JWT_SECRET` na Vercel e fazer o redeploy.** Derruba todas as
   sessões na hora, inclusive as de quem entrou indevidamente. É o primeiro
   passo porque é o único que interrompe um acesso em curso.
2. **Trocar a senha do banco no Supabase** e atualizar `DATABASE_URL`.
3. **Avisar o responsável (seção 4) em até 24 horas** do momento em que a
   suspeita surgiu — não do momento em que ela foi confirmada.
4. **Avisar os titulares afetados em até 72 horas**, se houver risco a eles.
   Vazamento de nome e e-mail de quem abriu chamado de manutenção é risco
   baixo; vazamento dos anexos pode não ser, porque foto de ambiente pode ter
   gente dentro.
5. **Registrar o que aconteceu por escrito**, ainda no mesmo dia: o que
   vazou, de quando até quando, e como se descobriu.

A ordem não é burocrática. O passo 1 primeiro porque avisar alguém enquanto o
acesso continua aberto é gastar as horas que importam.

Dados úteis para esse plano:

- O banco é PostgreSQL gerenciado pelo Supabase. **No plano Free não há backup
  automático restaurável** — a documentação do Supabase é explícita, e a
  recomendação deles é exportar por conta própria. O que existir será o
  `pg_dump` da seção 2.3 do roteiro de piloto. Num incidente, recuperar o
  estado anterior depende inteiramente de alguém ter rodado aquele comando.
- Só o `DATABASE_URL` dá acesso, e ele é variável de ambiente na Vercel,
  marcada como *sensitive*.
- A conexão entre a aplicação e o banco verifica o certificado do servidor
  (cadeia e hostname) desde 23/09/2026. Antes disso ela era criptografada mas
  não autenticada: aceitava qualquer certificado. Se o plano de incidente
  precisar considerar a janela anterior a essa data, é este o buraco.
- Trocar a senha do banco invalida todas as sessões de aplicação, mas **não**
  os tokens JWT já emitidos: eles valem até expirar. Revogar de verdade exige
  trocar o `JWT_SECRET`, o que derruba todo mundo de uma vez — e é isso que se
  quer, num incidente.

---

## 7. O aviso ao titular, na tela

A página pública `/privacidade` (`frontend/src/pages/Privacidade.jsx`) é o aviso
que a pessoa lê. Aparece apontada no **cadastro**, na **tela de entrada** (por
onde entra quem cria a conta pelo Google, sem nunca ver o cadastro) e em
**Minha conta**. Nos três, abre em outra aba para quem já digitou o formulário
não perdê-lo.

Ela descreve o que o sistema faz, conferido nas seções 1, 2, 3 e 5 deste
documento, e por isso **os dois andam juntos**: mudou um dado guardado, um
prazo, a hospedagem ou o contato, muda aqui e na página. O teste
`frontend/testes/Privacidade.test.jsx` guarda o que a página não pode prometer
a mais.

**O que a página diz de propósito, e não deve ser "melhorado" antes de a
realidade mudar:**

| Na página | Por quê |
| --- | --- |
| Não há controlador nomeado; diz que a instituição "ainda não foi formalizada" | É o 🔲 da seção 4. Inventar um nome é pior que a lacuna |
| Não cita base legal | Depende de a instituição ser pública ou privada (seção 4) |
| Os prazos de 5 e 2 anos aparecem como **previstos** | Nenhum dos dois é executado hoje (seção 2) |
| Diz que os servidores que executam o sistema também ficam em São Paulo | É o que o `backend/vercel.json` fixa (`"regions": ["gru1"]`); sem isso a Vercel usa `iad1`, nos Estados Unidos. O banco, no Supabase, fica em São Paulo (`sa-east-1`). O teste lê o `vercel.json` e falha se a região mudar sem o aviso |
| O contato é a caixa `code.tcc.comp@gmail.com`, sem nome de pessoa | É a caixa que recebe o pedido; a seção 4 nomeia quem responde |

**Para a instituição revisar quando existir:** (a) o nome do controlador e a
natureza, públicos ou privados, que preenchem a seção 4 e a página; (b) a
transferência internacional: a execução e o banco ficam em São Paulo, mas os
provedores são empresas estrangeiras, e o envio de e-mail passa pelo Gmail, cujos
servidores não controlamos. Se isso configura transferência, é decisão de quem
responde juridicamente; (c) trocar o e-mail do contato por um institucional.
Nada disto foi revisado por quem responde juridicamente.

---

## 8. Cookies, termos de uso e suporte, na tela

Três páginas públicas completam o aviso de privacidade, e **andam com ele**: quem
muda o que o sistema guarda no aparelho, as condições de uso ou o canal de contato muda
aqui e na página.

| Página | Arquivo | O que diz | O que não pode prometer |
| --- | --- | --- | --- |
| `/cookies` | `frontend/src/pages/Cookies.jsx` | O que fica no aparelho: o cookie `conserva_sessao` (HttpOnly), `smp_usuario` (localStorage), `smp_recarga_de_tela` (sessionStorage) e o cache do service worker; o controle que apaga as consultas guardadas | Que há faixa de consentimento: não há, porque nada ali é opcional |
| `/termos` | `frontend/src/pages/TermosDeUso.jsx` | Para que serve, quem usa, o que se espera de cada pessoa, que **não é canal de emergência**, que prazos são metas de acompanhamento e que, sem conexão, o que se tenta registrar não é salvo | Foro, multa, indenização, disponibilidade garantida ou instituição nomeada |
| `/suporte` | `frontend/src/pages/Suporte.jsx` | Um e-mail (o do projeto, `dominio/contato.js`) com roteiro do que contar, e o que tentar antes | Prazo de resposta, chat ou canal de mensagem instantânea |

**Consentimento.** Tudo o que o sistema grava no aparelho é estritamente necessário ao
serviço que a pessoa pediu ao entrar (manter a sessão, desenhar a tela, abrir sem conexão).
Não há cookie de análise, de publicidade nem de rastreamento, e **o Google Analytics não é
usado**; por isso a faixa de consentimento seria um falso controle. O que existe é o
controle que de fato muda algo: apagar as consultas guardadas no aparelho (útil em
aparelho compartilhado; também apagadas ao entrar e ao sair). Se um dia entrar qualquer
ferramenta que não seja estritamente necessária (análise de audiência, mapa, vídeo
incorporado), o consentimento prévio, com opção de recusar tão simples quanto a de aceitar,
passa a ser obrigatório **antes** de ela ser ligada, e a página de cookies muda junto. O
teste `frontend/testes/PaginasDeInformacao.test.jsx` falha se aparecer código de análise
na página ou nas dependências.

**O único terceiro na tela é o Google**, e só quando o acesso por ele está ligado
(`GOOGLE_CLIENT_ID`): a tela de entrada carrega o componente de `accounts.google.com`, que
pode gravar cookies próprios. As telas internas não o carregam. A página de cookies diz isso.

**Monitoramento próprio, sem terceiros.** O sistema mede o que se usa, quão rápido abre e o que
quebra, e guarda só **contadores por dia** (`telemetria_diaria`, migração 031) e os erros da tela
em `erro_aplicacao`. O Google Analytics e qualquer ferramenta de terceiros **não** são usados, e
nenhuma tela interna carrega script de fora.

| O quê | Como | Onde |
| --- | --- | --- |
| Aberturas de tela | Uma contagem por **modelo** de rota, a cada troca de tela | `monitoramento/`, `AnuncioDeRota` |
| Desempenho | FCP, LCP, CLS e INP da carga da página, pela API do navegador; vai uma vez por visita, ao esconder a página | `monitoramento/vitais.js` |
| Ações | Só o **nome** (`chamado_aberto`, `relatorio_baixado`...), nunca o conteúdo nem o número do chamado | `registrarAcao` nas telas |
| Erros da tela | Mensagem (e-mail mascarado no servidor), tela pelo modelo da rota e pilha; no máximo 5 por carga | `LimiteDeErro`, `window.onerror` |

Por que isso dispensa consentimento: não há cookie, identificador, IP gravado, nem nada no aparelho
(os números ficam em memória até o envio); o dado que chega ao banco não permite voltar a uma pessoa.
Mesmo assim, **quem liga "Não rastrear" (DNT) ou o Controle de Privacidade Global no navegador não é
medido** (uso e desempenho); só o erro da tela segue, porque não identifica ninguém e é como o
defeito chega a quem o conserta. O teste `frontend/testes/telemetria.test.js` falha se o código da
telemetria passar a ler `localStorage`, `document.cookie`, `userAgent`, o endereço da página ou a
falar com outra origem. O administrador lê tudo em **Usuários ▸ Uso e desempenho**.
Se a instituição quiser análise de audiência de terceiros, é decisão dela e passa a exigir
consentimento prévio (acima).

**Indexação.** O sistema é de uso interno: nenhuma tela entra em buscador (`noindex,
nofollow` na meta `robots` do `index.html` e no cabeçalho `X-Robots-Tag` de
`frontend/vercel.json`, repetido em `demo/frontend/vercel.json`). O `robots.txt` orienta os
robôs a não rastrear as telas internas nem a API, e deixa rastreáveis as públicas para que
eles leiam o `noindex`. **Isso é pedido a robôs, não controle de acesso**: quem controla é o
login, e a API recusa sem sessão. Rota nova atrás do login entra no `robots.txt` (o teste
`frontend/testes/Indexacao.test.js` confere). Para a instituição decidir: se quiser que o
aviso de privacidade apareça em buscas, troca-se o `noindex` dessa página.

**Para a instituição revisar quando existir:** o prazo de 90 dias dos contadores e os termos de uso (foro, responsabilidades e
hipóteses de suspensão) e o e-mail de suporte, que hoje é o do projeto.

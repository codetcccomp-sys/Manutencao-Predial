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
| `recuperacao_senha` | **IP** de quem pediu, hash do token | Rastrear pedido de troca de senha |

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

---

## 2. Por quanto tempo

O que o sistema **já apaga sozinho**, sem ninguém pedir:

| Dado | Prazo | Onde está no código |
| --- | --- | --- |
| Tentativas de login | **24 horas** | `middlewares/rateLimit.js` |
| Pedidos de redefinição de senha | **7 dias** | `services/recuperacao.service.js` |

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
para conter ataque de senha, por 24 horas, e no pedido de recuperação, por 7
dias.

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
que guarda IP.

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

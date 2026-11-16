# Ensaio com pessoas

Kit para executar o ensaio que falta ao Termo: **a abertura de chamado executável sem ajuda
externa** (RNF02, critério de aceite de §4.2) e os 12 cenários do fluxo com os perfis reais
(`docs/matriz-de-testes.md`, seção 13). Teste automático prova cada regra; só pessoas usando o
sistema provam que ele é usável. Imprima as seções 4 a 7; a versão em PDF sai do mesmo texto.

Nada aqui é preenchido de antemão. Resultado que não foi observado fica em branco.

---

## 1. O que se quer saber

| Pergunta | Como se responde | Critério proposto |
| --- | --- | --- |
| Um solicitante abre um chamado sozinho? | Tarefa S1, sem nenhuma ajuda | **Todos** os solicitantes concluem sem ajuda |
| O fluxo inteiro anda com os perfis reais? | Tarefas T1–T3 e G1–G4, e os 12 cenários | Cada cenário com resultado observado igual ao esperado |
| Quanto tempo leva? | Cronômetro, do toque em "Novo chamado" ao protocolo na tela | Registrar; sem meta no Termo |
| Como as pessoas avaliam o uso? | Questionário SUS (seção 6) | 68 ou mais (a média de mercado do SUS) |

O critério "todos sem ajuda" é a leitura literal do Termo. Com cinco solicitantes, um que não
conclua já é achado: anote onde travou e corrija antes do piloto. O 68 do SUS é referência, não
regra do Termo.

## 2. Quem participa

- **Solicitantes:** 5 (no mínimo 3). Pessoas que pediriam manutenção de fato, sem ter visto o
  sistema antes. Ninguém da equipe do projeto.
- **Técnicos:** 2. **Gestão:** 1 ou 2 (quem fará a triagem no piloto).
- **Facilitador:** lê as tarefas, cronometra e **não ajuda**. **Observador:** anota na ficha.
  Podem ser a mesma pessoa, mas fica mais difícil.

Cinco pessoas por perfil acham a maior parte dos problemas de uso de uma tela; mais do que isso
repete achados.

## 3. Preparação (na véspera)

1. **Ambiente.** Use a demonstração publicada se ela estiver configurada
   (`docs/demonstracao-publicada.md`): dados fictícios, nada a limpar. Sem ela, use a produção com
   **contas de ensaio** criadas pela administração na tela Usuários (e-mail fictício, perfil certo)
   e, no fim, (a) a gestão cancela cada chamado do ensaio com a justificativa "Ensaio de
   usabilidade" e (b) a administração desativa as contas. Chamado cancelado continua no histórico e
   nos relatórios como cancelado: anote os protocolos para descontá-los no piloto.
2. **Aparelhos.** Pelo menos um celular (o técnico usa o celular) e um computador. Navegador
   atualizado. Wi-Fi e, para o cenário 10, um jeito de cortar a rede (modo avião).
3. **Contas.** Uma por participante, com senha anotada num papel entregue na hora. A gestão de
   produção exige verificação em duas etapas: a conta de ensaio da gestão precisa do aplicativo
   autenticador no aparelho de quem vai usá-la.
4. **Conferência.** Na manhã do ensaio, entre com cada perfil e abra um chamado de teste. Confira
   que o painel da gestão não mostra "Tarefas automáticas paradas" (o aviso de atraso depende do
   agendador).
5. **Impressos.** Seção 4 (uma por sessão), seção 5 (uma por participante), seção 6 (uma por
   participante), seção 7 (uma por ensaio).

Para fazer tudo numa rodada só, com todos os perfis ao mesmo tempo, siga a seção 9: ela diz quem
faz o quê a cada momento e quais contas criar.

## 4. Roteiro do facilitador

**Abertura (leia em voz alta, 2 min):**

> Obrigado por participar. Estamos testando o sistema, não você: se algo ficar difícil, é um
> defeito do sistema e é exatamente isso que queremos encontrar. Vou pedir algumas tarefas.
> Durante elas, não vou poder ajudar nem responder como fazer; diga em voz alta o que está
> pensando, o que procura e o que espera que aconteça. Você pode parar a qualquer momento. Não
> anotamos seu nome nem gravamos sua tela ou sua voz; anotamos só o seu perfil, o tempo e o que
> aconteceu. Podemos começar?

**Regras para quem conduz:**

- Leia a tarefa exatamente como está escrita e entregue o papel. Não aponte para a tela.
- Se a pessoa perguntar como faz, responda: "O que você tentaria?". Se ela travar por **3
  minutos** ou desistir, marque **"com ajuda"**, dê a menor dica possível e anote qual foi.
- Cronometre do início da tarefa até o resultado na tela (protocolo, estado novo, nota gravada).
- Não explique o sistema antes. A primeira impressão é o dado.

**Tarefas — solicitante** (cerca de 15 min):

- **S1 (a tarefa do critério).** "A torneira do banheiro do seu andar está pingando sem parar.
  Registre isso no sistema." Fim: protocolo na tela. Anote o protocolo.
- **S2.** "Descubra em que situação está o pedido que você acabou de fazer." Fim: estado visto.
- **S3** (depois que a equipe concluir o chamado de S1). "A equipe disse que resolveu. Confirme
  e dê sua avaliação." Fim: avaliação gravada. Variante para um participante: "Não ficou
  resolvido. Peça para fazerem de novo." Fim: chamado reaberto.

**Tarefas — técnico** (cerca de 15 min, no celular):

- **T1.** "Veja os chamados que estão com você e comece o atendimento do mais urgente."
- **T2.** "Falta o reparo da torneira. Registre que o serviço está esperando material. A peça
  chegou: retome." Fim: dois registros na linha do tempo.
- **T3.** "Registre que usou 1 rolo de fita veda-rosca e conclua o serviço." Fim: concluído, com
  material e confirmação de EPI.

**Tarefas — gestão** (cerca de 15 min):

- **G1.** "Há pedidos novos. Defina a prioridade do pedido da torneira e mande para um técnico."
- **G2.** "Um pedido crítico está esperando há mais de 15 minutos. Encontre-o." (Prepare, 20 minutos antes, um
  chamado que nasça crítico: nas perguntas de situação, risco à segurança das pessoas.)
- **G3.** "Cancele o pedido duplicado." Fim: cancelado com justificativa.
- **G4.** "Quantos pedidos foram concluídos no prazo este mês?" Fim: número lido em Relatórios.

**Encerramento (3 min):** entregue o questionário da seção 6. Depois pergunte, e anote as
palavras da pessoa: "O que foi mais difícil?" e "O que você mudaria primeiro?".

## 5. Ficha de observação (uma por participante)

Perfil: ☐ Solicitante ☐ Técnico ☐ Gestão  Aparelho: ☐ Celular ☐ Computador  Data: ____/____/2026
Código do participante (não o nome): ______  Facilitador: ______  Observador: ______

| Tarefa | Concluiu? | Sem ajuda? | Tempo (min:s) | Onde hesitou ou errou | Dica dada (se houve) |
| --- | --- | --- | --- | --- | --- |
| ____ | ☐ Sim ☐ Não | ☐ Sim ☐ Não | | | |
| ____ | ☐ Sim ☐ Não | ☐ Sim ☐ Não | | | |
| ____ | ☐ Sim ☐ Não | ☐ Sim ☐ Não | | | |
| ____ | ☐ Sim ☐ Não | ☐ Sim ☐ Não | | | |

Protocolo(s) dos chamados criados: ______________________________

Frases ditas em voz alta que valem registro:

____________________________________________________________________

O que foi mais difícil (palavras da pessoa):

____________________________________________________________________

O que mudaria primeiro:

____________________________________________________________________

## 6. Questionário (SUS)

Marque de 1 (discordo totalmente) a 5 (concordo totalmente). Responda pela primeira impressão.

| Nº | Afirmação | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Eu gostaria de usar este sistema com frequência. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 2 | Achei o sistema desnecessariamente complexo. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 3 | Achei o sistema fácil de usar. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 4 | Eu precisaria de ajuda de alguém com conhecimento técnico para usar o sistema. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 5 | As funções do sistema estão bem integradas. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 6 | O sistema tem muita inconsistência. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 7 | A maioria das pessoas aprenderia a usar este sistema rapidamente. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 8 | Achei o sistema atrapalhado de usar. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 9 | Eu me senti confiante usando o sistema. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 10 | Precisei aprender muitas coisas antes de conseguir usar o sistema. | ☐ | ☐ | ☐ | ☐ | ☐ |

**Cálculo (quem consolida, não o participante):** nos itens ímpares, nota − 1; nos pares,
5 − nota; some os dez e multiplique por 2,5. O resultado vai de 0 a 100. Média de mercado: 68.

## 7. Consolidação (uma por ensaio)

**Critério da abertura (S1):** ____ de ____ solicitantes concluíram sem ajuda.
☐ Atendido (todos)  ☐ Não atendido: onde travaram ______________________________

| Tarefa | Participantes | Concluíram sem ajuda | Tempo mediano | Principal problema observado |
| --- | --- | --- | --- | --- |
| S1 | | | | |
| S2 | | | | |
| S3 | | | | |
| T1 | | | | |
| T2 | | | | |
| T3 | | | | |
| G1 | | | | |
| G2 | | | | |
| G3 | | | | |
| G4 | | | | |

**SUS:** média ____ (de ____ questionários); menor ____; maior ____.

**Os 12 cenários** (transcreva para a seção 13 de `docs/matriz-de-testes.md`, com a evidência):

| Nº | Cenário | Feito em (tarefa) | Observado igual ao esperado? |
| --- | --- | --- | --- |
| 1 | Solicitante abre um chamado pela tela | S1 | ☐ Sim ☐ Não |
| 2 | Chamado crítico fica 15 minutos sem triagem | G2 | ☐ Sim ☐ Não |
| 3 | Gestão faz a triagem: urgência, impacto e risco | G1 | ☐ Sim ☐ Não |
| 4 | Gestão atribui a um técnico | G1, T1 | ☐ Sim ☐ Não |
| 5 | Técnico inicia, pede material e retoma | T1, T2 | ☐ Sim ☐ Não |
| 6 | Técnico conclui sem EPI e depois com EPI | T3 | ☐ Sim ☐ Não |
| 7 | Solicitante avalia e depois reabre dentro de 48 horas | S3 | ☐ Sim ☐ Não |
| 8 | Técnico tenta cancelar, e solicitante tenta ver chamado alheio | à parte, pela equipe | ☐ Sim ☐ Não |
| 9 | Plano preventivo reativado com data futura gera o chamado | à parte, pela gestão | ☐ Sim ☐ Não |
| 10 | Técnico sem sinal consulta a fila e tenta registrar uma ação | T1, em modo avião | ☐ Sim ☐ Não |
| 11 | Restaurar o backup num ambiente separado e medir o tempo | à parte (`docs/piloto.md` §2.3) | ☐ Sim ☐ Não |
| 12 | Conferir se o aviso de atraso e a preventiva rodaram | à parte, painel da gestão | ☐ Sim ☐ Não |

**Correções decididas antes do piloto:**

____________________________________________________________________

____________________________________________________________________

Assinaturas de quem conduziu: ______________________  ______________________

---

## 8. Depois

- Os papéis ficam com a equipe; o que entra no repositório é só a consolidação (seção 7) e as
  evidências da seção 13 da matriz, sem nome de participante.
- Problema de uso achado vira correção com teste, como qualquer defeito. Se a correção mexer na
  tela de abertura, repita S1 com outras pessoas: quem já fez a tarefa aprendeu.
- Atualize o documento de projeto (RNF02, 7.1 e 7.3) com o resultado, inclusive se o critério
  não foi atendido.

## 9. Rodada conjunta (todos juntos, cerca de 1h30)

Os perfis trabalham ao mesmo tempo, como no uso real: o pedido que um solicitante abre é o que a
gestão distribui e o técnico atende. Decidido em 15/11/2026: na **produção**, com contas de ensaio.

### 9.1 Quem

| Papel | Quantos | Código na ficha |
| --- | --- | --- |
| Solicitante | 5 | S-A, S-B, S-C, S-D, S-E |
| Técnico (no celular) | 2 | T-1, T-2 |
| Gestão | 1 | G |
| Equipe: facilitador | 1 | lê as falas e controla o tempo |
| Equipe: observadores | 2 ou mais | um com os solicitantes, um com técnicos e gestão |

Solicitantes não sentam lado a lado: quem vê o outro fazer aprende, e a tarefa S1 deixa de medir
o que precisa medir.

### 9.2 Contas (a administração cria na véspera, na tela Usuários)

| Nome | E-mail | Perfil |
| --- | --- | --- |
| Ensaio Solicitante A … E | `ensaio.sa@ensaio.invalid` … `ensaio.se@ensaio.invalid` | solicitante |
| Ensaio Técnico 1 e 2 | `ensaio.t1@ensaio.invalid`, `ensaio.t2@ensaio.invalid` | técnico |
| Ensaio Gestão | `ensaio.g@ensaio.invalid` | gestor |
| Ensaio Preparo | `ensaio.preparo@ensaio.invalid` | solicitante (só a equipe usa) |

- A senha de cada conta é escolhida por quem cria (10 ou mais caracteres, fora das comuns) e vai
  num cartão de papel entregue na hora. Não mande senha por mensagem.
- Os avisos por e-mail dessas contas vão para endereços que não existem e voltam como não
  entregues na caixa de saída do sistema. É esperado e não afeta nada.
- A produção exige verificação em duas etapas da gestão. No primeiro acesso, a conta "Ensaio
  Gestão" é levada a ligá-la, com um aplicativo autenticador no celular de quem participa (peça no
  convite). Observe esse passo também: é a primeira coisa que uma pessoa real da gestão vai viver.

### 9.3 Cartões de problema (tarefa S1, um por solicitante)

| Cartão | Texto entregue |
| --- | --- |
| S-A | "A torneira do banheiro feminino do 1º andar está pingando sem parar. Registre isso no sistema." |
| S-B | "Uma lâmpada do corredor do seu andar queimou. Registre isso no sistema." |
| S-C | "O ar-condicionado da sala de reuniões não está gelando. Registre isso no sistema." |
| S-D | "A porta do banheiro masculino do térreo não fecha direito. Registre isso no sistema." |
| S-E | "A torneira do banheiro feminino do 1º andar está pingando. Registre isso no sistema." |

S-E repete S-A de propósito: é o duplicado que a gestão cancela em G3.

### 9.4 Linha do tempo

| Quando | Solicitantes | Técnicos | Gestão | Equipe |
| --- | --- | --- | --- | --- |
| −0:30 | | | | Conferência da seção 3, item 4. Com a conta Preparo, abre o chamado crítico: "Fio desencapado soltando faísca na tomada da recepção", respondendo às perguntas de situação com risco à segurança das pessoas. Confere que nasceu **crítica** e anota o protocolo. Ninguém faz a triagem dele. |
| 0:00 | Abertura em voz alta (seção 4) e cartões de acesso | idem | idem | Cronômetros prontos |
| 0:05 | **S1**, cada um com seu cartão | Entrar e ver se há algo para fazer (a fila deve estar vazia) | Primeiro acesso, verificação em duas etapas; depois **G4** | Anotar o protocolo de cada S1 |
| 0:20 | **S2** | Aguardam | **G2** (o crítico já tem mais de 15 min); **G1**: triagem de todos, S-A para o Técnico 1, S-B para o Técnico 2; **G3** cancela S-E | Conferir que o técnico recebeu o aviso |
| 0:35 | Ver se chegou novidade sobre o próprio pedido | T-1: **T1, T2, T3** no pedido de S-A. T-2: **T1** no pedido de S-B; liga o modo avião, abre a fila e tenta comentar (cenário 10); desliga e conclui com EPI | Acompanha a fila | Observadores com os técnicos |
| 0:55 | S-A: **S3** (avaliar). S-B: **S3** variante (reabrir) | | Vê a reabertura | |
| 1:05 | Questionário SUS e as duas perguntas finais | idem | idem | Recolher os papéis |
| 1:15 | Fim para os participantes | | | Seção 9.5 |

Os tempos são guia, não regra: se S1 atrasar, todo o resto anda junto. Nunca encurte S1 para
caber no horário, porque é a tarefa do critério.

### 9.5 Depois que os participantes saem (equipe, 15 min)

1. **Cenário 8:** com a conta de um técnico, tentar cancelar um chamado (não deve haver como);
   com a conta de um solicitante, abrir o endereço do chamado de outro (deve recusar).
2. **Cenário 12:** o painel da gestão não mostra "Tarefas automáticas paradas".
3. **Limpar:** com a conta da gestão real, cancelar cada chamado do ensaio com a justificativa
   "Ensaio de usabilidade". O concluído e avaliado (S-A) não se cancela direto: reabra-o (mesma
   justificativa) e então cancele. Assim nenhum chamado do ensaio conta como concluído no prazo.
4. **Desativar** as nove contas de ensaio na tela Usuários.
5. **Anotar** todos os protocolos na seção 7, para descontá-los no piloto.

### 9.6 Convite (para mandar às pessoas)

> Oi! Estamos testando o Conserva Predial, um sistema de pedidos de manutenção do prédio, e
> precisamos de pessoas que nunca o viram. São cerca de 1h30, no dia ___ às ___, em ___. Você
> vai fazer algumas tarefas simples no celular ou no computador, como registrar um problema, e
> responder a um questionário curto. Quem está sendo testado é o sistema, não você. Não
> gravamos seu nome, sua tela nem sua voz. Se topar, traga o celular carregado. [Só para quem
> fará o papel da gestão: instale antes um aplicativo autenticador, como o Google Authenticator.]

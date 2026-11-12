# Matriz de testes

Liga cada regra do sistema ao teste que a prova, e diz onde rodar para ver o resultado.
Nasceu do item A11 do plano de ação de 15/10/2026 ("montar matriz de requisito, cenário,
resultado e evidência").

**Como ler.** Cada linha é uma regra, o cenário que se prova e **um** teste: o arquivo e o
título exato do teste. O código de requisito (RF, RN, RNF) é o que o próprio código cita nos
comentários. O texto oficial dos requisitos está no Termo de Abertura, que não está neste
repositório: as linhas descrevem a regra como o código a implementa, e quem for usá-las no
trabalho acadêmico deve conferi-las contra o Termo.

**Esta matriz não envelhece em silêncio.** `backend/tests/matrizDeTestes.test.js` falha se
um arquivo ou um título citado aqui deixar de existir, e se um arquivo de teste novo não
aparecer na matriz. Teste novo entra numa linha da seção certa ou na seção 12.

## 1. Evidência registrada

Um teste verde prova a regra daquela camada; não prova o fluxo operacional completo (a
seção 13 cobre o que só um ensaio com pessoas prova).

| Camada | Como rodar | Resultado de referência |
| --- | --- | --- |
| API (Jest + Supertest, PostgreSQL de verdade) | `cd backend && npm test` | 51 suítes e 676 testes verdes em 15/10/2026, num banco recém-migrado (PostgreSQL 16 local) |
| Telas (Vitest) | `cd frontend && npm test` | 37 arquivos e 434 testes verdes em 15/10/2026 |
| Ponta a ponta (Playwright, projetos `computador` e `celular`) | `cd frontend && npm run e2e` | 148 execuções no CI da PR #73 (commit `fde1e51`), sem falhas; uma é pulada |
| Mutação (as travas pegam o defeito?) | `node tests/mutacao.js` (backend) e `npm run mutacao` (frontend) | Todas acusadas nas execuções de 15/10/2026 para o que foi mexido; roda à mão, não no CI |

Os números exatos de cada execução ficam no CI (Actions, workflow `CI`), que roda com
PostgreSQL 17, a mesma versão da produção. No ambiente da sessão que montou esta matriz, 4
execuções de `frontend/e2e/pwa.spec.js` falham porque o service worker não registra; elas
passam no CI e falham também sem a mudança em curso, então a causa é do ambiente local.

## 2. Conta, acesso e sessão

| Regra | O que se prova | Arquivo | Teste |
| --- | --- | --- | --- |
| RN01 | O cadastro público cria só solicitante | `backend/tests/auth.test.js` | cria um usuário com perfil solicitante mesmo se outro perfil for enviado |
| RF01 | Senha errada não entra | `backend/tests/auth.test.js` | rejeita senha incorreta |
| RF01 | Cinco falhas por e-mail bloqueiam o login | `backend/tests/rateLimit.test.js` | bloqueia com 429 após o limite de falhas do e-mail e informa Retry-After |
| RF01 | Ataque espalhado por vários e-mails cai no limite por IP | `backend/tests/rateLimit.test.js` | limita por IP quando o ataque espalha as tentativas por vários e-mails |
| RF01 | A recusa não revela se o e-mail existe | `backend/tests/rateLimit.test.js` | responde o mesmo corpo para e-mail inexistente e para senha errada |
| RF01 | O cadastro responde igual para e-mail novo e repetido | `backend/tests/cadastroSeguro.test.js` | e-mail novo e repetido voltam o mesmo status e o mesmo corpo, sem conta nem token |
| RF01 | O e-mail repetido faz o mesmo trabalho do novo (o tempo não o denuncia) | `backend/tests/cadastroSeguro.test.js` | o pedido repetido faz o mesmo trabalho do novo: o tempo não conta o que o corpo esconde |
| RF01 | O cadastro tem teto por IP e por dia | `backend/tests/cadastroSeguro.test.js` | passado o teto por IP volta 429, e outro IP não é afetado |
| RF01 | O teto do dia vale para todos os IPs | `backend/tests/cadastroSeguro.test.js` | o teto do dia vale para todos os IPs somados |
| RF01 | Senha nova: 10 caracteres ou mais | `backend/tests/cadastroSeguro.test.js` | 9 caracteres é recusado; 10 passa |
| RF01 | Senha nova: fora das comuns | `backend/tests/cadastroSeguro.test.js` | senha comum é recusada com o motivo, mesmo com 10 caracteres |
| RF01 | Quem já tem senha curta continua entrando | `backend/tests/cadastroSeguro.test.js` | quem já tem senha curta continua entrando: a regra é da senha nova |
| RF01 | O formulário de cadastro diz a regra e não afirma "conta criada" | `frontend/testes/CadastrosPendentes.test.jsx` | sem aprovação, diz que o pedido foi recebido e manda entrar: não afirma que a conta foi criada |
| RF01 | Recuperação de senha responde igual para quem tem e quem não tem conta | `backend/tests/recuperacaoSenha.test.js` | responde igual para e-mail existente e inexistente |
| RF01 | O link de redefinição vale uma vez | `backend/tests/recuperacaoSenha.test.js` | recusa o mesmo token duas vezes |
| RF01 | O link de redefinição expira | `backend/tests/recuperacaoSenha.test.js` | recusa token expirado |
| RF01 | Um Host forjado não aponta o link para o atacante | `backend/tests/recuperacaoSenha.test.js` | sem URL_APP, um Host forjado não vira link de redefinição |
| RF01 | Com a aprovação ligada, o pedido fica pendente e não entra | `backend/tests/cadastroAprovacao.test.js` | o pedido fica pendente e não entra; senha errada não revela que ele existe |
| RF01 | Aprovar libera o login | `backend/tests/cadastroAprovacao.test.js` | aprovar libera o login, avisa por e-mail e só mexe em quem está pendente |
| RF01 | Só a administração liga a aprovação | `backend/tests/cadastroAprovacao.test.js` | a gestão lê; só a administração liga e desliga, e só com verdadeiro ou falso |
| Sessão | Conta desligada perde o acesso na hora | `backend/tests/sessao.test.js` | conta desligada perde o acesso na hora, não em 8 horas |
| Sessão | O perfil vem do banco, não do token | `backend/tests/sessao.test.js` | o perfil vem do banco, não do token |
| Sessão | Cookie HttpOnly e SameSite=Strict | `backend/tests/cookieE2fa.test.js` | o login grava um cookie HttpOnly, SameSite=Strict, sem Secure em http |
| Sessão | Escrita só com cookie exige o cabeçalho da tela (CSRF) | `backend/tests/cookieE2fa.test.js` | só com o cookie, a leitura funciona; a escrita exige o cabeçalho da tela |
| Sessão | Trocar a senha derruba a sessão aberta | `backend/tests/cookieE2fa.test.js` | redefinir a senha derruba a sessão que estava aberta |
| Sessão | Sessão vencida derruba a tela em vez de deixá-la quebrada | `frontend/e2e/fluxo.spec.js` | sessão expirada devolve ao login em vez de deixar a tela quebrada |
| Sessão | Sessão vencida apaga as leituras guardadas para uso sem conexão | `frontend/testes/ExpiracaoLimpaCache.test.jsx` | apaga as leituras guardadas para uso sem conexão, como o login e o logout |
| Sessão | Sair apaga as leituras guardadas: o próximo a usar o aparelho não vê a fila de outro | `frontend/e2e/pwa.spec.js` | sair apaga as leituras guardadas: o próximo a usar o aparelho não vê a fila de outro |
| 2FA | Com 2FA a senha certa devolve só um desafio | `backend/tests/cookieE2fa.test.js` | com 2FA, a senha certa devolve só um desafio — sem cookie e sem token |
| 2FA | O mesmo código não entra duas vezes | `backend/tests/cookieE2fa.test.js` | o mesmo código não entra duas vezes (nem dentro dos 30 segundos) |
| 2FA exigido | Gestão sem 2FA só alcança a própria conta | `backend/tests/exigencia2fa.test.js` | gestor sem a verificação entra, mas só alcança a própria conta até ligar |
| 2FA exigido | Quem exige precisa ter ligado a própria | `backend/tests/exigencia2fa.test.js` | administrador sem a própria verificação não liga (409); gestor não muda (403) |
| Google | Conta nova nasce solicitante | `backend/tests/loginGoogle.test.js` | nasce solicitante e entra, com a sessão em cookie |
| Google | O Google não dispensa o código do 2FA | `backend/tests/loginGoogle.test.js` | com duas etapas ligadas, o Google não dispensa o código |
| Contas | O último administrador não sai | `backend/tests/usuarios.test.js` | impede remover o último administrador ativo |
| Contas | Gestor não cria usuário | `backend/tests/usuarios.test.js` | gestor não cria usuário |
| LGPD | Anonimizar preserva o chamado | `backend/tests/anonimizacao.test.js` | preserva o chamado que a pessoa abriu |
| LGPD | Ninguém anonimiza a si mesmo | `backend/tests/anonimizacao.test.js` | ninguém anonimiza a própria conta |

## 3. Chamado: abertura, edição, conversa e busca

| Regra | O que se prova | Arquivo | Teste |
| --- | --- | --- | --- |
| Abertura | O solicitante abre um chamado | `backend/tests/chamados.test.js` | solicitante consegue abrir um chamado |
| Escopo | O solicitante só vê os próprios chamados | `backend/tests/chamados.test.js` | solicitante só vê os próprios chamados na listagem |
| Escopo | O escopo vale na tela, não só na API | `frontend/e2e/fluxo.spec.js` | o escopo por perfil vale na tela, não só na API |
| Fluxo | Transição de estado inválida é recusada | `backend/tests/chamados.test.js` | rejeita transição de estado inválida (aberto -> concluido direto) |
| RN03 | O solicitante corrige enquanto o chamado não foi atribuído | `backend/tests/cadastrosEBusca.test.js` | solicitante corrige o que escreveu enquanto não foi atribuído |
| RN03 | A janela de edição fecha na atribuição | `backend/tests/cadastrosEBusca.test.js` | perde a janela depois da atribuição |
| RN03 | Depois da janela, o comentário é o canal | `backend/tests/comentarios.test.js` | o solicitante comenta mesmo sem poder mais editar |
| RN03 | O mesmo fluxo, na tela | `frontend/e2e/fluxo.spec.js` | depois de atribuído o solicitante comenta, já que não pode editar (RN03) |
| RN01 | Ninguém lê a conversa de chamado alheio | `backend/tests/comentarios.test.js` | solicitante não lê a conversa de chamado alheio |
| RF08 | Comentar avisa o técnico designado | `backend/tests/comentarios.test.js` | avisa o técnico designado quando o solicitante comenta |
| RF03 | Busca pelo protocolo | `backend/tests/cadastrosEBusca.test.js` | encontra pelo protocolo completo |
| RF03 | O protocolo leva a data de Brasília, não a de UTC (22h de 31/12 não vira o ano novo) | `backend/tests/protocoloEErrosDeCorpo.test.js` | leva a data de Brasília, não a de UTC |
| RF03 | A busca não fura o escopo do perfil | `backend/tests/cadastrosEBusca.test.js` | a busca não fura o escopo do perfil |
| RF03 | Busca pelo protocolo, na tela | `frontend/e2e/fluxo.spec.js` | buscar pelo protocolo encontra o chamado (RF03) |
| Fila | A fila traz primeiro o que vence antes | `backend/tests/filaEDistribuicao.test.js` | traz primeiro o que vence antes, mesmo sendo o mais antigo |
| Fila | Paginação de 20 por página, com o total real | `backend/tests/paginacao.test.js` | limita a 20 registros por padrão e informa o total real |
| Anexos | O tipo vale pelo conteúdo do arquivo, não pelo declarado | `backend/tests/anexos.test.js` | recusa arquivo cujo conteúdo não confere com o tipo declarado |
| Anexos | Não se baixa anexo alheio trocando o id na URL | `backend/tests/anexos.test.js` | não deixa baixar anexo alheio passando o id de um chamado próprio na URL |
| Anexos | Ligar o Storage não quebra os anexos antigos | `backend/tests/anexosStorage.test.js` | anexo antigo, em bytea, continua abrindo depois de ligar o Storage |
| Anexos | Foto grande do celular é reduzida no navegador | `frontend/e2e/anexos.spec.js` | foto de câmera acima de 4 MB é reduzida no navegador e entra no chamado |
| Anexos | Um chamado aceita até 10 anexos; o seguinte é recusado com o motivo | `backend/tests/anexosCota.test.js` | o último anexo dentro do limite entra, e o seguinte é recusado com o motivo |
| RF03 | Sem ninguém ter mexido, o limite de anexos é o padrão | `backend/tests/anexosCota.test.js` | sem ninguém ter mexido, vale o padrão |
| RF03 | O limite definido pela administração vale no envio, na mensagem e na listagem | `backend/tests/anexosCota.test.js` | o limite definido passa a valer no envio, na mensagem e na listagem |
| RF03 | Com limite de um, a mensagem está no singular | `backend/tests/anexosCota.test.js` | com limite de um, a mensagem fala em "1 anexo" |
| RF03 | Baixar o limite não apaga anexos | `backend/tests/anexosCota.test.js` | baixar o limite não apaga o que já estava anexado: só recusa o próximo |
| RF03 | O limite só aceita inteiro de 1 a 20 | `backend/tests/anexosCota.test.js` | recusa %p (fora de 1 a 20, ou que não é número inteiro) |
| RF03 | Os extremos 1 e 20 são aceitos | `backend/tests/anexosCota.test.js` | aceita os dois extremos: 1 e 20 |
| RF03 | Só a administração define o limite | `backend/tests/anexosCota.test.js` | só a administração define: o gestor recebe 403 |
| RF03 | Valor fora da faixa gravado direto no banco não vale | `backend/tests/anexosCota.test.js` | valor fora da faixa gravado direto no banco não vale: fica o padrão |
| RF03 | A tela mostra o limite em vigor e a faixa | `frontend/testes/LimiteDeAnexos.test.jsx` | mostra o limite em vigor e a faixa aceita |
| RF03 | A tela salva o número novo e confirma | `frontend/testes/LimiteDeAnexos.test.jsx` | salva o número novo e confirma o que passou a valer |
| RF03 | Valor fora da faixa é recusado na tela | `frontend/testes/LimiteDeAnexos.test.jsx` | "%s" é recusado na tela, sem chamar o servidor |
| RF03 | Salvar o mesmo valor não chama o servidor | `frontend/testes/LimiteDeAnexos.test.jsx` | salvar o mesmo valor não chama o servidor, e diz que nada mudou |
| RF03 | A recusa do servidor aparece, e o limite em vigor não muda | `frontend/testes/LimiteDeAnexos.test.jsx` | a recusa do servidor aparece com a mensagem dele, e o limite em vigor não muda |
| RF03 | Sem carregar a configuração, não há campo vazio | `frontend/testes/LimiteDeAnexos.test.jsx` | se a configuração não carrega, mostra o erro e não oferece um campo vazio |
| RF03 | O campo fica na tela de Usuários | `frontend/testes/Usuarios.test.jsx` | a administração encontra o campo com o limite em vigor |
| Anexos | Remover um anexo libera uma vaga | `backend/tests/anexosCota.test.js` | remover um anexo libera uma vaga |
| Anexos | Envio simultâneo na última vaga espera o cadeado e reconta | `backend/tests/anexosCota.test.js` | envio simultâneo no último lugar espera o cadeado do chamado e confere de novo |
| Anexos | A gestão é avisada ao passar de 70% do banco | `backend/tests/anexosCota.test.js` | avisa a partir de 70% do limite, e não antes |
| Anexos | A tela desliga o envio no limite e diz por quê | `frontend/testes/ChamadoDetalhe.test.jsx` | no limite, desliga o envio e diz por quê |
| Anexos | O painel avisa que o espaço do banco está acabando | `frontend/testes/AvisoDeEspaco.test.jsx` | passando do limiar, diz quanto está usado e o que fazer |

## 4. Prioridade, prazo (SLA) e atraso

| Regra | O que se prova | Arquivo | Teste |
| --- | --- | --- | --- |
| RN04 | Risco grave impõe prioridade crítica | `backend/tests/priorizacao.test.js` | RN04: risco grave impõe crítica mesmo com pontuação baixa |
| RF04 | Divergir da sugestão exige justificativa | `backend/tests/priorizacao.test.js` | exige justificativa quando o gestor diverge da sugestão |
| RF04 | O solicitante não prioriza | `backend/tests/priorizacao.test.js` | solicitante não prioriza |
| RF04 | A situação informada (urgência, impacto e risco) define a prioridade na abertura | `backend/tests/prioridadeNaAbertura.test.js` | urgência, impacto e risco altos nascem críticos, com o prazo da crítica e a conta guardada |
| RF04 | O solicitante não escolhe a prioridade: a enviada é ignorada | `backend/tests/prioridadeNaAbertura.test.js` | "crítica" enviada pelo solicitante é ignorada: sem situação informada, nasce média |
| RF04 | Situação parcial ou fora de 1 a 4 é recusada | `backend/tests/prioridadeNaAbertura.test.js` | só uma parte dos fatores é recusada: dois calculariam o que ninguém decidiu |
| RF04 | A regra de distribuição é o mínimo da prioridade | `backend/tests/prioridadeNaAbertura.test.js` | as respostas não descem abaixo do mínimo, e o histórico diz que foi o mínimo |
| RF04 | O formulário pergunta a situação, sem resposta marcada, e não envia sem responder | `frontend/testes/NovoChamado.test.jsx` | sem responder, o chamado não é enviado |
| RF04 | O formulário envia urgência, impacto e risco, e nenhuma prioridade | `frontend/testes/NovoChamado.test.jsx` | envia urgência, impacto e risco como números e nenhuma prioridade |
| RF04 | Nenhuma resposta repete o nome de outro campo (o leitor de tela as confundiria) | `frontend/testes/NovoChamado.test.jsx` | nenhuma resposta traz o nome de outro campo: o rótulo "Equipamento" achava o rádio de risco |
| RN12 | O chamado guarda a versão da regra que o classificou | `backend/tests/priorizacao.test.js` | chamado priorizado antes guarda a versão que o classificou |
| RN12 | A política de prazos tem versão: alterar o prazo grava o valor novo, a vigência e quem alterou | `backend/tests/slaVersao.test.js` | alterar o prazo cria uma versão com o valor novo, a vigência e quem alterou |
| RN12 | Mudar só a contagem (úteis ou corridas) também é uma versão | `backend/tests/slaVersao.test.js` | mudar só a contagem também é uma versão, e guarda o prazo que continuou valendo |
| RN12 | Reenviar o mesmo valor não cria versão | `backend/tests/slaVersao.test.js` | reenviar o mesmo valor não cria versão nem mexe na data da última alteração |
| RN12 | Alteração recusada não cria versão | `backend/tests/slaVersao.test.js` | alteração recusada não cria versão |
| RN12 | A migração registra como primeira versão o prazo que já valia | `backend/tests/slaVersao.test.js` | a migração registra, para cada prioridade, o prazo que já valia |
| RN12 | O histórico traz autor e fim da vigência, contado dentro da prioridade | `backend/tests/slaVersao.test.js` | o histórico vem do mais recente para o mais antigo, com o autor e o fim da vigência |
| RN12 | O histórico de prazos é da gestão | `backend/tests/slaVersao.test.js` | o histórico é da gestão: técnico recebe 403 |
| RN12 | A tabela de versões não é exposta pela API pública do Supabase | `backend/tests/slaVersao.test.js` | a tabela não é acessível pela API pública do Supabase (papéis anon e authenticated) |
| RN12 | Sem a tabela (migração 032 não aplicada), alterar o prazo continua funcionando | `backend/tests/slaVersao.test.js` | alterar o prazo continua funcionando: o prazo é gravado, sem versão |
| RN12 | Sem a tabela, o histórico responde vazio | `backend/tests/slaVersao.test.js` | o histórico responde vazio, e não erro |
| RN12 | A limpeza das suítes apaga as versões gravadas por contas de teste | `backend/tests/limpezaDeTestes.test.js` | apaga a versão assinada por conta de teste e preserva a de fora e a sem autor |
| RN12 | O histórico aberto não tem violação de acessibilidade | `frontend/e2e/acessibilidade.spec.js` | o histórico de prazos aberto, nos relatórios, não tem violação de acessibilidade |
| RN12 | A tela mostra a versão em vigor, com prazo, régua, desde quando e quem alterou | `frontend/testes/HistoricoDoSla.test.jsx` | aberto, mostra a versão em vigor com o prazo, a régua, desde quando e quem alterou |
| RN12 | Versão antiga mostra o intervalo em que valeu, sem inventar autor | `frontend/testes/HistoricoDoSla.test.jsx` | a versão antiga mostra o intervalo em que valeu, sem inventar autor |
| RN12 | O histórico só consulta quando aberto, e de novo quando um prazo muda | `frontend/testes/HistoricoDoSla.test.jsx` | consulta de novo quando um prazo muda com o histórico aberto |
| RN12 | Falha ao carregar o histórico aparece como erro | `frontend/testes/HistoricoDoSla.test.jsx` | falha ao carregar aparece como erro, e não como lista vazia |
| RN12 | Fechado, o histórico não consulta nada | `frontend/testes/HistoricoDoSla.test.jsx` | fechado, não consulta nada |
| RN12 | O histórico fica na tela de Relatórios, e alterar um prazo não recarrega a tela | `frontend/testes/Operacao.test.jsx` | o histórico de prazos abre na tela de Relatórios e se atualiza quando um prazo muda |
| SLA | O prazo nasce da prioridade | `backend/tests/sla.test.js` | define prazo a partir da prioridade |
| SLA | Atraso é calculado: prazo passou e o chamado segue aberto | `backend/tests/sla.test.js` | marca em_atraso quando o prazo passou e o chamado segue aberto |
| SLA | Concluir tira o chamado do atraso | `backend/tests/sla.test.js` | deixa de contar como atraso quando o chamado é concluído |
| SLA | Esperar material empurra o prazo | `backend/tests/sla.test.js` | empurra o prazo pelo tempo que o chamado ficou aguardando material |
| SLA | O solicitante não altera prazo | `backend/tests/sla.test.js` | solicitante não altera prazo |
| Horas úteis | Fim de semana não conta | `backend/tests/horasUteis.test.js` | horas úteis entre sexta 17h e segunda 10h são 3 |
| Horas úteis | Feriado não conta | `backend/tests/horasUteis.test.js` | feriado não conta |
| Horas úteis | A espera por material devolve o expediente que consumiu | `backend/tests/horasUteis.test.js` | a espera por material devolve ao prazo o expediente que consumiu |
| Horas úteis | A reabertura usa a mesma régua e começa sem a espera do ciclo anterior | `backend/tests/horasUteis.test.js` | a reabertura dá o prazo do ciclo novo na mesma régua, em horas úteis, e começa sem a espera do ciclo anterior |
| Alerta de 15 min | Crítico corretivo aberto além do tempo é sinalizado | `backend/tests/atendimentoCritico.test.js` | crítico corretivo aberto além do tempo é sinalizado no detalhe e na lista |
| Alerta de 15 min | Dentro dos 15 minutos ainda não alerta | `backend/tests/atendimentoCritico.test.js` | dentro dos 15 minutos ainda não é alerta |
| Alerta de 15 min | Só a prioridade crítica conta | `backend/tests/atendimentoCritico.test.js` | só a prioridade crítica conta: alta, aberta há horas, não é este alerta |
| Alerta de 15 min | Preventiva crítica não é emergência esquecida | `backend/tests/atendimentoCritico.test.js` | preventiva crítica na fila é trabalho planejado, e não emergência esquecida |
| Alerta de 15 min | Fora da tela: a gestão ativa é avisada, no sino e por e-mail, e só ela | `backend/tests/avisoCriticoSemAtendimento.test.js` | avisa a gestão ativa, no sino e por e-mail, e só a gestão |
| Alerta de 15 min | Avisa uma vez só por chamado | `backend/tests/avisoCriticoSemAtendimento.test.js` | avisa uma vez só: a passagem seguinte não repete |
| Alerta de 15 min | Crítico de sábado à noite também avisa (relógio corrido) | `backend/tests/avisoCriticoSemAtendimento.test.js` | crítico de sábado à noite também avisa: o relógio é corrido, sem expediente |
| Alerta de 15 min | Antes dos 15 minutos não avisa | `backend/tests/avisoCriticoSemAtendimento.test.js` | antes dos 15 minutos não avisa, e avisa quando passam |
| Alerta de 15 min | Chamado atendido não gera aviso | `backend/tests/avisoCriticoSemAtendimento.test.js` | chamado que já saiu de "aberto" (alguém o pegou) não gera aviso |
| Alerta de 15 min | Só o crítico corretivo gera o aviso | `backend/tests/avisoCriticoSemAtendimento.test.js` | só o crítico corretivo: alta, e a preventiva, não são este aviso |
| Alerta de 15 min | A falha do aviso aparece como falha da tarefa | `backend/tests/avisoCriticoSemAtendimento.test.js` | se o aviso de crítico falhar, a tarefa aparece como falha em vez de passar calada |
| Alerta de 15 min | O sino mostra o aviso com o rótulo próprio e leva ao chamado | `frontend/testes/Avisos.test.jsx` | aparece no sino com o rótulo próprio e leva ao chamado |
| Alerta de 15 min | A gestão vê a faixa e o link filtra os críticos | `frontend/e2e/alertaCritico.spec.js` | a gestão vê a faixa, e o link abre o painel só com os críticos sem atendimento |
| RF08 | O aviso de atraso chega ao solicitante | `backend/tests/atrasos.test.js` | avisa o solicitante quando o prazo estoura |
| RF08 | Não avisa duas vezes pelo mesmo prazo | `backend/tests/atrasos.test.js` | não avisa duas vezes pelo mesmo prazo |
| RF08 | Sem técnico, o aviso vai para a gestão | `backend/tests/atrasos.test.js` | sem técnico designado, avisa a gestão, que é quem pode agir |
| Agendador | Sem `CRON_SECRET` a rota fica desligada, não aberta | `backend/tests/atrasos.test.js` | sem CRON_SECRET no ambiente, a rota fica desligada em vez de aberta |
| Agendador | Tarefa sem passagem aparece como parada | `backend/tests/agendador.test.js` | sem passagem dentro da tolerância, a tarefa aparece como parada |

## 5. Execução, conclusão, reabertura e cancelamento

| Regra | O que se prova | Arquivo | Teste |
| --- | --- | --- | --- |
| RF07 | O técnico designado registra diagnóstico e tempo | `backend/tests/execucao.test.js` | técnico designado registra diagnóstico e tempo |
| RN07 | Não conclui sem descrição do serviço | `backend/tests/execucao.test.js` | recusa concluir sem descrição |
| RN07 | O banco também recusa, por escrita direta | `backend/tests/execucao.test.js` | o banco também recusa conclusão sem descrição, por escrita direta |
| EPI | Não conclui sem a confirmação de EPI | `backend/tests/epi.test.js` | recusa concluir sem a confirmação, e o chamado segue em andamento |
| EPI | Guarda quem confirmou e quando | `backend/tests/epi.test.js` | conclui com a confirmação e guarda quem confirmou e quando |
| EPI | O banco recusa concluído sem confirmação | `backend/tests/epi.test.js` | recusa chamado concluído agora sem confirmação |
| EPI | A reabertura zera a confirmação e cobra a do ciclo novo | `backend/tests/epi.test.js` | zera a confirmação do chamado, mantém a do ciclo anterior na linha do tempo e cobra a do novo |
| EPI | Na tela, a caixa é obrigatória | `frontend/e2e/epi.spec.js` | sem marcar a caixa o chamado não conclui; marcada, conclui e registra quem confirmou |
| RN09 | O solicitante reabre dentro de 48 horas | `backend/tests/reabertura.test.js` | solicitante reabre o próprio chamado dentro da janela |
| RN09 | Depois da janela, a reabertura é recusada | `backend/tests/reabertura.test.js` | recusa depois da janela de 48 horas |
| RN09 | A reabertura exige justificativa | `backend/tests/reabertura.test.js` | exige justificativa |
| RN09 | O técnico não reabre | `backend/tests/reabertura.test.js` | técnico e terceiros não reabrem |
| RN09 | O ciclo reaberto ganha prazo novo | `backend/tests/reabertura.test.js` | dá prazo novo ao ciclo reaberto |
| RN05 | A gestão reabre depois de 48 horas, e o histórico diz que foi fora da janela | `backend/tests/aderenciaAoTermo.test.js` | depois de 48 horas a gestão reabre, e o histórico diz que foi fora da janela |
| RN05 | O solicitante continua sem reabrir fora da janela, e a mensagem manda procurar a gestão | `backend/tests/aderenciaAoTermo.test.js` | o solicitante continua sem poder, e a mensagem manda procurar a gestão |
| RN05 | Fora da janela a gestão também precisa de justificativa | `backend/tests/aderenciaAoTermo.test.js` | fora da janela a gestão também precisa de justificativa |
| RN09 | Dentro da janela a reabertura não fala em exceção | `backend/tests/aderenciaAoTermo.test.js` | dentro da janela nada muda: o histórico não fala em exceção |
| RN09, RN05 | Na tela, o solicitante reabre dentro de 48 horas | `frontend/testes/ChamadoDetalhe.test.jsx` | dentro de 48 horas o solicitante reabre |
| RN09, RN05 | Na tela, depois de 48 horas o solicitante não vê o formulário | `frontend/testes/ChamadoDetalhe.test.jsx` | depois de 48 horas o solicitante não vê o formulário |
| RN05 | Na tela, depois de 48 horas a gestão ainda reabre, e a tela diz por quê | `frontend/testes/ChamadoDetalhe.test.jsx` | depois de 48 horas a gestão ainda reabre, e a tela diz por quê |
| RN08 | Pedir material sem motivo é recusado e o prazo não é suspenso | `backend/tests/aderenciaAoTermo.test.js` | sem motivo, recusa e o prazo não é suspenso |
| RN08 | Motivo curto demais também é recusado | `backend/tests/aderenciaAoTermo.test.js` | motivo curto demais também é recusado |
| RN08 | Com o motivo, o prazo é suspenso e o histórico guarda o motivo | `backend/tests/aderenciaAoTermo.test.js` | com o motivo, suspende o prazo e o histórico guarda o motivo |
| RN08 | Retomar o atendimento não exige motivo | `backend/tests/aderenciaAoTermo.test.js` | retomar o atendimento não exige motivo: o fim da suspensão fica no histórico |
| RN08 | Na tela, o botão abre o campo do motivo e não envia nada ainda | `frontend/testes/ChamadoDetalhe.test.jsx` | o botão abre o campo e não envia nada ainda |
| RN08 | Na tela, o estado vai com o motivo escrito | `frontend/testes/ChamadoDetalhe.test.jsx` | envia o estado com o motivo escrito |
| RN08 | Na tela, desistir fecha o campo sem enviar | `frontend/testes/ChamadoDetalhe.test.jsx` | desistir fecha o campo sem enviar |
| RN08 | Na tela, retomar do aguardando material segue num clique só | `frontend/testes/ChamadoDetalhe.test.jsx` | retomar do aguardando material segue num clique só |
| RN06, RF05 | Atribuir só à equipe avisa os técnicos ativos dela, e só eles | `backend/tests/aderenciaAoTermo.test.js` | avisa os técnicos ativos da equipe, e só eles |
| RN06, RF05 | O chamado só da equipe aparece na fila de quem é dela e não na de quem é de fora | `backend/tests/aderenciaAoTermo.test.js` | o chamado aparece na fila de quem é da equipe e não na de quem é de fora |
| RN06 | Quem é da equipe abre o chamado e a tela sabe que pode assumi-lo; quem é de fora recebe 403 | `backend/tests/aderenciaAoTermo.test.js` | quem é da equipe abre o chamado e a tela fica sabendo que pode assumi-lo; quem é de fora recebe 403 |
| RN06 | Iniciar o atendimento assume o chamado, e o histórico diz | `backend/tests/aderenciaAoTermo.test.js` | iniciar o atendimento assume o chamado: o técnico fica designado e o histórico diz |
| RN06 | Depois de assumido, o chamado sai da fila do colega | `backend/tests/aderenciaAoTermo.test.js` | depois de assumido, o chamado sai da fila do colega e a tela deixa de oferecer o botão |
| RN06 | Quem é da equipe só pode iniciar, não esperar material, concluir nem cancelar | `backend/tests/aderenciaAoTermo.test.js` | quem é da equipe só pode iniciar: esperar material, concluir ou cancelar sem assumir é recusado |
| RN06 | Dois técnicos iniciando juntos: um assume, o outro é recusado | `backend/tests/aderenciaAoTermo.test.js` | dois técnicos iniciando ao mesmo tempo: um assume, o outro é recusado |
| RN06 | Chamado designado a um técnico da equipe continua sendo só dele | `backend/tests/aderenciaAoTermo.test.js` | chamado designado a um técnico da equipe continua sendo só dele |
| RN06 | A gestão continua vendo e movendo o chamado da equipe | `backend/tests/aderenciaAoTermo.test.js` | a gestão continua vendo e movendo o chamado da equipe |
| RN06 | Na tela, o técnico da equipe vê o botão de iniciar e nada mais | `frontend/testes/ChamadoDetalhe.test.jsx` | o técnico da equipe vê o botão para iniciar, e iniciar é o único passo |
| RN06 | Na tela, sem o aval do servidor o botão não aparece | `frontend/testes/ChamadoDetalhe.test.jsx` | sem o aval do servidor (pode_assumir), a tela não oferece o botão |
| RF05 | Reatribuir exige justificativa, atribuir pela primeira vez não | `backend/tests/reabertura.test.js` | exige justificativa na reatribuição, mas não na primeira atribuição |
| RF05 | Sem técnico e sem equipe, a atribuição é recusada e o chamado fica em triagem | `backend/tests/atribuicaoDestino.test.js` | sem técnico e sem equipe, recusa e deixa o chamado em triagem |
| RF05 | Quem não é técnico (um solicitante) não recebe chamado | `backend/tests/atribuicaoDestino.test.js` | recusa quem não é técnico (um solicitante) |
| RF05 | Técnico inativo não recebe chamado | `backend/tests/atribuicaoDestino.test.js` | recusa técnico inativo |
| RF05 | Técnico que não existe é recusado | `backend/tests/atribuicaoDestino.test.js` | recusa técnico que não existe |
| RF05 | Equipe que não existe ou está desativada é recusada | `backend/tests/atribuicaoDestino.test.js` | recusa equipe que não existe e equipe desativada |
| RF05 | Com técnico e equipe, o técnico precisa fazer parte da equipe | `backend/tests/atribuicaoDestino.test.js` | com técnico e equipe, o técnico precisa fazer parte da equipe |
| RF05 | Só técnico ativo, ou só equipe ativa, continuam atribuindo | `backend/tests/atribuicaoDestino.test.js` | só técnico ativo, ou só equipe ativa, continuam atribuindo |
| RF05 | A reatribuição passa pela mesma conferência | `backend/tests/atribuicaoDestino.test.js` | a reatribuição passa pela mesma conferência |
| RN05 | O técnico designado não cancela | `backend/tests/reabertura.test.js` | o técnico designado não cancela, nem com justificativa (RN05) |
| §2.4 | Cancelar serviço em execução exige justificativa | `backend/tests/reabertura.test.js` | exige justificativa para cancelar serviço já em execução |
| RN05 | O técnico não atribui chamados | `backend/tests/chamados.test.js` | técnico não pode atribuir chamados (apenas gestor/administrador) |
| Encerrado | Chamado encerrado guarda a conversa, mas não aceita comentário | `frontend/e2e/fluxo.spec.js` | chamado encerrado guarda a conversa mas não aceita comentário novo |
| RF09 | A avaliação guarda nota, comentário e data, e volta no chamado | `backend/tests/confirmacaoDaSolucao.test.js` | guarda a nota, o comentário e a data, e os devolve no chamado |
| RF09 | O comentário é opcional | `backend/tests/confirmacaoDaSolucao.test.js` | o comentário é opcional |
| RF09 | Comentário só de espaços não é gravado | `backend/tests/confirmacaoDaSolucao.test.js` | comentário só de espaços é o mesmo que nenhum |
| RF09 | A confirmação da solução entra na linha do tempo, sem o texto do comentário | `backend/tests/confirmacaoDaSolucao.test.js` | a confirmação entra na linha do tempo, com o solicitante como autor e sem mudar o estado |
| RF09 | Reavaliar troca a avaliação, que continua única, e atualiza a data | `backend/tests/confirmacaoDaSolucao.test.js` | reenviar troca a avaliação, continua sendo uma só e deixa a troca no histórico |
| RF09 | Técnico e gestão veem a avaliação no chamado | `backend/tests/confirmacaoDaSolucao.test.js` | quem atendeu e a gestão veem a avaliação no chamado |
| RF09 | Chamado sem avaliação devolve nulo | `backend/tests/confirmacaoDaSolucao.test.js` | chamado sem avaliação devolve avaliacao nula |
| RF09 | Depois da reabertura, a avaliação anterior deixa de valer como confirmação | `backend/tests/confirmacaoDaSolucao.test.js` | depois de reaberto, a avaliação do ciclo anterior deixa de aparecer como confirmação |
| RF09 | Nota fracionada ou fora da escala e comentário que não é texto ou passa de 1000 caracteres voltam 422 | `backend/tests/confirmacaoDaSolucao.test.js` | %s: 422, sem gravar nada |
| RF09 | Só o solicitante do chamado confirma a solução | `backend/tests/confirmacaoDaSolucao.test.js` | só o solicitante do chamado confirma: outro solicitante e a gestão não |
| RF09 | Chamado não concluído não é avaliado | `backend/tests/confirmacaoDaSolucao.test.js` | chamado que não está concluído não é avaliado, nem ganha linha de confirmação |
| RF09 | A tela diz que avaliar é confirmar, e que quem discorda reabre | `frontend/testes/ChamadoDetalhe.test.jsx` | diz ao solicitante que avaliar é confirmar, e que quem discorda reabre |
| RF09 | A tela envia a nota e o comentário opcional | `frontend/testes/ChamadoDetalhe.test.jsx` | envia a nota e o comentário opcional, e confirma na tela |
| RF09 | Sem comentário, só a nota é enviada | `frontend/testes/ChamadoDetalhe.test.jsx` | sem comentário, envia só a nota |
| RF09 | A nota vem com palavra ("Regular"), e não só o número | `frontend/testes/ChamadoDetalhe.test.jsx` | a nota vem com palavra: 3 é "Regular", e não "3 estrela(s)" |
| RF09 | Quem já avaliou reencontra a nota, o comentário e a data | `frontend/testes/ChamadoDetalhe.test.jsx` | quem já avaliou reencontra a nota e o comentário, com a data da confirmação |
| RF09 | A gestão vê a avaliação, sem formulário | `frontend/testes/ChamadoDetalhe.test.jsx` | a gestão vê a avaliação do solicitante, sem formulário |
| RF09 | O técnico que atendeu vê a avaliação | `frontend/testes/ChamadoDetalhe.test.jsx` | o técnico que atendeu também vê |
| RF09 | Sem avaliação, não há cartão | `frontend/testes/ChamadoDetalhe.test.jsx` | sem avaliação, a gestão não vê cartão nenhum |
| RF09 | No navegador: o solicitante confirma e avalia, e a gestão vê a avaliação | `frontend/e2e/fluxo.spec.js` | o solicitante confirma a solução e avalia, e a gestão vê a avaliação no chamado (RF09) |
| RF09 | O formulário de avaliação não tem violação de acessibilidade | `frontend/e2e/acessibilidade.spec.js` | o chamado concluído, com o formulário de avaliação, não tem violação de acessibilidade |

## 6. Distribuição automática

| Regra | O que se prova | Arquivo | Teste |
| --- | --- | --- | --- |
| Distribuição | Sem regra, o chamado vai para a triagem do gestor | `backend/tests/distribuicao.test.js` | sem regra, o chamado continua indo para a triagem do gestor |
| Distribuição | Com regra, nasce atribuído, com a prioridade e o prazo dela | `backend/tests/distribuicao.test.js` | com regra, nasce atribuído ao técnico da equipe, com a prioridade e o prazo da regra |
| Distribuição | Vai para quem tem menos chamados; no empate, o de menor id, e depois quem recebeu há mais tempo | `backend/tests/distribuicao.test.js` | divide pela carga: vai para quem tem menos chamados em aberto |
| Distribuição | O técnico de plantão recebe mesmo com mais carga | `backend/tests/distribuicao.test.js` | o técnico de plantão recebe mesmo com mais carga; desativado, a equipe divide |
| Distribuição | A regra mais específica vence | `backend/tests/distribuicao.test.js` | a regra mais específica vence, e a de equipe desativada cede à mais geral |
| Distribuição | Equipe sem técnico ativo: o chamado não se perde, vai à triagem | `backend/tests/distribuicao.test.js` | equipe sem técnico ativo: o chamado fica para a triagem, como sem regra |
| Distribuição | Duas aberturas simultâneas não leem a mesma carga | `backend/tests/distribuicao.test.js` | a escolha espera a vez da equipe: duas aberturas simultâneas não leem a mesma carga |
| Distribuição | Só a gestão lê e cria regras | `backend/tests/distribuicao.test.js` | é da gestão: técnico e solicitante não leem nem criam |

## 7. Manutenção preventiva e equipamentos (NBR 5674)

| Regra | O que se prova | Arquivo | Teste |
| --- | --- | --- | --- |
| Preventiva | No dia previsto, gera o chamado e avança o plano | `backend/tests/preventiva.test.js` | no dia previsto, gera um chamado preventivo com prazo no fim do dia e avança o plano |
| Preventiva | Rodar de novo no mesmo dia não duplica | `backend/tests/preventiva.test.js` | rodar de novo no mesmo dia não duplica |
| Preventiva | Duas passagens simultâneas geram um chamado só | `backend/tests/preventiva.test.js` | duas passagens simultâneas do agendador geram um chamado só |
| Preventiva | Respeita a antecedência | `backend/tests/preventiva.test.js` | respeita a antecedência: gera dias antes, e não antes da janela |
| Preventiva | Dia 31 não escorrega para o 28 | `backend/tests/preventiva.test.js` | mensal a partir de um dia 31 não escorrega para o dia 28 |
| Preventiva | Plano desativado não gera | `backend/tests/preventiva.test.js` | plano desativado não gera |
| Preventiva | Com responsável, o chamado nasce atribuído | `backend/tests/preventiva.test.js` | com responsável, o chamado nasce atribuído, pelos estados do fluxo, e o técnico é avisado |
| Preventiva | Responsável desativado: entra na triagem, sem técnico | `backend/tests/preventiva.test.js` | responsável desativado depois do cadastro: o chamado entra na triagem, sem técnico |
| Preventiva | O cron diário da Vercel aponta para a rota certa | `backend/tests/preventiva.test.js` | o job do vercel.json aponta para esta rota, uma vez por dia |
| Preventiva | O cumprimento mede só o que já pode ser julgado | `backend/tests/preventiva.test.js` | mede o cumprimento pelo que já pode ser julgado, recortado pela data prevista |
| Equipamento | O código da etiqueta é único, em qualquer grafia | `backend/tests/preventiva.test.js` | o mesmo código, escrito de outro jeito, é recusado como duplicado |
| Equipamento | Pelo QR Code o chamado herda local e categoria | `backend/tests/preventiva.test.js` | só com o equipamento, herda local e categoria dele (o caminho do QR Code) |
| Preventiva | Da tela do gestor à fila do técnico | `frontend/e2e/preventiva.spec.js` | gestão cadastra equipamento e plano, gera a execução, e o técnico a recebe na fila |
| Equipamento | Pelo endereço do QR Code o solicitante abre o chamado sem escolher o local | `frontend/e2e/preventiva.spec.js` | pelo endereço do QR Code, o solicitante abre o chamado sem escolher o local |

## 8. Relatórios e exportação (RF10)

| Regra | O que se prova | Arquivo | Teste |
| --- | --- | --- | --- |
| RF10 | Relatório é da gestão | `backend/tests/relatorios.test.js` | nega acesso a solicitante e a técnico |
| RF10 | O tempo de atendimento e a nota média dos concluídos | `backend/tests/relatorios.test.js` | calcula tempo de atendimento e nota média dos concluídos |
| RF10 | Carga por técnico | `backend/tests/relatorios.test.js` | lista carga por técnico |
| Fuso | O dia é o da instituição, não o do servidor | `backend/tests/relatorios.test.js` | conta o dia no fuso da instituição, não em UTC |
| Fuso | A noite do último dia entra no período | `backend/tests/relatorios.test.js` | o último dia vai até a meia-noite de Brasília, e a noite entra |
| Consistência | O gráfico e o resumo fecham no mesmo recorte | `backend/tests/relatorios.test.js` | o gráfico e o resumo continuam fechando no mesmo recorte |
| Marcos | Tempo de triagem, até o atendimento e de execução | `backend/tests/execucao.test.js` | calcula tempo de triagem, até atendimento e de execução |
| RF10 | O CSV neutraliza fórmula do Excel | `backend/tests/exportacao.test.js` | neutraliza título que o Excel leria como fórmula |
| RF10 | O PDF do resumo é válido | `backend/tests/exportacao.test.js` | devolve um PDF válido com cabeçalho de download |
| RF10 | Solicitante e técnico não exportam | `backend/tests/exportacao.test.js` | solicitante e técnico não exportam |

## 9. Cadastros (RF02, RF11, RN10)

| Regra | O que se prova | Arquivo | Teste |
| --- | --- | --- | --- |
| RF11, RN10 | Desativar um local preserva o vínculo dos chamados | `backend/tests/cadastrosEBusca.test.js` | gestor cria local e o desativa sem perder o vínculo |
| RF11 | Nome repetido volta com mensagem própria | `backend/tests/cadastrosEBusca.test.js` | recusa nome repetido com mensagem própria, não erro interno |
| RF02 | Planilha com linha errada é recusada inteira | `backend/tests/importacaoLocais.test.js` | recusa o arquivo inteiro quando uma linha está errada |
| RF02 | Reenviar a planilha não duplica | `backend/tests/importacaoLocais.test.js` | reenviar o mesmo arquivo não duplica nada |
| RF02, RF11 | Importar a planilha e abrir chamado num dos locais, na tela | `frontend/e2e/fluxo.spec.js` | importar planilha de locais e abrir chamado num deles (RF02/RF11) |
| RNF03 | Lista de locais longa: desenha os 50 primeiros e libera o resto sob demanda | `frontend/testes/Cadastros.test.jsx` | desenha só os primeiros 50 e libera o resto sob demanda |
| RNF03 | O filtro de locais alcança o que ainda não foi desenhado | `frontend/testes/Cadastros.test.jsx` | o filtro alcança o que ainda não foi desenhado e a contagem continua sendo da lista inteira |
| RNF03 | Mudar o filtro de locais volta a mostrar só o começo | `frontend/testes/Cadastros.test.jsx` | mudar o filtro volta a mostrar só o começo |
| RNF03 | Lista curta de locais não mostra o botão | `frontend/testes/Cadastros.test.jsx` | uma lista curta não mostra o botão |
| RNF03 | Tabela de contas longa: desenha as 25 primeiras e libera o resto sob demanda | `frontend/testes/Usuarios.test.jsx` | desenha só as primeiras 25 e libera o resto sob demanda |
| RNF03 | O filtro de contas olha nome e e-mail, e alcança as não desenhadas | `frontend/testes/Usuarios.test.jsx` | o filtro por nome ou e-mail alcança contas que ainda não foram desenhadas |
| RNF03 | Filtro de contas sem resultado diz isso | `frontend/testes/Usuarios.test.jsx` | filtro sem resultado diz isso, em vez de "nenhum usuário cadastrado" |
| RNF03 | Com poucas contas não há filtro nem botão | `frontend/testes/Usuarios.test.jsx` | com poucas contas não há filtro nem botão |
| RNF03 | A API comprime a lista longa quando o cliente aceita gzip, com o mesmo conteúdo | `backend/tests/compressao.test.js` | comprime uma lista longa quando o cliente aceita gzip, e o conteúdo é o mesmo |
| RNF03 | A lista comprimida pesa menos de um quinto da crua | `backend/tests/compressao.test.js` | encolhe a lista a menos de um quinto do tamanho |
| RNF03 | Sem Accept-Encoding a resposta continua crua | `backend/tests/compressao.test.js` | não comprime para quem não aceita compressão |
| RNF03 | A resposta comprimida avisa as caches com Vary: Accept-Encoding | `backend/tests/compressao.test.js` | avisa as caches que a resposta varia conforme o Accept-Encoding |
| RNF03 | Resposta pequena não é comprimida | `backend/tests/compressao.test.js` | deixa como está a resposta pequena, que não compensa comprimir |
| Equipes | Só a gestão cria equipe | `backend/tests/equipesMateriais.test.js` | gestor cria equipe; solicitante não |
| Materiais | O técnico designado lança o consumo | `backend/tests/equipesMateriais.test.js` | técnico designado lança consumo no chamado |
| RF09 | Nota fora de 1 a 5 volta 422, não erro do banco | `backend/tests/equipesMateriais.test.js` | avaliação com nota fora de 1..5 volta 422, e não erro do banco |
| Cadastros | Material: atualiza campo a campo, e recusa sem campo ou inexistente | `backend/tests/cadastrosAuxiliares.test.js` | recusa atualizar sem campo nenhum, e material que não existe |
| Cadastros | Equipe: ao adicionar técnico, recusa equipe e usuário inexistentes e técnico inativo | `backend/tests/cadastrosAuxiliares.test.js` | ao adicionar técnico: equipe inexistente, usuário inexistente e técnico inativo são recusados |
| Cadastros | Equipamento: categoria ou local inexistente volta 422, não erro do banco | `backend/tests/cadastrosAuxiliares.test.js` | categoria ou local que não existem voltam 422, e não erro do banco |
| Cadastros | Equipamento: trocar o código por um que já existe volta 409 | `backend/tests/cadastrosAuxiliares.test.js` | trocar o código por um que já existe volta 409 |

## 10. Segurança, privacidade e acessibilidade

| Regra | O que se prova | Arquivo | Teste |
| --- | --- | --- | --- |
| Cabeçalhos | A API não pode ser embutida em quadro de outro site | `backend/tests/cabecalhos.test.js` | proíbe embutir a API em quadro de outro site |
| CORS | Um site de terceiro é recusado | `backend/tests/cors.test.js` | recusa um site qualquer |
| CSP | Com a política em vigor, o navegador não relata violação | `frontend/e2e/seguranca.spec.js` | com a CSP em vigor, as telas funcionam e o navegador não relata violação |
| Cookie | A sessão fica num cookie que o script da página não lê | `frontend/e2e/sessao.spec.js` | a sessão fica num cookie que o script da página não lê |
| Privacidade | O aviso abre sem login e cabe na tela | `frontend/e2e/privacidade.spec.js` | abre sem login e cabe na tela |
| Privacidade | Abrir o aviso a partir do cadastro não perde o formulário | `frontend/e2e/privacidade.spec.js` | do cadastro, abre em outra aba e o formulário continua preenchido |
| LGPD | O IP do pedido de recuperação não fica para sempre | `backend/tests/recuperacaoSenha.test.js` | apaga pedidos velhos, junto com o IP que eles guardam |
| Acessibilidade | O detalhe do chamado passa no axe (WCAG 2.2 AA e boas práticas); as demais telas, públicas e internas, passam no mesmo arquivo, nos dois projetos | `frontend/e2e/acessibilidade.spec.js` | o detalhe do chamado não tem violação de acessibilidade |
| Acessibilidade | O diálogo de confirmação aberto também passa no axe | `frontend/e2e/acessibilidade.spec.js` | o diálogo de confirmação aberto não tem violação de acessibilidade |
| Acessibilidade | Ao trocar de tela, o título da aba muda e o foco vai ao h1, num navegador de verdade | `frontend/e2e/acessibilidade.spec.js` | o título da aba acompanha a tela e o foco vai para o título da página |
| Acessibilidade | O atalho para o conteúdo leva o foco para dentro do main | `frontend/e2e/acessibilidade.spec.js` | o atalho "Pular para o conteúdo" leva o foco para dentro do conteúdo |
| Acessibilidade | Toda rota do App.jsx tem título próprio | `frontend/testes/AnuncioDeRota.test.jsx` | toda rota do App.jsx tem título próprio, e o endereço que não existe vira "Página não encontrada" |
| Acessibilidade | Trocar de caminho leva o foco ao h1 | `frontend/testes/AnuncioDeRota.test.jsx` | ao trocar de caminho, leva o foco ao h1 da tela nova |
| Acessibilidade | Trocar só a query não tira o foco de onde a pessoa estava | `frontend/testes/AnuncioDeRota.test.jsx` | trocar só a query (?aba=) na mesma tela não tira o foco de onde a pessoa estava |
| Acessibilidade | As seções da preventiva dizem qual está aberta, sem prometer setas | `frontend/testes/Preventiva.test.jsx` | as seções são botões com estado, e não um tablist que promete setas que não existem |
| Acessibilidade | As seções dos cadastros dizem qual está aberta | `frontend/testes/Cadastros.test.jsx` | a seção aberta é dita por aria-pressed, não só pela borda azul |
| Acessibilidade | O select de técnico tem nome acessível | `frontend/testes/ChamadoDetalhe.test.jsx` | o select de técnico da atribuição se chama "Técnico responsável" |
| Acessibilidade | Nenhum texto usa cinza cru do Tailwind, que escapa dos tokens medidos | `frontend/testes/contraste.test.js` | nenhum texto da tela usa gray de 100 a 400 |
| Observabilidade | Um 500 vira uma linha, com a rota sem a query string e sem a primeira linha do stack | `backend/tests/errosGuardados.test.js` | um 500 vira uma linha, com a rota sem a query string e sem a primeira linha do stack |
| Observabilidade | O e-mail que o erro repetir sai mascarado | `backend/tests/errosGuardados.test.js` | o e-mail que o erro repetir sai mascarado |
| Observabilidade | Recusa de cliente (4xx) não é gravada | `backend/tests/errosGuardados.test.js` | recusa de cliente (4xx) não é erro nosso: não grava |
| Observabilidade | Se o banco falhar ao gravar, o erro original ainda é respondido | `backend/tests/errosGuardados.test.js` | se o banco falhar ao gravar, o erro original ainda é respondido |
| Observabilidade | Passado o teto por minuto, a tabela para de crescer | `backend/tests/errosGuardados.test.js` | passado o teto por minuto, o console segue recebendo e a tabela para de crescer |
| LGPD | O erro guardado é apagado em 30 dias, sem agendador | `backend/tests/errosGuardados.test.js` | apaga o que passou de 30 dias, sem agendador |
| Observabilidade | Só o administrador lê os erros | `backend/tests/errosGuardados.test.js` | gestor e solicitante não leem (a pilha mostra caminhos e nomes internos) |
| Observabilidade | A lista tem teto de 200, piso de 1 e padrão de 50 | `backend/tests/errosGuardados.test.js` | o limite pedido tem teto de 200, piso de 1 e padrão de 50 |
| Observabilidade | A tela de erros começa recolhida e só consulta ao abrir | `frontend/testes/ErrosDoSistema.test.jsx` | começa recolhida e não consulta a API antes de abrir |
| Observabilidade | Aberta, a lista dos erros passa no axe | `frontend/e2e/acessibilidade.spec.js` | os erros do sistema, abertos na tela de usuários, não têm violação de acessibilidade |
| LGPD | O aviso de privacidade diz que guarda erros, e sem pessoa | `frontend/testes/Privacidade.test.jsx` | diz o que é guardado, inclusive o que passa despercebido |
| Desempenho | Aba escondida não consulta os avisos | `frontend/testes/Avisos.test.jsx` | com a aba escondida, não consulta: um aparelho no fundo não gasta a API |
| Desempenho | Ao voltar para a aba, consulta na hora | `frontend/testes/Avisos.test.jsx` | ao voltar para a aba, consulta na hora, sem esperar o minuto |
| Desempenho | As telas de gestão vêm sob demanda | `frontend/testes/telaSobDemanda.test.jsx` | as telas de gestão vêm sob demanda |
| Desempenho | O que o técnico usa sem conexão fica no arquivo principal | `frontend/testes/telaSobDemanda.test.jsx` | o que o técnico usa sem conexão fica no arquivo principal, não sob demanda |
| Desempenho | Pedaço que sumiu numa publicação recarrega a página uma vez | `frontend/testes/telaSobDemanda.test.jsx` | se o pedaço sumiu (publicação nova), recarrega a página uma vez e não pisca erro |
| Desempenho | Se continuar falhando, mostra o erro em vez de recarregar em laço | `frontend/testes/telaSobDemanda.test.jsx` | se já recarregou e continua falhando, mostra o erro em vez de recarregar em laço |
| Acessibilidade | Se o h1 chega depois (tela sob demanda), o foco passa a ele | `frontend/testes/AnuncioDeRota.test.jsx` | se o h1 chega depois (tela sob demanda), o foco passa a ele |
| Acessibilidade | O foco não é roubado se a pessoa já o moveu | `frontend/testes/AnuncioDeRota.test.jsx` | se a pessoa já mexeu o foco quando o h1 chega, o foco não é roubado |
| Entrada | Identificador malformado na rota é 404, e não erro interno gravado no painel | `backend/tests/entradaMalformada.test.js` | GET /chamados/%s responde 404, sem gravar erro do sistema |
| Entrada | Vale para os identificadores secundários (anexo, material, técnico) | `backend/tests/entradaMalformada.test.js` | vale para os identificadores secundários da rota (anexo, material, técnico da equipe) |
| Entrada | Vale em todos os roteadores | `backend/tests/entradaMalformada.test.js` | vale em todos os roteadores, e não só no de chamados |
| Entrada | Sem sessão, a resposta continua 401 | `backend/tests/entradaMalformada.test.js` | quem não entrou continua recebendo 401, e não uma pista sobre o formato do endereço |
| Entrada | Identificador válido que não existe segue o 404 da rota | `backend/tests/entradaMalformada.test.js` | um identificador válido que não existe segue sendo o 404 da própria rota |
| Entrada | Data malformada ao remover feriado é 404 | `backend/tests/entradaMalformada.test.js` | DELETE /sla/feriados/abc responde 404 em vez de erro interno |
| Entrada | Número com casa decimal em campo inteiro é 422 | `backend/tests/entradaMalformada.test.js` | recusa prazo com casa decimal (422), sem alterar o SLA |
| Entrada | Chave fracionada ou maior que um INTEGER é 422 | `backend/tests/entradaMalformada.test.js` | recusa chave fracionada e chave que não cabe num INTEGER ao abrir chamado |
| Entrada | Quantidade de material continua aceitando decimal | `backend/tests/entradaMalformada.test.js` | quantidade de material continua aceitando casa decimal |
| Entrada | "ativo" precisa ser verdadeiro ou falso | `backend/tests/entradaMalformada.test.js` | recusa "ativo" que não é verdadeiro ou falso ao editar equipe |
| Entrada | Filtro malformado é 422 e diz qual | `backend/tests/entradaMalformada.test.js` | GET %s responde 422 dizendo qual filtro |
| Entrada | Filtro válido continua filtrando | `backend/tests/entradaMalformada.test.js` | filtro válido continua filtrando |
| Entrada | Filtro repetido ou aninhado é 400 | `backend/tests/entradaMalformada.test.js` | GET %s (filtro repetido ou aninhado) responde 400 |
| Entrada | Caractere nulo no endereço ou no filtro é 400 | `backend/tests/entradaMalformada.test.js` | no filtro e no endereço responde 400, sem gravar erro do sistema |
| Entrada | Caractere nulo no corpo, em qualquer profundidade, é 400 | `backend/tests/entradaMalformada.test.js` | no corpo, em qualquer profundidade, responde 400 |
| Entrada | Nome de anexo com caractere de controle é gravado sem ele | `backend/tests/anexos.test.js` | nome de arquivo com caractere de controle é gravado sem ele, e nunca vazio |

## 11. Demonstração publicada

| Regra | O que se prova | Arquivo | Teste |
| --- | --- | --- | --- |
| Trava | O endereço da produção é recusado em qualquer forma | `backend/tests/guardaDemonstracao.test.js` | recusa o endereço da produção em qualquer forma, com ou sem marca no banco |
| Trava | Banco com dados e sem a marca é recusado | `backend/tests/guardaDemonstracao.test.js` | banco com chamado ou com conta e sem a marca é recusado |
| Zeramento | Num banco sem a marca (a produção), recusa e não apaga nada | `backend/tests/reiniciarDemonstracao.test.js` | num banco sem a marca (a produção), recusa e não apaga nada |
| Saúde | A marca vem da linha do banco, e só o valor verdadeiro conta | `backend/tests/health.test.js` | a resposta vem da linha do banco, e só o valor verdadeiro conta |
| CORS | O site da demonstração só é aceito onde a variável é posta | `backend/tests/cors.test.js` | sem a variável, o site da demonstração não é aceito |
| Semeador | Recusa o endereço da produção, em qualquer nome que a Vercel dá | `frontend/testes/semearDestino.test.js` | recusa o endereço da produção, em qualquer um dos nomes que a Vercel dá |
| Site | O `/api` da demonstração aponta só para a API da demonstração | `frontend/testes/vercelDemonstracao.test.js` | manda /api para a API da demonstração, e só para ela |
| Site | A faixa de demonstração não aparece na produção | `frontend/testes/FaixaDeDemonstracao.test.jsx` | sem a variável (a produção), não aparece |

## 12. Outras suítes (ferramentas, infraestrutura e qualidade da tela)

Sem regra de negócio própria; guardam o que sustenta as de cima. Cada arquivo aparece aqui
com o que cobre.

| Arquivo | O que cobre |
| --- | --- |
| `backend/tests/anexosStorage.test.js` | Anexos no Supabase Storage (ver a seção 3) |
| `backend/tests/empacotamento.test.js` | Nenhum `require` do código da API recebe variável, e todo arquivo de rotas é alcançável por `require` literal a partir de `api/index.js` (é o que a Vercel empacota; `require(variavel)` passa nos testes e derruba a API publicada) |
| `backend/tests/mutacoesEmDia.test.js` | Toda mutação de `tests/mutacao.js` ainda encontra no código o trecho que desfaz (mutação desatualizada não vigia nada) |
| `frontend/testes/mutacoesEmDia.test.js` | O mesmo para `testes/mutacao.mjs` |
| `backend/tests/emailCaixa.test.js` | E-mail sem distinção de maiúsculas |
| `backend/tests/emailSenha.test.js` | A senha do SMTP não vaza para o log |
| `backend/tests/emailSmtp.test.js` | Envio por SMTP de verdade, contra um servidor de mentira |
| `backend/tests/cadastroSeguro.test.js` | Cadastro público: resposta uniforme, tetos e senha nova (ver a seção da regra RF01) |
| `backend/tests/limiteRecuperacao.test.js` | Tetos por IP e por dia do pedido de recuperação de senha |
| `backend/tests/limparDemonstracao.test.js` | O script de limpeza da demonstração, que já rodou em produção |
| `backend/tests/semearApresentacao.test.js` | Dados fictícios da apresentação na produção: travas, contas inativas, nenhum e-mail, e a remoção só do fictício (`docs/apresentacao-na-producao.md`) |
| `backend/tests/limpezaDeTestes.test.js` | A limpeza dos dados que as próprias suítes criam |
| `backend/tests/migracoes.test.js` | Migrações e privilégios no banco migrado |
| `backend/tests/nivelDeLog.test.js` | 4xx é recusa; 5xx é falha nossa e leva o stack |
| `backend/tests/notificacoes.test.js` | Despacho de e-mail das notificações e a lista de cada pessoa |
| `backend/tests/reancorarDemo.test.js` | Reancorar as datas da demonstração antiga |
| `backend/tests/tls.test.js` | Certificado da autoridade do banco |
| `backend/tests/totp.test.js` | TOTP conferido contra os vetores do RFC 6238 |
| `backend/tests/transacao.test.js` | O auxiliar de transação |
| `backend/tests/projetosVercel.test.js` | O `vercel.json` da raiz desliga o projeto legado da Vercel, e os das pastas dos projetos reais não se desligam |
| `backend/tests/versaoDoNode.test.js` | O CI testa cada versão do Node declarada em `engines` (a Vercel roda 24, o CI testava só 22) |
| `frontend/e2e/animacao.spec.js` | Animações de entrada, lista e gráfico |
| `frontend/e2e/google.spec.js` | Botão do Google no celular e foco na ativação do 2FA |
| `frontend/e2e/layout.spec.js` | Telas cabem em todas as larguras e são acessíveis por teclado |
| `frontend/e2e/pwa.spec.js` | Manifesto, uso sem conexão e etiquetas com QR Code |
| `frontend/testes/AlertaDeCriticos.test.jsx` | Faixa, selo e recorte dos críticos sem atendimento |
| `frontend/testes/AreaPrincipal.test.jsx` | A área principal das telas de entrada |
| `frontend/testes/AvisoDePrivacidade.test.jsx` | O aviso de privacidade apontado nas telas |
| `frontend/testes/AvisoDeEspaco.test.jsx` | O aviso de espaço do banco no painel da gestão |
| `frontend/testes/Avisos.test.jsx` | O sino de avisos |
| `frontend/testes/Badge.test.jsx` | Selos de estado, prioridade e atraso |
| `frontend/testes/Cadastros.test.jsx` | A tela de cadastros e a importação de planilha |
| `frontend/testes/CadastrosPendentes.test.jsx` | Pedidos de cadastro no painel e em Usuários |
| `frontend/testes/Campo.test.jsx` | Campo, botão e aviso |
| `frontend/testes/ChamadoDetalhe.test.jsx` | O detalhe do chamado: edição, conversa, histórico e conclusão com EPI |
| `frontend/testes/CodigoQR.test.jsx` | O QR Code das etiquetas |
| `frontend/testes/Confirmacao.test.jsx` | A confirmação de ação sem volta e o foco |
| `frontend/testes/Dashboard.test.jsx` | O painel da gestão: busca, filtros e lista |
| `frontend/testes/DuasEtapas.test.jsx` | Login com 2FA e a tela Minha conta |
| `frontend/testes/ExigenciaDoisFatores.test.jsx` | A exigência de 2FA na tela e a ativação |
| `frontend/testes/GraficoDeLinhas.test.jsx` | O gráfico de chamados por dia |
| `frontend/testes/LoginGoogle.test.jsx` | O botão do Google |
| `frontend/testes/Marca.test.jsx` | A marca e o rótulo do perfil |
| `frontend/testes/Operacao.test.jsx` | Aviso de agendador parado, expediente e feriados |
| `frontend/testes/NovoChamado.test.jsx` | As perguntas de situação do formulário de abertura |
| `frontend/testes/PainelDeResumo.test.jsx` | O painel lateral de resumo do chamado |
| `frontend/testes/Preventiva.test.jsx` | A tela de preventiva e a ficha do equipamento |
| `frontend/testes/Privacidade.test.jsx` | O texto do aviso, e que ele não promete o que o sistema não faz |
| `frontend/testes/RegrasDeDistribuicao.test.jsx` | A tela das regras de distribuição |
| `frontend/testes/RotaProtegida.test.jsx` | Rota protegida e o endereço de volta após o login |
| `frontend/testes/TelasPorPerfil.test.jsx` | Qual tela inicial cada perfil recebe |
| `frontend/testes/Usuarios.test.jsx` | Seletor de perfil e anonimização na tela |
| `frontend/testes/animacao.test.jsx` | Movimento reduzido, número animado e entrada |
| `frontend/testes/atendimento.test.js` | Os minutos sem atendimento em palavras |
| `frontend/testes/client.test.js` | O cliente da API: sessão vencida, download e sem conexão |
| `frontend/testes/CabecalhoDePagina.test.jsx` | A margem que a tela passa ao título substitui a padrão, sem deixar vão entre o título e o conteúdo |
| `frontend/testes/telaSemNarracao.test.js` | Título de tela não traz frase fixa explicando a tela; debaixo dele só entra dado (expressão) |
| `frontend/testes/contraste.test.js` | Contraste dos tokens de cor (WCAG 2.1 AA) |
| `frontend/testes/destinoSeguro.test.js` | Para onde o login devolve a pessoa |
| `frontend/testes/listaAnimada.test.jsx` | A lista que se reorganiza |
| `frontend/testes/prepararAnexo.test.js` | A redução da foto antes do envio |
| `frontend/testes/rotulos.test.jsx` | Rótulos acessíveis, sem depender só de cor (RNF02) |

## 13. O que só um ensaio com pessoas prova

Teste automático não substitui o ensaio do fluxo com os perfis reais (item A03 do plano de
ação). A tabela abaixo é o roteiro; as três últimas colunas ficam em branco até a equipe
executar, e uma linha só se fecha com o resultado observado e a evidência anexada (captura,
protocolo do chamado, horário).

| Nº | Cenário | Resultado esperado | Resultado observado | Evidência | Quem e quando |
| --- | --- | --- | --- | --- | --- |
| 1 | Solicitante abre um chamado pela tela | Protocolo gerado, prazo calculado, chamado na fila da gestão | | | |
| 2 | Chamado crítico fica 15 minutos sem triagem | A gestão vê a faixa vermelha e o selo no cartão | | | |
| 3 | Gestão faz a triagem: urgência, impacto e risco | Prioridade sugerida; divergir pede justificativa | | | |
| 4 | Gestão atribui a um técnico | O técnico recebe o aviso e vê o chamado só na própria fila | | | |
| 5 | Técnico inicia, pede material e retoma | O prazo anda pelo tempo suspenso; o histórico registra cada passo | | | |
| 6 | Técnico conclui sem EPI e depois com EPI | A primeira tentativa é recusada; a segunda grava quem confirmou e quando | | | |
| 7 | Solicitante avalia e depois reabre dentro de 48 horas | Nota registrada; reabertura com justificativa abre ciclo novo e prazo novo | | | |
| 8 | Técnico tenta cancelar, e solicitante tenta ver chamado alheio | Ambos recusados | | | |
| 9 | Plano preventivo reativado com data futura gera o chamado e a execução é concluída | Um chamado por execução prevista, concluído com EPI | | | |
| 10 | Técnico sem sinal consulta a fila e tenta registrar uma ação | A fila guardada aparece com aviso; a ação diz que nada foi registrado | | | |
| 11 | Restaurar o backup num ambiente separado e medir o tempo | Contagens iguais às da origem; tempo de recuperação anotado | | | |
| 12 | Conferir no sistema de produção se o aviso de atraso e a preventiva rodaram | O painel da gestão não mostra "Tarefas automáticas paradas", e `/operacao/agendador` mostra as duas passagens dentro da tolerância | | | |

## 14. Lacunas conhecidas

- **Decisão pendente, não defeito:** a definição de "primeiro atendimento" do alerta de 15
  minutos. Hoje basta sair de `aberto` (triagem ou nascer atribuído); os testes da seção 4
  provam essa regra. Se a gestão quiser "o técnico iniciou", muda a condição da consulta e os
  testes acompanham.
- **Revogação com o aparelho sem rede:** conta desativada, ou "sair de todos os aparelhos",
  só chega a um aparelho offline quando ele voltar a falar com o servidor. Não há como um
  teste provar o que a rede impede; fica como risco aceito para o piloto, a registrar.
- **Backup do Storage:** o backup é o `pg_dump` do schema `public`; objetos do Supabase
  Storage não entram. Enquanto `ANEXOS_ARMAZENAMENTO` não for ligado, os anexos estão no
  banco e estão cobertos.
- **Acessibilidade além do axe:** o axe pega cerca de um terço dos problemas de WCAG. Não
  cobrem: leitor de tela de verdade (NVDA, VoiceOver), zoom de 200%, o gráfico de linhas dos
  relatórios, a impressão das etiquetas e telas com muitos dados. É revisão de gente, a
  fazer antes de a instituição adotar (obrigatória se for pública: Lei Brasileira de
  Inclusão, art. 63).
- **Execuções locais de `pwa.spec.js`:** falham no ambiente em que a matriz foi montada e
  passam no CI; a causa exata não foi encontrada.

## 13. Páginas de informação, indexação e ações à vista

Usabilidade e conformidade da casca do sistema: endereço inexistente, títulos e
descrições, o que os buscadores veem, termos, cookies, suporte e os botões que ficam à vista.
Detalhes em `docs/lgpd.md` (seção 8) e no README.

| Tema | Regra | Arquivo | Teste |
| --- | --- | --- | --- |
| 404 | Endereço inexistente tem página própria, e sem sessão leva à entrada | `frontend/testes/PaginasDeInformacao.test.jsx` | diz o que houve e oferece o caminho de volta à tela de entrada, sem sessão |
| 404 | Com sessão, o caminho de volta é o início | `frontend/testes/PaginasDeInformacao.test.jsx` | com sessão, o caminho de volta é o início do sistema |
| 404 | O endereço digitado não é repetido na tela | `frontend/testes/PaginasDeInformacao.test.jsx` | não repete na tela o endereço digitado |
| 404 | O App tem a rota coringa, fora do login: endereço inexistente não cai na entrada | `frontend/testes/EnderecoInexistente.test.jsx` | sem sessão, mostra a página não encontrada e não manda para o login |
| 404 | Endereço que parece de uma tela interna também cai nela | `frontend/testes/EnderecoInexistente.test.jsx` | endereço que parece de uma tela interna, mas não é, também cai nela |
| Termos | As páginas de informação abrem sem sessão | `frontend/testes/EnderecoInexistente.test.jsx` | as páginas de informação abrem sem sessão |
| 404 | No navegador, a página aparece sem redirecionar para o login | `frontend/e2e/paginas.spec.js` | sem sessão, mostra a página própria e leva à tela de entrada |
| Título | Toda rota tem título, e o endereço inexistente vira "Página não encontrada" | `frontend/testes/AnuncioDeRota.test.jsx` | toda rota do App.jsx tem título próprio, e o endereço que não existe vira "Página não encontrada" |
| Descrição | Toda rota tem descrição; as internas só dizem que são restritas | `frontend/testes/AnuncioDeRota.test.jsx` | toda rota do App.jsx tem descrição própria, e as telas internas só dizem que são restritas |
| Descrição | A meta troca com a rota | `frontend/testes/AnuncioDeRota.test.jsx` | troca o texto da meta description com a rota |
| Descrição | No navegador, cada página pública tem título e descrição próprios | `frontend/e2e/paginas.spec.js` | cada página pública tem título e descrição próprios |
| Indexação | O HTML pede `noindex` e traz a descrição | `frontend/testes/Indexacao.test.js` | o index.html pede para não indexar e traz a descrição |
| Indexação | O cabeçalho `X-Robots-Tag` vale na produção e na demonstração | `frontend/testes/Indexacao.test.js` | o cabeçalho X-Robots-Tag vale em todas as rotas, na produção e na demonstração |
| Indexação | O robots.txt cobre toda rota atrás do login e a API | `frontend/testes/Indexacao.test.js` | afasta os robôs de toda rota atrás do login, e da API |
| Indexação | As telas públicas ficam rastreáveis, para o robô ler o `noindex` | `frontend/testes/Indexacao.test.js` | deixa rastreáveis as telas públicas, para o robô ler o noindex delas |
| Indexação | O robots.txt diz que não substitui a autenticação | `frontend/testes/Indexacao.test.js` | diz que orienta robôs e não substitui a autenticação |
| Não abriu | Chamado inexistente tem título e caminho de volta, sem "tentar de novo" | `frontend/testes/ChamadoDetalhe.test.jsx` | endereço de chamado que não existe: título próprio e caminho de volta, sem "tentar de novo" |
| Não abriu | Chamado de outra pessoa diz que é falta de acesso | `frontend/testes/ChamadoDetalhe.test.jsx` | chamado de outra pessoa: diz que é falta de acesso, e não que o chamado sumiu |
| Não abriu | Sem conexão, tentar de novo abre o chamado quando a rede volta | `frontend/testes/ChamadoDetalhe.test.jsx` | sem conexão: explica, oferece tentar de novo, e o chamado abre quando a rede volta |
| Não abriu | Falha do servidor não culpa a conexão nem o endereço | `frontend/testes/ChamadoDetalhe.test.jsx` | falha do servidor: não culpa a conexão nem o endereço |
| Não abriu | A causa é anunciada ao leitor de tela | `frontend/testes/ChamadoDetalhe.test.jsx` | a causa é anunciada a quem usa leitor de tela |
| Não abriu | Equipamento inexistente tem título e caminho de volta | `frontend/testes/Preventiva.test.jsx` | etiqueta ou endereço de equipamento que não existe: título próprio e caminho de volta |
| Não abriu | Na ficha do equipamento, tentar de novo refaz a consulta | `frontend/testes/Preventiva.test.jsx` | sem conexão: tentar de novo refaz a consulta e abre a ficha |
| Não abriu | No navegador, endereço de chamado errado mostra a tela e leva de volta | `frontend/e2e/fluxo.spec.js` | ${endereco} mostra "Chamado não encontrado" e o caminho de volta |
| Não abriu | A tela de chamado não encontrado não tem violação de acessibilidade | `frontend/e2e/acessibilidade.spec.js` | a tela de chamado não encontrado não tem violação de acessibilidade |
| Indexação | No navegador, `noindex` no cabeçalho e no HTML | `frontend/e2e/paginas.spec.js` | toda tela sai com noindex, no cabeçalho e no HTML |
| Indexação | O robots.txt é servido como texto | `frontend/e2e/paginas.spec.js` | o robots.txt é servido como texto e afasta os robôs das telas internas |
| Termos | Estrutura e seções em ordem | `frontend/testes/PaginasDeInformacao.test.jsx` | é uma página com um título e seções em ordem, dentro de <main> |
| Termos | Diz que não é canal de emergência | `frontend/testes/PaginasDeInformacao.test.jsx` | diz que não é canal de emergência e manda para os serviços públicos |
| Termos | Não promete foro, multa, garantia nem escrita sem conexão | `frontend/testes/PaginasDeInformacao.test.jsx` | não promete o que o sistema não faz: nada de foro, multa, garantia de prazo ou escrita sem conexão |
| Cookies | A lista é a do código | `frontend/testes/PaginasDeInformacao.test.jsx` | lista o que o código de fato guarda no aparelho |
| Cookies | Diz que não há publicidade nem terceiros, e por isso não há faixa | `frontend/testes/PaginasDeInformacao.test.jsx` | diz que não há publicidade nem ferramenta de terceiros, e por isso não há faixa de consentimento |
| Cookies | Diz que a medição é própria, sem cookie nem nada no aparelho, e respeita "Não rastrear" | `frontend/testes/PaginasDeInformacao.test.jsx` | diz que a medição é própria, sem cookie nem nada guardado no aparelho, e respeita "Não rastrear" |
| Cookies | A promessa é verdadeira: sem código de análise | `frontend/testes/PaginasDeInformacao.test.jsx` | e a promessa é verdadeira: nenhum código de análise nem de publicidade na página nem nas dependências |
| Cookies | O controle apaga as consultas guardadas e confirma | `frontend/testes/PaginasDeInformacao.test.jsx` | o controle apaga as consultas guardadas no aparelho e confirma |
| Cookies | O Google é de terceiro e só aparece na entrada | `frontend/testes/PaginasDeInformacao.test.jsx` | avisa que o componente do Google é de terceiro e só aparece na entrada |
| Cookies | No navegador: nenhum cookie antes de entrar, e depois só o da sessão | `frontend/e2e/paginas.spec.js` | antes de entrar não há cookie algum, e depois só o da sessão, HttpOnly |
| Cookies | No navegador, o controle confirma o que apagou | `frontend/e2e/paginas.spec.js` | o controle da página de cookies confirma o que apagou |
| Suporte | O e-mail abre com roteiro do que contar | `frontend/testes/PaginasDeInformacao.test.jsx` | oferece o e-mail do projeto com um roteiro do que contar |
| Suporte | O rascunho nunca leva a senha | `frontend/testes/PaginasDeInformacao.test.jsx` | o rascunho nunca leva a senha, e o texto manda não enviá-la |
| Suporte | É honesto sobre prazo e emergência | `frontend/testes/PaginasDeInformacao.test.jsx` | é honesta sobre o prazo e sobre emergência |
| Suporte | Sem canal comercial nem de terceiros | `frontend/testes/PaginasDeInformacao.test.jsx` | não adiciona canal comercial nem de terceiros |
| Navegação | Sem sessão: Entrar e Criar conta; com sessão: início | `frontend/testes/PaginasDeInformacao.test.jsx` | quem já está logado volta para o início, e não para a tela de entrada |
| Ações | "Novo chamado" no cabeçalho para quem pode abrir | `frontend/testes/LayoutAcoes.test.jsx` | o perfil %s o vê em qualquer tela, e ele leva ao formulário |
| Ações | O técnico não o vê | `frontend/testes/LayoutAcoes.test.jsx` | o técnico não o vê: a API recusa a abertura para esse perfil |
| Ações | Não repete o botão da tela inicial e do formulário | `frontend/testes/LayoutAcoes.test.jsx` | não repete o botão que a tela inicial e o formulário já têm |
| Ações | Rodapé com as páginas de informação | `frontend/testes/LayoutAcoes.test.jsx` | leva às quatro páginas de informação |
| Ações | No navegador: o botão e a confirmação da abertura com o protocolo | `frontend/e2e/paginas.spec.js` | "Novo chamado" está no cabeçalho de qualquer tela e a abertura confirma com o protocolo |
| Voltar | O detalhe do chamado leva de volta à lista | `frontend/testes/ChamadoDetalhe.test.jsx` | há um caminho de volta para a lista |
| Voltar | O formulário de abertura tem caminho de volta | `frontend/testes/NovoChamado.test.jsx` | o formulário tem um caminho de volta |
| Confirmação | Abrir o chamado leva o protocolo à tela dele | `frontend/testes/NovoChamado.test.jsx` | leva o protocolo para a tela do chamado, para a pessoa saber que abriu |
| Confirmação | Mudar o estado confirma, e a confirmação sai quando outra ação começa | `frontend/testes/ChamadoDetalhe.test.jsx` | mudar o estado diz qual é o novo estado, e some quando outra ação começa |
| Confirmação | Comentar confirma | `frontend/testes/ChamadoDetalhe.test.jsx` | comentar confirma o envio |
| Confirmação | O aviso da abertura aparece uma vez e sai do histórico | `frontend/testes/ChamadoDetalhe.test.jsx` | o aviso que veio da abertura do chamado aparece uma vez e sai do histórico |
| Tablet | As telas públicas e as internas cabem em 768 px | `frontend/e2e/paginas.spec.js` | cabe numa tela de tablet |

| Monitoramento | A telemetria soma aberturas e ações ao dia | `backend/tests/telemetria.test.js` | soma as aberturas de tela e as ações ao dia, e duas gravações se somam |
| Monitoramento | O dia gravado é o de Brasília, não o de UTC | `backend/tests/telemetria.test.js` | o dia gravado é o do fuso da instituição, e não o de UTC |
| Monitoramento | Só nomes de listas fechadas: o que o cliente inventa é ignorado | `backend/tests/telemetria.test.js` | só grava nomes da lista fechada: o que o cliente inventa é ignorado, e a tabela não cresce |
| Monitoramento | Estrutura errada é recusada (400) | `backend/tests/telemetria.test.js` | recusa estrutura errada: %s |
| Monitoramento | Soma, quantidade, pior valor e o que passou do limite | `backend/tests/telemetria.test.js` | guarda soma, quantidade, pior valor e quantos passaram do limite |
| Monitoramento | O valor no limite ainda é "bom" | `backend/tests/telemetria.test.js` | o valor exatamente no limite ainda é "bom" |
| Monitoramento | Valor impossível é descartado | `backend/tests/telemetria.test.js` | descarta o valor impossível, negativo ou que não é número |
| Monitoramento | Erro da tela entra com a tela pelo modelo, sem e-mail nem endereço | `backend/tests/telemetria.test.js` | entra em erro_aplicacao com a tela pelo modelo da rota, sem e-mail e sem endereço real |
| Monitoramento | Tela fora da lista vira "outra" | `backend/tests/telemetria.test.js` | uma tela que não está na lista vira "outra": o endereço com identificador nunca é guardado |
| Monitoramento | Só o administrador lê o resumo | `backend/tests/telemetria.test.js` | só o administrador lê o resumo |
| Monitoramento | O resumo traz médias, percentual acima do limite e ações | `backend/tests/telemetria.test.js` | traz aberturas, média e percentual acima do limite por tela, e as ações |
| Monitoramento | A janela é de 7 dias, limitada a 90 | `backend/tests/telemetria.test.js` | a janela é de 7 dias por padrão e limitada a 90 |
| Monitoramento | Não mostra o que está fora da janela | `backend/tests/telemetria.test.js` | não mostra o que está fora da janela |
| Monitoramento | Apaga o que passou de 90 dias | `backend/tests/telemetria.test.js` | apaga o que passou de 90 dias numa gravação qualquer |
| Monitoramento | A tabela não tem coluna de pessoa | `backend/tests/telemetria.test.js` | só tem as colunas de contagem, nenhuma de pessoa, sessão, IP ou aparelho |
| Monitoramento | Teto por cliente | `backend/tests/telemetria.test.js` | passado o teto do minuto, o mesmo cliente recebe 429, e outro continua passando |
| Monitoramento | As listas acompanham o aplicativo | `backend/tests/telemetria.test.js` | toda rota do frontend está em TELAS, e TELAS não tem rota que o frontend não conhece |
| Monitoramento | Toda ação registrada está em ACOES | `backend/tests/telemetria.test.js` | toda ação que o frontend registra está em ACOES |
| Monitoramento | Junta e manda tudo de uma vez, zerando | `frontend/testes/telemetria.test.js` | junta aberturas, ações e medidas, e manda tudo de uma vez, zerando em seguida |
| Monitoramento | "Não rastrear" desliga uso e desempenho, não o erro | `frontend/testes/telemetria.test.js` | "Não rastrear" desliga o uso e o desempenho, mas não o erro da tela |
| Monitoramento | No máximo cinco erros por carga | `frontend/testes/telemetria.test.js` | no máximo cinco por carga: um laço que falha não vira enxurrada |
| Monitoramento | A tela vai pelo modelo da rota | `frontend/testes/telemetria.test.js` | o que não existe vira "outra", sem repetir o endereço |
| Monitoramento | O CLS é a pior janela de deslocamentos | `frontend/testes/telemetria.test.js` | o CLS é a pior janela de deslocamentos, e ignora o que veio de uma ação da pessoa |
| Monitoramento | FCP na hora, LCP, CLS e INP ao esconder, uma vez | `frontend/testes/telemetria.test.js` | manda FCP na hora e LCP, CLS e INP quando a página é escondida, uma vez só |
| Monitoramento | Em teste, o aplicativo não envia nada | `frontend/testes/telemetria.test.js` | as funções que as telas chamam são inofensivas sob o Vitest |
| Monitoramento | A telemetria não toca no aparelho nem no endereço | `frontend/testes/telemetria.test.js` | não guarda nada no aparelho nem lê o que identifica a pessoa ou o endereço |
| Monitoramento | A telemetria só fala com a própria origem | `frontend/testes/telemetria.test.js` | só fala com a própria origem |
| Monitoramento | O painel só consulta ao abrir | `frontend/testes/UsoEDesempenho.test.jsx` | só consulta a API quando o painel é aberto |
| Monitoramento | O painel mostra médias e % acima do limite | `frontend/testes/UsoEDesempenho.test.jsx` | mostra por tela as aberturas e a média de cada medida, com quantas passaram do limite |
| Monitoramento | O painel diz que não há dado de pessoa | `frontend/testes/UsoEDesempenho.test.jsx` | diz que não há dado de pessoa e que "Não rastrear" é respeitado |
| Monitoramento | O aviso de privacidade diz que mede o uso | `frontend/testes/Privacidade.test.jsx` | diz que mede o uso por contadores, sem identificar ninguém, e que "Não rastrear" é respeitado |
| Monitoramento | No navegador: aberturas pelo modelo da rota | `frontend/e2e/telemetria.spec.js` | manda as aberturas de tela pelo modelo da rota, e nunca pelo endereço real |
| Monitoramento | No navegador: "Não rastrear" corta o envio | `frontend/e2e/telemetria.spec.js` | quem liga "Não rastrear" não é medido |
| Monitoramento | No navegador: erro de tela chega à administração | `frontend/e2e/telemetria.spec.js` | um erro de tela chega à administração com a tela pelo modelo da rota |
| Monitoramento | Erro de script de fora do aplicativo (extensão do navegador) não é enviado | `frontend/e2e/telemetria.spec.js` | erro de script de fora do aplicativo (extensão do navegador) não é enviado |
| Monitoramento | No navegador: o administrador lê o que foi medido | `frontend/e2e/telemetria.spec.js` | o administrador lê o que foi medido no painel de uso e desempenho |
| Monitoramento | A tela é contada pelo modelo da rota, nunca pelo caminho | `frontend/testes/AnuncioDeRota.test.jsx` | registra a abertura pelo MODELO da rota, nunca pelo caminho com o identificador |
| Monitoramento | Endereço inexistente vira "outra" na telemetria | `frontend/testes/AnuncioDeRota.test.jsx` | um endereço que não existe vira "outra", sem repetir o que foi digitado |
| Monitoramento | O erro que derruba a tela chega à administração, e a tela aponta o suporte | `frontend/testes/LimiteDeErroTelemetria.test.jsx` | avisa a administração e mostra a mensagem com o caminho para o suporte |
| Monitoramento | Sem a tabela (migração 031 não aplicada), responde 204 e não 500 | `backend/tests/telemetria.test.js` | sem a tabela (migração 031 ainda não aplicada), responde 204 em vez de 500 |
| Monitoramento | Sem a tabela (migração 031), o painel do administrador responde vazio, e não 500 (aconteceu em produção em 05/11/2026) | `backend/tests/telemetria.test.js` | o resumo responde vazio, e não 500 |
| Monitoramento | Sem a tabela de erros (migração 028), o resumo responde com zero erros da tela | `backend/tests/telemetria.test.js` | sem a tabela de erros (migração 028), o resumo também responde, com zero erros da tela |
| Monitoramento | Só a tabela ausente é tolerada: outro defeito do banco continua sendo erro | `backend/tests/telemetria.test.js` | só a tabela ausente é tolerada: qualquer outro defeito do banco continua sendo erro |
| Erros do sistema | Sem a tabela (migração 028), a lista de erros responde vazia, e não 500 | `backend/tests/errosGuardados.test.js` | responde a lista vazia, e não 500 |
| Monitoramento | Outro erro de banco continua sendo erro | `backend/tests/telemetria.test.js` | um erro de banco que não é a tabela ausente continua sendo erro |

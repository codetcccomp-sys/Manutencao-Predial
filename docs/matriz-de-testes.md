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

## 4. Prioridade, prazo (SLA) e atraso

| Regra | O que se prova | Arquivo | Teste |
| --- | --- | --- | --- |
| RN04 | Risco grave impõe prioridade crítica | `backend/tests/priorizacao.test.js` | RN04: risco grave impõe crítica mesmo com pontuação baixa |
| RF04 | Divergir da sugestão exige justificativa | `backend/tests/priorizacao.test.js` | exige justificativa quando o gestor diverge da sugestão |
| RF04 | O solicitante não prioriza | `backend/tests/priorizacao.test.js` | solicitante não prioriza |
| RN12 | O chamado guarda a versão da regra que o classificou | `backend/tests/priorizacao.test.js` | chamado priorizado antes guarda a versão que o classificou |
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
| Equipes | Só a gestão cria equipe | `backend/tests/equipesMateriais.test.js` | gestor cria equipe; solicitante não |
| Materiais | O técnico designado lança o consumo | `backend/tests/equipesMateriais.test.js` | técnico designado lança consumo no chamado |
| RF09 | Nota fora de 1 a 5 volta 422, não erro do banco | `backend/tests/equipesMateriais.test.js` | avaliação com nota fora de 1..5 volta 422, e não erro do banco |

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
| Acessibilidade | Toda rota do App.jsx tem título próprio | `frontend/testes/AnuncioDeRota.test.jsx` | toda rota do App.jsx tem título próprio, e as desconhecidas ficam com o nome do sistema |
| Acessibilidade | Trocar de caminho leva o foco ao h1 | `frontend/testes/AnuncioDeRota.test.jsx` | ao trocar de caminho, leva o foco ao h1 da tela nova |
| Acessibilidade | Trocar só a query não tira o foco de onde a pessoa estava | `frontend/testes/AnuncioDeRota.test.jsx` | trocar só a query (?aba=) na mesma tela não tira o foco de onde a pessoa estava |
| Acessibilidade | As seções da preventiva dizem qual está aberta, sem prometer setas | `frontend/testes/Preventiva.test.jsx` | as seções são botões com estado, e não um tablist que promete setas que não existem |
| Acessibilidade | As seções dos cadastros dizem qual está aberta | `frontend/testes/Cadastros.test.jsx` | a seção aberta é dita por aria-pressed, não só pela borda azul |
| Acessibilidade | O select de técnico tem nome acessível | `frontend/testes/ChamadoDetalhe.test.jsx` | o select de técnico da atribuição se chama "Técnico responsável" |
| Acessibilidade | Nenhum texto usa cinza cru do Tailwind, que escapa dos tokens medidos | `frontend/testes/contraste.test.js` | nenhum texto da tela usa gray de 100 a 400 |

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
| `backend/tests/emailCaixa.test.js` | E-mail sem distinção de maiúsculas |
| `backend/tests/emailSenha.test.js` | A senha do SMTP não vaza para o log |
| `backend/tests/emailSmtp.test.js` | Envio por SMTP de verdade, contra um servidor de mentira |
| `backend/tests/limiteRecuperacao.test.js` | Tetos por IP e por dia do pedido de recuperação de senha |
| `backend/tests/limparDemonstracao.test.js` | O script de limpeza da demonstração, que já rodou em produção |
| `backend/tests/limpezaDeTestes.test.js` | A limpeza dos dados que as próprias suítes criam |
| `backend/tests/migracoes.test.js` | Migrações e privilégios no banco migrado |
| `backend/tests/nivelDeLog.test.js` | 4xx é recusa; 5xx é falha nossa e leva o stack |
| `backend/tests/notificacoes.test.js` | Despacho de e-mail das notificações e a lista de cada pessoa |
| `backend/tests/reancorarDemo.test.js` | Reancorar as datas da demonstração antiga |
| `backend/tests/tls.test.js` | Certificado da autoridade do banco |
| `backend/tests/totp.test.js` | TOTP conferido contra os vetores do RFC 6238 |
| `backend/tests/transacao.test.js` | O auxiliar de transação |
| `backend/tests/versaoDoNode.test.js` | O CI testa cada versão do Node declarada em `engines` (a Vercel roda 24, o CI testava só 22) |
| `frontend/e2e/animacao.spec.js` | Animações de entrada, lista e gráfico |
| `frontend/e2e/google.spec.js` | Botão do Google no celular e foco na ativação do 2FA |
| `frontend/e2e/layout.spec.js` | Telas cabem em todas as larguras e são acessíveis por teclado |
| `frontend/e2e/pwa.spec.js` | Manifesto, uso sem conexão e etiquetas com QR Code |
| `frontend/testes/AlertaDeCriticos.test.jsx` | Faixa, selo e recorte dos críticos sem atendimento |
| `frontend/testes/AreaPrincipal.test.jsx` | A área principal das telas de entrada |
| `frontend/testes/AvisoDePrivacidade.test.jsx` | O aviso de privacidade apontado nas telas |
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

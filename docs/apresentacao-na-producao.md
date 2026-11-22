# Dados de apresentação na produção

Até a apresentação (dezembro de 2026) ninguém usa o sistema de verdade. Em vez de manter uma
cópia à parte, a produção carrega **dados fictícios** que mostram o sistema funcionando: 35
chamados nas últimas semanas, em todos os estados, com histórico, comentários, avaliações e avisos.
Quando o uso real começar, uma remoção tira o que é fictício e só ele.

A demonstração publicada em separado ([`demonstracao-publicada.md`](demonstracao-publicada.md))
continua disponível para treino, mas deixa de ser necessária para apresentar.

## O que entra

[`backend/database/semear-apresentacao.sql`](../backend/database/semear-apresentacao.sql):

| Item | Quantidade | Observação |
| --- | --- | --- |
| Chamados | 35 | 17 concluídos, 5 em andamento, 1 aguardando material, 4 atribuídos, 3 em triagem, 3 abertos, 2 cancelados. Protocolo `SMP-AAAAMMDD-DEMOnn` |
| Linha do tempo | cerca de 137 registros | Abertura, triagem, atribuição, execução, conclusão com EPI confirmado |
| Prioridade | pela regra vigente | Um chamado diverge, com justificativa (RN05). Os de risco 4 saem críticos (RN04) |
| Atraso | alguns chamados | A tela mostra atrasos de verdade; os avisos deles já constam como enviados |
| Contas fictícias | 6 a 8 | Domínio `@conserva.invalid`, **inativas**, senha que ninguém conhece |

As contas reais de técnico e de solicitante (a mais antiga de cada perfil) entram na história
como responsável e solicitante, para a fila e o "meus pedidos" delas terem o que mostrar. Sem
elas, as fictícias ocupam o lugar. Para apresentar, **entre com as contas reais**; as fictícias
só aparecem como autoras de chamados e de comentários.

## O que o seed garante

- **Só roda onde não há chamado real.** Qualquer chamado sem `-DEMO` no protocolo derruba o script
  antes de gravar. Uma segunda rodada também é recusada: para refazer, remova antes.
- **Não manda e-mail para ninguém.** As contas fictícias são inativas (não recebem aviso nem
  aparecem para atribuição), todo aviso nasce com `email_enviado_em`, e os atrasos e os críticos
  já nascem avisados: a tarefa de 15 minutos não encontra o que avisar à gestão real.
- **Não altera o cadastro** (locais, categorias, planos, regras). Os planos preventivos foram
  religados à parte, em 16/11/2026 (8 de 9), e os chamados que eles geram não têm `-DEMO`: este
  script não os remove.
- Testes: `backend/tests/semearApresentacao.test.js`, com 9 mutações em `tests/mutacao.js`.

## Como rodar

No SQL Editor do Supabase (ou pelo conector), sempre ensaiando antes:

1. Backup do dia confere (Actions → *Backup do banco*).
2. Ensaio: `BEGIN;`, o conteúdo do arquivo, `ROLLBACK;`. O resumo no fim diz o que entraria.
3. Com o resumo certo, o mesmo com `COMMIT;`.

**Refazer com datas de hoje** (recomendado na semana da apresentação, porque os chamados parecem
"de ontem" no dia em que foram semeados): rode `remover-apresentacao.sql` e depois o seed.

## Como tirar, antes do primeiro uso real

[`backend/database/remover-apresentacao.sql`](../backend/database/remover-apresentacao.sql) apaga
só o que o seed criou: os chamados `-DEMO` (com histórico, comentários, avaliações, avisos e
anexos) e as contas `@conserva.invalid`. Chamado e conta reais ficam. Também ensaie com `ROLLBACK`.
Ele recusa quando alguma conta fictícia foi ativada, e quando há anexo no Storage em chamado de
apresentação.

**Combine uma data de corte** (por exemplo, o dia seguinte à apresentação): depois dela, nada de
fictício na produção. O `limpar-demonstracao.sql`, que apaga **todos** os chamados, continua
proibido onde já há uso real.

Remover não desfaz o que foi mexido à mão: se na apresentação alguém criou um chamado de teste
com a própria conta, ele não é `-DEMO` e fica. Apague-o pela tela, ou use o
`limpar-demonstracao.sql` se ainda **não houver nenhum chamado real**.

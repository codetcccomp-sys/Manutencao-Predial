# Dados de demonstração

Carregados em 20/09/2026 para apresentação. **São fictícios.**

O §4.3 do Termo separa as duas coisas com todas as letras: dados fictícios
demonstram que o sistema funciona, mas não sustentam conclusão sobre
eficiência. Esta massa serve para o primeiro caso e não serve para o segundo.

## O que foi criado

| O quê | Quanto | Como reconhecer |
| --- | --- | --- |
| Chamados | 73 | protocolo `SMP-DEMO-###` |
| Histórico | 310 eventos | derivado dos chamados |
| Avaliações | 41 | |
| Comentários | 32 | |
| Pessoas | 9 | e-mail `code.tcc.comp+demo.*@gmail.com` |
| Equipes | 3 | |
| Locais | 36 | `Sede / ...` |

Os protocolos dizem `DEMO` em vez da data, e os e-mails carregam `+demo.` no
nome. É de propósito: daqui a seis meses, com dado real no mesmo banco, tem de
ser possível distinguir um do outro sem depender de memória. Um
`SMP-20260920-A3F1C2` fictício ao lado de um verdadeiro seria
indistinguível — e contaminaria a medida do piloto em silêncio.

### Por que os e-mails apontam para uma caixa real

A primeira versão usava `@exemplo.demo`, um domínio que não existe. Parecia a
escolha segura, e era o contrário: em 21/09 o agendador do RF08 varreu os 14
chamados vencidos, mandou 27 avisos, e o Gmail devolveu cada um com
`NXDOMAIN` para a caixa do remetente. Endereço inventado não some no vazio —
ele volta, e volta para quem enviou.

Sustentado, esse padrão (envio repetido para domínio inexistente) é o que
marca uma conta como origem de spam. Pior que isso: a devolução falsa enterra
a verdadeira, e a que importa é a do dia em que um técnico de verdade for
cadastrado com o e-mail digitado errado.

O `+demo.nome` resolve os dois: o Gmail ignora o que vem depois do `+` na
entrega, então tudo cai na caixa de sempre, sem devolução nenhuma. E a
apresentação ganha uma coisa que não tinha — dá para mostrar a notificação
chegando de verdade no celular enquanto se demonstra o chamado.

O sistema continua sem saber que esses endereços são de teste: ele tenta
entregar a todo mundo, sempre. Um campo `recebe_email` no usuário resolveria
isso de forma definitiva, e é o caminho certo se algum dia houver conta de
teste em produção de verdade — mas é migração mais código, e não muda nada
para o piloto.

Se preferir protocolos realistas para a apresentação, troque-os; só anote em
algum lugar qual faixa de `id` é fictícia, porque a rastreabilidade se perde.

## Como os números foram construídos

Não são aleatórios puros. As proporções foram escolhidas para que os
relatórios mostrem operação, não um caso extremo:

- **60% concluídos**, o resto distribuído pelos demais estados
- **82% dentro do prazo** — o suficiente para o indicador ter as duas cores
- **40% dos chamados em aberto estão atrasados**, não 100%: painel todo
  vermelho parece defeito, não operação
- Diagnóstico e serviço **amarrados ao problema**: "Porta desalinhada" fecha
  com dobradiça realinhada, não com desobstrução de calha
- Categorias em locais plausíveis: hidráulica nos sanitários, climatização
  nas salas
- Nota média **4,24**, com alguns 2 e 3 — avaliação toda 5 não convence

Conferido: nenhum chamado conclui antes de abrir, nenhum evento de histórico
antecede a abertura do seu chamado.

## Apagar antes do piloto real

**Faça isto antes do primeiro chamado de verdade.** Dado fictício misturado
com real destrói a medida do §4.3, e não há como separar depois.

```sql
BEGIN;

WITH demo AS (SELECT id FROM chamado WHERE protocolo LIKE 'SMP-DEMO-%')
DELETE FROM avaliacao        WHERE chamado_id IN (SELECT id FROM demo);
WITH demo AS (SELECT id FROM chamado WHERE protocolo LIKE 'SMP-DEMO-%')
DELETE FROM comentario       WHERE chamado_id IN (SELECT id FROM demo);
WITH demo AS (SELECT id FROM chamado WHERE protocolo LIKE 'SMP-DEMO-%')
DELETE FROM anexo            WHERE chamado_id IN (SELECT id FROM demo);
WITH demo AS (SELECT id FROM chamado WHERE protocolo LIKE 'SMP-DEMO-%')
DELETE FROM notificacao      WHERE chamado_id IN (SELECT id FROM demo);
WITH demo AS (SELECT id FROM chamado WHERE protocolo LIKE 'SMP-DEMO-%')
DELETE FROM historico_chamado WHERE chamado_id IN (SELECT id FROM demo);

DELETE FROM chamado WHERE protocolo LIKE 'SMP-DEMO-%';

-- O padrão precisa do `+demo.`: sem ele, 'code.tcc.comp%@gmail.com' casaria
-- também com a conta do administrador, que é real e não deve ser apagada.
DELETE FROM equipe_tecnico WHERE usuario_id IN
  (SELECT id FROM usuario WHERE email LIKE 'code.tcc.comp+demo.%@gmail.com');
DELETE FROM notificacao WHERE usuario_id IN
  (SELECT id FROM usuario WHERE email LIKE 'code.tcc.comp+demo.%@gmail.com');
DELETE FROM usuario WHERE email LIKE 'code.tcc.comp+demo.%@gmail.com';

-- Confira antes de confirmar: as três contagens devem dar zero.
SELECT (SELECT count(*) FROM chamado WHERE protocolo LIKE 'SMP-DEMO-%') AS chamados,
       (SELECT count(*) FROM usuario
         WHERE email LIKE 'code.tcc.comp+demo.%@gmail.com')              AS pessoas,
       (SELECT count(*) FROM historico_chamado h
          LEFT JOIN chamado c ON c.id = h.chamado_id WHERE c.id IS NULL) AS orfaos;

COMMIT;  -- ou ROLLBACK, se algum número não bater
```

**Os 36 locais e as 3 equipes não são apagados por esse roteiro**, de
propósito: a estrutura de locais costuma ser aproveitada e ajustada, não
jogada fora. Se o prédio real for outro, desative-os pela tela de Cadastros
em vez de excluir — o sistema não tem exclusão, e um local referenciado por
chamado não deve sumir do histórico.

## O que este dado NÃO prova

Que a manutenção melhorou. Para isso é preciso a medida de antes (§1 do
roteiro de piloto) e um período com chamados reais. Números fictícios
apresentados como resultado seriam invenção, não conclusão — e a diferença
aparece na primeira pergunta de banca sobre a origem dos dados.

A resposta honesta, se perguntarem: *"são dados de demonstração, criados para
exercitar o sistema; a avaliação de eficiência depende do piloto com dados
reais, que está descrito no roteiro."*

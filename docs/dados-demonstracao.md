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
- **75% dentro do prazo** — o suficiente para o indicador ter as duas cores
- **40% dos chamados em aberto estão atrasados**, não 100%: painel todo
  vermelho parece defeito, não operação
- Diagnóstico e serviço **amarrados ao problema**: "Porta desalinhada" fecha
  com dobradiça realinhada, não com desobstrução de calha
- Categorias em locais plausíveis: hidráulica nos sanitários, climatização
  nas salas
- Nota média **4,24**, com alguns 2 e 3 — avaliação toda 5 não convence

### O 82% que virou 75%

A primeira versão deste documento dizia 82% dentro do prazo. O número estava
apoiado em três chamados impossíveis.

Os três — `SMP-DEMO-010`, `032` e `044` — traziam a conclusão datada **antes**
do início da execução, e `inicio_execucao` nulo. Nessa ordem, eles contavam
como pontuais: a conclusão caía poucas horas depois da abertura, dentro do
prazo, enquanto o evento que colocava o chamado em andamento acontecia horas
mais tarde. Um chamado não conclui antes de começar.

Ao endireitar a ordem, os três aparecem pelo que são. Os três são de
prioridade **crítica**, cujo prazo é de 8 horas, e o evento de início de
execução acontece 9 horas depois da abertura: o prazo já tinha vencido uma
hora antes de alguém encostar no chamado. Nenhuma data de conclusão os torna
pontuais.

Poderia ter mexido em mais datas para o número voltar a 82%. Não mexi, e a
razão cabe numa pergunta de banca: "como você chegou nesses 82%?". Dado
ajustado para bater com um número anotado antes não tem resposta boa. 75%
mostra as duas cores no indicador igual, que era o objetivo real.

### Conferido

Oito verificações, todas em zero:

| Verificação | |
| --- | --- |
| Evento de histórico com data no futuro | 0 |
| Concluído sem `inicio_execucao` | 0 |
| Conclusão antes do início da execução | 0 |
| Início da execução antes da abertura | 0 |
| Conclusão antes da abertura | 0 |
| Evento anterior à abertura do seu chamado | 0 |
| Cadeia de estados quebrada (o `estado_anterior` não bate com o evento que veio antes) | 0 |
| Estado atual do chamado diferente do último evento do histórico | 0 |

A penúltima pegou quatro cancelamentos que diziam vir de `em_triagem` quando
o chamado estava em `atribuido` — na tela de marcos isso apareceria como uma
transição que não aconteceu.

## Trazer para perto de hoje antes de apresentar

Os prazos foram desenhados relativos ao dia da carga, e o relógio não para.
Em 30/09, dez dias depois, 22 dos 25 chamados abertos já apareciam em
atraso: um painel todo vermelho não mostra nada, porque sem contraste entre
"no prazo" e "atrasado" não se vê o que o sistema faz com nenhum dos dois.

O script desloca **todas** as datas da demonstração pelo mesmo intervalo, de
modo que a carga vire "agora". A ordem dos eventos, as durações e quem estoura
o prazo voltam a ser os do dia em que a massa foi desenhada. Só mexe em
chamados `SMP-DEMO-*`, no que pertence a eles e nas pessoas `+demo.`; dado
real no mesmo banco fica onde está.

```bash
cd backend
# Com a DATABASE_URL de produção no ambiente. Sem --aplicar, só mostra:
node database/reancorar-demo.js
node database/reancorar-demo.js --aplicar
```

Rodar duas vezes seguidas não empurra nada para o futuro: a âncora (a data de
criação das pessoas `+demo.`) anda junto, e a segunda execução mede a partir
da primeira. Rode **na véspera** de cada apresentação: a cada dia que passa,
mais chamados cruzam o prazo, e o retrato se afasta do desenhado.

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

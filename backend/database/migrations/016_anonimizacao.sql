-- Anonimização de pessoa sob pedido (LGPD, docs/lgpd.md seção 5).
--
-- A política decidida atende pedido de remoção anonimizando a pessoa e
-- preservando o registro da manutenção. Apagar a linha de `usuario` arrastaria
-- ou quebraria todo chamado, comentário e evento de histórico ligado a ela: o
-- prédio perderia o registro do que foi consertado por causa de um pedido
-- sobre dado pessoal. Anonimizar separa as duas coisas — some quem era, fica
-- o que foi feito.

-- Quando o pedido foi atendido.
--
-- Não é enfeite de auditoria: sem esta coluna não há como provar que o pedido
-- foi cumprido, e "atendemos, mas não sabemos quando" não é resposta. Também
-- é o que distingue uma conta anonimizada de uma conta que por acaso se chama
-- "Usuário removido" — e a distinção importa, porque a anonimizada nunca mais
-- pode ser reativada.
ALTER TABLE usuario ADD COLUMN anonimizado_em TIMESTAMPTZ;

-- O e-mail continua NOT NULL e UNIQUE, e é de propósito.
--
-- Deixá-lo nulo exigiria afrouxar a restrição para todo mundo, e uma coluna
-- que aceita nulo em nome de um caso raro passa a aceitar nulo no caso comum
-- — o cadastro sem e-mail que ninguém queria permitir. Em vez disso a conta
-- anonimizada recebe um endereço-lápide único, derivado do id.
--
-- O domínio é `.invalid`, reservado pela RFC 2606 justamente para isto:
-- nenhum servidor de e-mail do mundo o resolve. Um endereço inventado num
-- domínio qualquer voltaria como devolução na caixa do remetente a cada aviso
-- do sistema — que é exatamente o que aconteceu com `@exemplo.demo` e as 27
-- devoluções de 21/09.
COMMENT ON COLUMN usuario.anonimizado_em IS
  'Quando o pedido de remoção foi atendido. Conta anonimizada não reativa.';

-- Buscar as anonimizadas é raro (relatório de conformidade), mas o índice
-- parcial custa quase nada: só indexa as linhas que têm valor, e em operação
-- normal elas são pouquíssimas.
CREATE INDEX idx_usuario_anonimizado ON usuario (anonimizado_em)
  WHERE anonimizado_em IS NOT NULL;

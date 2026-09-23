-- Teto para o pedido de recuperação de senha (RF01).
--
-- O endpoint era o único sem limite nenhum. O teto por conta já existia
-- (MAX_PENDENTES = 3), e ele não protege o que estava em risco: a cota de
-- envio. O Gmail entrega cerca de 500 mensagens por dia. Com doze contas e
-- três pedidos por hora cada, um script chega a 864 num dia — e quando a cota
-- acaba, para TODO e-mail do sistema junto: o aviso de atraso do RF08, a
-- notificação de chamado designado, a recuperação de quem precisa de verdade.
-- Para calado, que é o pior jeito de parar.

-- Por que uma tabela nova, e não `tentativa_login`.
--
-- Contar pedido de senha junto com falha de login contamina as duas contas: o
-- limitador de login somaria pedidos de recuperação ao seu próprio teto, e
-- quinze "esqueci minha senha" passariam a bloquear o login daquele IP. São
-- dois fenômenos diferentes e merecem dois contadores.
--
-- Por que não contar direto de `recuperacao_senha`, que já guarda o IP.
--
-- Porque aquela tabela só ganha linha quando a conta EXISTE. Um contador que
-- só enxerga e-mail cadastrado é, ele mesmo, um oráculo de enumeração: daria
-- para descobrir se um endereço existe observando quando o 429 chega. Esta
-- tabela registra todo pedido, tenha conta do outro lado ou não, e por isso
-- não responde a essa pergunta.
CREATE TABLE tentativa_recuperacao (
  id        SERIAL PRIMARY KEY,
  -- Só o IP. O e-mail pedido não é guardado de propósito: não é necessário
  -- para contar, e seria uma lista de quem esqueceu a senha, em claro, ao
  -- lado de um endereço de rede.
  ip        TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A consulta do limitador é sempre "quantos deste IP na última hora". Sem o
-- índice ela varre a tabela inteira — justamente sob o ataque que enche a
-- tabela, que é quando varrer sai mais caro.
CREATE INDEX idx_tentativa_recuperacao_ip ON tentativa_recuperacao (ip, criado_em);

-- IP é dado pessoal, e esta linha só serve para contar dentro da janela. A
-- retenção acompanha a de `tentativa_login`: 24 horas, limpas junto do
-- próximo pedido, sem agendador.
-- (A limpeza vive em src/middlewares/rateLimit.js.)

-- O teto diário de envios é contado em `recuperacao_senha`, porque lá a linha
-- existe exatamente quando um e-mail foi gerado — que é o que consome cota.
-- Faltava o índice para essa contagem por data.
CREATE INDEX idx_recuperacao_criado_em ON recuperacao_senha (criado_em);

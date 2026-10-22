-- Teto para o cadastro público (RF01).
--
-- /auth/registrar era a única rota pública de escrita sem limite. Cada pedido gasta
-- uma derivação de bcrypt (a parte cara) e, com a aprovação ligada, cada conta
-- inventada entra na fila de pendentes da gestão: um script enchia essa fila e
-- consumia CPU da função sem esbarrar em nada.
--
-- Mesma razão de `tentativa_recuperacao` (015) para ser uma tabela própria: contar
-- cadastro junto com falha de login ou pedido de senha contaminaria os três tetos,
-- e três fenômenos diferentes merecem três contadores. E, como lá, a linha existe
-- para todo pedido, tenha o e-mail conta ou não: um contador que só enxergasse o
-- e-mail novo seria, ele mesmo, um oráculo de quem já tem conta.
CREATE TABLE tentativa_cadastro (
  id        BIGSERIAL PRIMARY KEY,
  -- Só o IP. O e-mail do pedido não é guardado de propósito: não serve para contar,
  -- e seria uma lista de quem tentou se cadastrar ao lado de um endereço de rede.
  ip        TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Quantos deste IP na última hora" e "quantos no dia" são as duas consultas do
-- limitador; sem o índice varrem a tabela justamente sob o ataque que a enche.
CREATE INDEX idx_tentativa_cadastro_ip ON tentativa_cadastro (ip, criado_em);
CREATE INDEX idx_tentativa_cadastro_data ON tentativa_cadastro (criado_em);

-- IP é dado pessoal e a linha só serve para contar dentro da janela: 24 horas,
-- apagadas junto de um pedido seguinte, sem agendador (src/middlewares/rateLimit.js).

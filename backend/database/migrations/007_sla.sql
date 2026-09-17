-- Prazo de atendimento por prioridade.
--
-- chamado.prazo_estimado existe desde o schema original e nunca foi escrito
-- nem lido; o tipo de notificação 'atraso' existe no enum e nunca foi
-- disparado. Na prática o sistema não tinha prazo nenhum: registrava pedidos
-- e media tempo decorrido, mas não sabia dizer se algo estourou — que é o que
-- separa uma lista de pedidos de uma gestão de atendimento.

CREATE TABLE sla (
  prioridade    prioridade_chamado PRIMARY KEY,
  prazo_horas   INTEGER NOT NULL CHECK (prazo_horas > 0),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ponto de partida, não verdade absoluta: são os valores que a gestão ajusta
-- conforme a operação real. A tabela existe justamente para isso não virar
-- constante no código.
INSERT INTO sla (prioridade, prazo_horas) VALUES
  ('critica', 4),
  ('alta', 24),
  ('media', 72),
  ('baixa', 168);

-- Chamados já abertos ganham prazo contado a partir da própria abertura, com
-- o tempo já suspenso somado — senão um chamado que passou dias aguardando
-- material nasceria atrasado por uma espera que não foi da equipe.
UPDATE chamado c
   SET prazo_estimado = c.data_abertura
                      + (s.prazo_horas * interval '1 hour')
                      + c.tempo_suspenso_total
  FROM sla s
 WHERE s.prioridade = c.prioridade
   AND c.prazo_estimado IS NULL;

-- A consulta de atrasados é sempre "aberto e vencido": o índice parcial cobre
-- exatamente essa fatia, sem carregar concluídos e cancelados, que são a
-- maioria com o tempo.
CREATE INDEX idx_chamado_prazo_em_aberto
    ON chamado (prazo_estimado)
 WHERE estado NOT IN ('concluido', 'cancelado');

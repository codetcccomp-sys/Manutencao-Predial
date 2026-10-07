-- Registro de cada passagem do agendador.
--
-- O aviso de atraso e a manutenção preventiva dependem de um agendador
-- externo chamando /tarefas/*. Se ele para — job desativado após falhas,
-- segredo trocado, conta do serviço expirada —, nada no sistema acusa: não
-- há erro, porque não há chamada. O silêncio parece saúde. O piloto.md
-- descrevia isso como limitação conhecida, e a única defesa era a
-- notificação de falha do próprio agendador.
--
-- Com o registro, o sistema passa a saber quando foi a última passagem, e a
-- gestão vê na tela quando ela está velha demais.
CREATE TABLE execucao_tarefa (
  id            BIGSERIAL PRIMARY KEY,
  tarefa        TEXT        NOT NULL,
  iniciada_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminada_em  TIMESTAMPTZ,
  sucesso       BOOLEAN,
  -- O que a tarefa respondeu (quantos avisos, quantos chamados gerados), para
  -- distinguir "rodou e não tinha nada a fazer" de "rodou e fez".
  resumo        JSONB,
  erro          TEXT
);

CREATE INDEX idx_execucao_tarefa_recentes ON execucao_tarefa (tarefa, iniciada_em DESC);

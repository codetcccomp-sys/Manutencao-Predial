-- Priorização por urgência, impacto e risco (RF04, §2.5, RN04, RN12).
--
-- Até aqui a prioridade era escolhida à mão, sem nenhum critério registrado:
-- não dava para saber por que um chamado era "alta" nem auditar a decisão.
-- O Termo de Abertura dedica uma seção inteira ao tema e pede três fatores em
-- escala padronizada, uma tabela de decisão versionada e justificativa
-- obrigatória quando o gestor discorda da sugestão.

CREATE TABLE regra_priorizacao (
  id                    SERIAL PRIMARY KEY,
  versao                VARCHAR(20) NOT NULL UNIQUE,
  peso_urgencia         SMALLINT NOT NULL CHECK (peso_urgencia > 0),
  peso_impacto          SMALLINT NOT NULL CHECK (peso_impacto > 0),
  peso_risco            SMALLINT NOT NULL CHECK (peso_risco > 0),
  limiar_media          SMALLINT NOT NULL,
  limiar_alta           SMALLINT NOT NULL,
  limiar_critica        SMALLINT NOT NULL,
  -- RN04: risco grave impõe prioridade crítica e prevalece sobre qualquer
  -- cálculo automático. Fica como parâmetro, e não como "if" no código,
  -- porque o próprio critério é decisão de negócio.
  risco_critico_minimo  SMALLINT NOT NULL CHECK (risco_critico_minimo BETWEEN 1 AND 4),
  observacao            TEXT,
  vigencia_inicio       TIMESTAMPTZ NOT NULL DEFAULT now(),
  vigencia_fim          TIMESTAMPTZ,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (limiar_media < limiar_alta AND limiar_alta < limiar_critica),
  CHECK (vigencia_fim IS NULL OR vigencia_fim > vigencia_inicio)
);

-- RN12 pede versão e data de vigência para preservar a interpretação
-- histórica: só uma regra vale por vez, e as anteriores continuam existindo
-- para explicar decisões antigas.
CREATE UNIQUE INDEX idx_regra_priorizacao_vigente
    ON regra_priorizacao ((vigencia_fim IS NULL))
 WHERE vigencia_fim IS NULL;

-- Valores iniciais. O §2.5 é explícito: "os limiares numéricos e pesos, se
-- utilizados, permanecem como decisão de negócio a ser validada antes da
-- homologação" e "não devem ser inventados apenas para completar o sistema".
-- Por isso são pesos neutros (1,1,1) sobre a soma dos três fatores, que varia
-- de 3 a 12, com cortes distribuídos de forma uniforme — um ponto de partida
-- transparente e fácil de recalibrar, não uma calibração pretensamente
-- correta.
INSERT INTO regra_priorizacao
  (versao, peso_urgencia, peso_impacto, peso_risco,
   limiar_media, limiar_alta, limiar_critica, risco_critico_minimo, observacao)
VALUES
  ('v1', 1, 1, 1, 6, 8, 10, 4,
   'Ponto de partida com pesos neutros, pendente de validação institucional (§2.5 e §3.3 do Termo de Abertura).');

ALTER TABLE chamado
  ADD COLUMN urgencia               SMALLINT CHECK (urgencia BETWEEN 1 AND 4),
  ADD COLUMN impacto                SMALLINT CHECK (impacto  BETWEEN 1 AND 4),
  ADD COLUMN risco                  SMALLINT CHECK (risco    BETWEEN 1 AND 4),
  ADD COLUMN prioridade_sugerida    prioridade_chamado,
  ADD COLUMN prioridade_justificativa TEXT,
  -- Guarda qual versão da regra produziu a sugestão. Sem isso, recalibrar a
  -- regra tornaria impossível explicar por que um chamado antigo recebeu a
  -- prioridade que recebeu.
  ADD COLUMN regra_priorizacao_id   INTEGER REFERENCES regra_priorizacao(id),
  -- RN05: toda alteração de prioridade pelo gestor precisa ficar registrada
  -- com quem fez e quando; o texto do motivo vai em prioridade_justificativa
  -- e o evento completo, no histórico do chamado.
  ADD COLUMN priorizado_em          TIMESTAMPTZ,
  ADD COLUMN priorizado_por         INTEGER REFERENCES usuario(id);

-- A justificativa só existe quando a decisão diverge da sugestão; exigir
-- sempre encheria o campo de texto vazio de significado.
ALTER TABLE chamado ADD CONSTRAINT chamado_justificativa_quando_diverge
  CHECK (
    prioridade_sugerida IS NULL
    OR prioridade = prioridade_sugerida
    OR (prioridade_justificativa IS NOT NULL AND length(btrim(prioridade_justificativa)) >= 10)
  );

CREATE INDEX idx_chamado_prioridade ON chamado (prioridade);

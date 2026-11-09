-- RN12: a política de prazos passa a ter versão e data de vigência.
--
-- A regra de priorização já nascia versionada (008): cada mudança é uma linha
-- nova, e o chamado guarda a versão que o classificou. O SLA não: `sla` tem uma
-- linha por prioridade, e alterar o prazo apagava o valor anterior. Sobrava só
-- `atualizado_em`. Diante de um chamado antigo com prazo de 72 h, ninguém
-- conseguia dizer se aquele era o prazo vigente no dia ou um erro, nem quem o
-- tinha mudado depois.
--
-- `sla` continua sendo a fonte do cálculo (a função `prazo_sla` lê dela; mudar
-- isso seria mexer no prazo de todo chamado novo). Esta tabela é o registro:
-- uma linha por alteração, só acrescentada, com quem alterou. A versão que
-- valeu para um chamado é a mais recente com `vigente_desde` até a abertura
-- dele; o prazo em si continua gravado no chamado, na abertura.

CREATE TABLE sla_versao (
  id            SERIAL PRIMARY KEY,
  prioridade    prioridade_chamado NOT NULL,
  prazo_horas   INTEGER NOT NULL CHECK (prazo_horas > 0),
  contagem      contagem_prazo NOT NULL,
  vigente_desde TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Nulo nas linhas desta migração: o valor já estava em vigor e o autor da
  -- alteração original não foi guardado. Sem ON DELETE: conta não é apagada (RN10).
  alterado_por  INTEGER REFERENCES usuario(id)
);

CREATE INDEX idx_sla_versao_vigencia ON sla_versao (prioridade, vigente_desde DESC, id DESC);

-- Ponto de partida: o que vale hoje, desde a última alteração conhecida.
INSERT INTO sla_versao (prioridade, prazo_horas, contagem, vigente_desde)
SELECT prioridade, prazo_horas, contagem, atualizado_em FROM sla;

-- Como nas demais tabelas: nada pela API pública do Supabase (005).
DO $$
DECLARE
  papel TEXT;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON TABLE sla_versao FROM %I', papel);
      EXECUTE format('REVOKE ALL ON SEQUENCE sla_versao_id_seq FROM %I', papel);
    END IF;
  END LOOP;
END $$;

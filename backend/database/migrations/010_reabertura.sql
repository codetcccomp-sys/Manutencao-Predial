-- Reabertura (RN09) e reatribuição (RF05).
--
-- A tabela de transições do §2.4 prevê "concluído → em triagem" pelo
-- solicitante ou gestor, e a RN09 dá a janela de 48 horas mediante
-- justificativa. No código, "concluido" era terminal: um serviço malfeito só
-- podia ser tratado abrindo outro chamado, o que quebra a rastreabilidade
-- justamente no caso em que ela mais importa.

-- RF08 lista reabertura entre os eventos que geram aviso. O valor é
-- adicionado sem ser usado nesta mesma migração, porque o Postgres não
-- permite usar um rótulo de enum na transação que o criou.
ALTER TYPE tipo_notificacao ADD VALUE IF NOT EXISTS 'reabertura';

ALTER TABLE chamado
  ADD COLUMN total_reaberturas INTEGER NOT NULL DEFAULT 0 CHECK (total_reaberturas >= 0),
  ADD COLUMN reaberto_em       TIMESTAMPTZ;

-- Reabertura é um dos indicadores recomendados no §4.3; contar por consulta
-- no histórico funcionaria, mas o número é lido em toda listagem gerencial e
-- vale tê-lo à mão.
CREATE INDEX idx_chamado_reaberturas ON chamado (total_reaberturas) WHERE total_reaberturas > 0;

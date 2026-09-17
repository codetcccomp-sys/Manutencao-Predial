-- Registro da execução (RF07, RN07) e os marcos temporais do §2.6.
--
-- O chamado guardava abertura e conclusão, e nada do que aconteceu entre as
-- duas. Faltavam diagnóstico, início efetivo da execução, descrição do
-- serviço e tempo empregado — e, sem o início efetivo, dois dos indicadores
-- que o §2.6 define ("tempo até atendimento" e "tempo de execução") eram
-- impossíveis de calcular, justamente os que o documento criou para
-- desambiguar o termo "tempo de atendimento".

ALTER TABLE chamado
  ADD COLUMN diagnostico             TEXT,
  ADD COLUMN inicio_execucao         TIMESTAMPTZ,
  ADD COLUMN servico_realizado       TEXT,
  ADD COLUMN tempo_empregado_minutos INTEGER CHECK (tempo_empregado_minutos > 0);

-- RN07: a conclusão exige descrição do serviço executado.
--
-- NOT VALID de propósito: a restrição passa a valer para toda escrita nova
-- sem reprovar chamados concluídos antes desta migração, que legitimamente
-- não têm o campo. Validar retroativamente exigiria inventar texto para
-- registros históricos, que é pior que reconhecer a lacuna.
ALTER TABLE chamado ADD CONSTRAINT chamado_conclusao_exige_servico
  CHECK (
    estado <> 'concluido'
    OR (servico_realizado IS NOT NULL AND length(btrim(servico_realizado)) >= 10)
  ) NOT VALID;

-- Preenche o início efetivo dos chamados que já passaram por "em andamento",
-- a partir do histórico — é o registro que sempre existiu para isso.
UPDATE chamado c
   SET inicio_execucao = h.primeira_vez
  FROM (
    SELECT chamado_id, min(data) AS primeira_vez
      FROM historico_chamado
     WHERE estado_novo = 'em_andamento'
     GROUP BY chamado_id
  ) h
 WHERE h.chamado_id = c.id
   AND c.inicio_execucao IS NULL;

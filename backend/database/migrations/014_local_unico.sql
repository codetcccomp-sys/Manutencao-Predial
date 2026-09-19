-- Impede que o mesmo ambiente seja cadastrado duas vezes.
--
-- A tabela nasceu sem chave natural, e o custo disso apareceu no banco de
-- desenvolvimento: 1602 linhas para 303 lugares distintos, porque cada
-- execução da suíte recriava os mesmos locais. Em produção o estrago seria
-- pior — cada duplicata aparece no seletor de abertura de chamado, os
-- chamados se espalham entre cópias do mesmo lugar e o relatório por local
-- passa a somar errado justamente o indicador que o §4.3 pede.
--
-- A carga em massa, que chega junto com esta migração, torna o assunto
-- urgente: reenviar a mesma planilha dobraria o prédio inteiro.

-- 1. Consolida o que já entrou duplicado.
--
-- A chave é um ARRAY e não um texto concatenado: separador em texto colide
-- ("A|B" com bloco vazio seria igual a unidade "A" com bloco "B").
CREATE TEMP TABLE _local_dedupe ON COMMIT DROP AS
SELECT id,
       min(id) OVER (PARTITION BY chave) AS mantido,
       bool_or(ativo) OVER (PARTITION BY chave) AS algum_ativo
  FROM (
    SELECT id,
           ativo,
           ARRAY[
             lower(btrim(unidade)),
             lower(btrim(coalesce(bloco, ''))),
             lower(btrim(coalesce(pavimento, ''))),
             lower(btrim(coalesce(setor, ''))),
             lower(btrim(coalesce(ambiente, '')))
           ] AS chave
      FROM local
  ) t;

-- Os chamados das cópias passam a apontar para o sobrevivente. É o mesmo
-- lugar físico, então nenhum histórico se perde nem se desloca.
UPDATE chamado c
   SET local_id = d.mantido
  FROM _local_dedupe d
 WHERE c.local_id = d.id
   AND d.id <> d.mantido;

-- O sobrevivente é o de menor id, que pode ser uma cópia desativada enquanto
-- outra seguia em uso. Herdar a situação do grupo evita apagar um local que
-- estava ativo.
UPDATE local l
   SET ativo = TRUE
  FROM _local_dedupe d
 WHERE l.id = d.mantido
   AND d.algum_ativo
   AND NOT l.ativo;

DELETE FROM local l
 USING _local_dedupe d
 WHERE l.id = d.id
   AND d.id <> d.mantido;

-- 2. Fecha a porta.
--
-- Índice por expressão, e não UNIQUE na tabela: em SQL dois NULL são
-- distintos, então a restrição comum deixaria passar quantas cópias se
-- quisesse de qualquer local sem bloco — que é a maioria deles. O coalesce
-- iguala NULL a vazio, e o lower/btrim iguala "Sala 101", "sala 101" e
-- "Sala 101 " ao mesmo ambiente, que é o que eles são.
CREATE UNIQUE INDEX idx_local_chave_natural
    ON local (
      lower(btrim(unidade)),
      lower(btrim(coalesce(bloco, ''))),
      lower(btrim(coalesce(pavimento, ''))),
      lower(btrim(coalesce(setor, ''))),
      lower(btrim(coalesce(ambiente, '')))
    );

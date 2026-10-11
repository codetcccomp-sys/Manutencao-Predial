-- Confirmação do uso de EPI na conclusão do chamado.
--
-- A conclusão já exige a descrição do serviço (RN07). Passa a exigir também a
-- confirmação de que os equipamentos de proteção individual foram usados. É
-- registro de responsabilidade, e não controle: o sistema não tem como saber
-- se o EPI foi vestido, só como provar que alguém afirmou que sim, quando e
-- em nome de quem. Por isso guarda os dois.

ALTER TABLE chamado
  ADD COLUMN epi_confirmado_em  TIMESTAMPTZ,
  ADD COLUMN epi_confirmado_por INTEGER REFERENCES usuario(id);

-- Os dois andam juntos: uma confirmação sem autor, ou um autor sem hora, não
-- prova nada.
ALTER TABLE chamado ADD CONSTRAINT chamado_epi_autor_e_hora
  CHECK ((epi_confirmado_em IS NULL) = (epi_confirmado_por IS NULL));

-- Sem confirmação não há conclusão — a não ser para o que foi concluído antes
-- de esta migração rodar, que não tem como ter a confirmação e, como na RN07,
-- não se inventa uma para registro histórico.
--
-- Por que um corte de data e não NOT VALID, como na migração 009: a restrição
-- NOT VALID é conferida em todo UPDATE da linha, inclusive nas antigas que a
-- violam. Um chamado concluído antes da regra ficaria impossível de alterar
-- por qualquer caminho. Com o corte, ele passa, e tudo que for concluído daqui
-- em diante é cobrado.
--
-- O corte é o instante em que a migração roda em cada banco (a produção, um
-- banco de teste, uma restauração), gravado como constante dentro da
-- restrição: now() solto no CHECK mudaria de sentido a cada consulta. Sem
-- data de conclusão não há como provar que é antigo, e a linha não passa:
-- COALESCE evita que o NULL do CHECK deixe a exceção vazar para quem foi
-- concluído sem data.
DO $$
BEGIN
  EXECUTE format(
    $f$ALTER TABLE chamado ADD CONSTRAINT chamado_conclusao_exige_epi
         CHECK (
           estado <> 'concluido'
           OR epi_confirmado_em IS NOT NULL
           OR COALESCE(data_conclusao < %L::timestamptz, false)
         )$f$,
    now()
  );
END $$;

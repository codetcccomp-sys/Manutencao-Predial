-- Anexos podem morar fora do banco.
--
-- Até aqui todo anexo ia em bytea, no Postgres. Isso mantém o arquivo na
-- mesma transação e no mesmo backup do chamado, e por isso continua sendo o
-- padrão. O limite é o espaço: o plano gratuito do Supabase tem 500 MB para
-- tudo, e foto é o que mais cresce. Com ANEXOS_ARMAZENAMENTO=supabase, os
-- anexos novos vão para o Storage (1 GB no mesmo plano, e cobrado à parte
-- do banco nos pagos), e a linha guarda só a chave do objeto.
--
-- Os anexos já existentes ficam onde estão: cada linha diz onde está o seu
-- arquivo, e a leitura segue a linha. Trocar a configuração não quebra nada
-- do que já foi enviado.
ALTER TABLE anexo ALTER COLUMN conteudo DROP NOT NULL;

ALTER TABLE anexo
  ADD COLUMN armazenamento TEXT NOT NULL DEFAULT 'banco'
    CHECK (armazenamento IN ('banco', 'supabase')),
  ADD COLUMN chave_externa TEXT,
  -- Exatamente um dos dois lugares: bytes aqui, ou uma chave lá. Um anexo sem
  -- nenhum dos dois seria um link que não abre nada.
  ADD CONSTRAINT anexo_onde_esta CHECK (
    (armazenamento = 'banco' AND conteudo IS NOT NULL AND chave_externa IS NULL)
    OR (armazenamento = 'supabase' AND conteudo IS NULL AND chave_externa IS NOT NULL)
  );

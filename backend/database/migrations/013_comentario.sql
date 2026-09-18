-- Comentários no chamado (RF08 e a segunda metade da RN03).
--
-- A RN03 diz que, depois de atribuído, "alterações deverão ocorrer por
-- comentário ou ação autorizada". A ação autorizada já existia; o comentário,
-- não — na prática o solicitante perdia a janela de edição e ficava sem
-- nenhum canal para acrescentar o que faltou, e quem atendia não tinha onde
-- pedir informação sem mudar o estado do chamado.
--
-- Tabela própria, e não uma linha no histórico: o histórico registra
-- transição de estado (anterior → novo) e um comentário não é transição.
-- Forçá-lo lá exigiria colunas de estado nulas e faria a auditoria de fluxo
-- conviver com conversa, misturando duas leituras que hoje são limpas.
--
-- Sem edição e sem exclusão, por decisão: comentário é registro do
-- atendimento, como o histórico. Um texto que some depois de lido tiraria do
-- registro justamente a parte que alguém quis apagar.

CREATE TABLE comentario (
  id          SERIAL PRIMARY KEY,
  chamado_id  INTEGER NOT NULL REFERENCES chamado(id),
  usuario_id  INTEGER NOT NULL REFERENCES usuario(id),
  texto       TEXT NOT NULL CHECK (length(btrim(texto)) >= 2),
  data        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A leitura é sempre "os comentários deste chamado, em ordem": é o índice que
-- essa consulta pede, e o único acesso que a tela faz.
CREATE INDEX idx_comentario_chamado ON comentario (chamado_id, data);

-- A migração 005 fechou o acesso direto do PostgREST às tabelas, e o
-- ALTER DEFAULT PRIVILEGES de lá só alcança o que for criado pelo mesmo
-- papel. Revogar explicitamente aqui garante que esta tabela não nasça
-- exposta na API automática do Supabase.
--
-- Como em 005: anon e authenticated só existem em projeto Supabase, então
-- confere antes — num PostgreSQL comum (desenvolvimento, CI) isto não faz
-- nada, em vez de quebrar a migração.
DO $$
DECLARE
  papel TEXT;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON TABLE comentario FROM %I', papel);
      EXECUTE format('REVOKE ALL ON SEQUENCE comentario_id_seq FROM %I', papel);
    END IF;
  END LOOP;
END $$;

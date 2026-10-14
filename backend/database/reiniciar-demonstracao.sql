-- Zera o banco da DEMONSTRAÇÃO PUBLICADA, para semeá-lo de novo (docs/demonstracao-publicada.md).
--
-- Apaga o schema `public` inteiro: contas, chamados, cadastro, regras e o registro das
-- migrações. Depois é só rodar o workflow "Demonstração publicada", que migra, marca e semeia.
--
-- A trava está no primeiro bloco: o banco só é zerado se carregar a marca de demonstração
-- (`configuracao.ambiente_demonstracao = true`), que backend/database/guarda-demonstracao.js
-- grava num banco VAZIO. O banco de produção não tem essa marca, e rodar este arquivo nele
-- falha antes de apagar qualquer coisa. Mesmo assim, confira em qual projeto do Supabase o
-- SQL Editor está aberto antes de rodar.
--
-- Como o arquivo é uma transação só, se qualquer passo falhar nada é apagado.
BEGIN;

DO $$
BEGIN
  -- Dois IFs, e não um OR: o PostgreSQL planeja a consulta inteira antes de avaliar a
  -- primeira metade, e sem a tabela o segundo teste daria "relation does not exist" em
  -- vez de dizer por que foi recusado.
  IF to_regclass('public.configuracao') IS NULL THEN
    RAISE EXCEPTION 'RECUSADO: este banco não tem as tabelas do sistema, logo não está marcado como de demonstração. Nada foi apagado.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.configuracao WHERE chave = 'ambiente_demonstracao' AND valor = 'true'::jsonb
  ) THEN
    RAISE EXCEPTION 'RECUSADO: este banco não está marcado como de demonstração. Nada foi apagado.';
  END IF;
END $$;

DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

COMMIT;

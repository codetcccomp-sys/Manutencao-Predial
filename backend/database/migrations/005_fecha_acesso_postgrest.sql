-- Fecha o acesso direto ao banco pela API automática do Supabase (PostgREST).
--
-- O Supabase publica o schema "public" numa API REST em
-- https://<projeto>.supabase.co/rest/v1/, autenticada pela chave "anon" — que
-- é publicável por definição, pensada para ficar dentro do código do
-- navegador. Por padrão ele concede a anon e authenticated todos os
-- privilégios sobre as tabelas criadas no schema.
--
-- Nesta aplicação isso é uma porta aberta: quem tivesse a chave anon leria a
-- tabela usuario inteira, com e-mail e hash de senha de todo mundo, além de
-- poder inserir, alterar, apagar e até truncar qualquer tabela — tudo sem
-- passar pela API em Express, onde estão a autenticação, o RBAC e a máquina
-- de estados. Todo o controle de acesso do sistema ficava contornável por
-- uma requisição HTTP direta ao banco.
--
-- A correção aqui não é RLS, e sim tirar o privilégio: o frontend nunca fala
-- com o PostgREST, só com o Express, que conecta com papel próprio
-- (smp_backend) e privilégios próprios. Sem GRANT não há o que uma política
-- de linha precise filtrar. RLS seria o caminho se o navegador falasse
-- direto com o banco; além disso, ligá-la sem políticas bloquearia o
-- smp_backend, que não é dono das tabelas nem tem BYPASSRLS.
--
-- O verificador do Supabase vai continuar apontando "RLS disabled": o aviso
-- é genérico do modelo dele, em que o PostgREST é o caminho normal. A
-- exposição concreta está fechada pelos REVOKEs abaixo.
--
-- Os papéis anon e authenticated só existem em projetos Supabase, então cada
-- bloco confere antes de rodar — num PostgreSQL comum (desenvolvimento, CI)
-- isto não faz nada.

DO $$
DECLARE
  papel TEXT;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', papel);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', papel);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', papel);
      EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', papel);

      -- Sem isto, a próxima tabela criada volta a nascer acessível: o que
      -- concede não é o CREATE TABLE, são os privilégios padrão do Supabase.
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
        papel
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
        papel
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I',
        papel
      );
    END IF;
  END LOOP;
END $$;

-- search_path mutável numa função de gatilho: quem conseguisse criar um
-- objeto num schema que venha antes no search_path de quem dispara o
-- gatilho poderia sequestrar a resolução dos nomes usados dentro dela.
-- A função só precisa do catálogo.
ALTER FUNCTION public.set_atualizado_em() SET search_path = pg_catalog;

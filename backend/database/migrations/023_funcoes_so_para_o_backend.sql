-- Funções do schema public: EXECUTE só para quem usa.
--
-- A migração 005 tirou de anon e authenticated tudo sobre tabelas, sequências
-- e funções, mas o PostgreSQL concede EXECUTE em toda função nova também ao
-- pseudo-papel PUBLIC — e anon e authenticated herdam o que PUBLIC tem.
-- Conferido em produção: anon executava set_atualizado_em(). As tabelas
-- seguiam fechadas, mas cada função nova (o calendário da preventiva, a conta
-- de horas úteis, o prazo do SLA) ficaria chamável pela API automática do
-- Supabase, em /rest/v1/rpc/<função>, com a chave anon, que é pública.
--
-- Nenhuma delas entrega dado hoje — as que leem tabela falham por falta de
-- SELECT —, mas é superfície aberta sem motivo, e a próxima função que ler
-- algo com SECURITY DEFINER viria aberta junto. O certo é o mesmo das
-- tabelas: quem não é o backend não executa nada.

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- E daqui em diante: as funções criadas por quem roda as migrações (postgres,
-- em produção) nascem sem o EXECUTE de PUBLIC. Por isso cada migração que cria
-- função concede o EXECUTE ao smp_backend explicitamente — o teste
-- tests/migracoes.test.js cobra.
DO $$
BEGIN
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', current_user);
END $$;

-- O backend continua executando todas: as de cálculo já tinham GRANT próprio
-- (018, 021); a de gatilho não precisa (o gatilho dispara sem conferir
-- EXECUTE), mas recebe também, para nenhuma depender de PUBLIC.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smp_backend') THEN
    GRANT EXECUTE ON FUNCTION set_atualizado_em() TO smp_backend;
    GRANT EXECUTE ON FUNCTION passo_preventivo(INTEGER, unidade_repeticao) TO smp_backend;
    GRANT EXECUTE ON FUNCTION somar_horas_uteis(TIMESTAMPTZ, INTERVAL, TEXT) TO smp_backend;
    GRANT EXECUTE ON FUNCTION horas_uteis_entre(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO smp_backend;
    GRANT EXECUTE ON FUNCTION prazo_sla(prioridade_chamado, TIMESTAMPTZ, INTERVAL, INTERVAL, TEXT) TO smp_backend;
  END IF;
END $$;

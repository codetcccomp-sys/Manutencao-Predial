-- search_path fixo nas funções do schema public.
--
-- Função sem search_path próprio resolve os nomes que usa (expediente,
-- feriado, sla, make_interval...) pelo search_path de quem chama. Quem
-- conseguisse pôr um objeto com o mesmo nome num schema que venha antes
-- desviaria a função para ele. A 005 fechou isso em set_atualizado_em(); as
-- funções da 018 e da 021 nasceram sem, e o verificador de segurança do
-- Supabase apontou as quatro (function_search_path_mutable).
--
-- pg_catalog primeiro, para as funções do sistema não poderem ser
-- sombreadas; public em seguida, onde ficam as tabelas que elas leem.
ALTER FUNCTION passo_preventivo(INTEGER, unidade_repeticao) SET search_path = pg_catalog, public;
ALTER FUNCTION somar_horas_uteis(TIMESTAMPTZ, INTERVAL, TEXT) SET search_path = pg_catalog, public;
ALTER FUNCTION horas_uteis_entre(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) SET search_path = pg_catalog, public;
ALTER FUNCTION prazo_sla(prioridade_chamado, TIMESTAMPTZ, INTERVAL, INTERVAL, TEXT) SET search_path = pg_catalog, public;

-- Uso e desempenho do sistema, em contadores por dia. Sem pessoa nenhuma.
--
-- Para a administração saber quais telas se usam, quão rápido elas abrem e quais
-- ações pesam, sem ferramenta de terceiros e sem identificar ninguém. O que se
-- grava é só um número por (dia, o que, onde): quantas vezes uma tela foi aberta,
-- quantas vezes uma ação foi feita, e a soma e o pior valor de cada medida de
-- desempenho. Não há usuário, sessão, IP, cookie, aparelho nem endereço de página
-- com identificador: a tela vai pelo MODELO da rota (`/chamados/:id`), nunca pelo
-- caminho real. Um contador diário não permite voltar a uma pessoa, e é por isso que
-- não precisa de consentimento (docs/lgpd.md, seção 8).
--
-- A chave é de um conjunto fechado: quem grava confere tela, ação e medida contra
-- listas fixas (telemetria.service.js). Assim a tabela não cresce com o que um
-- cliente invente, e o pior que alguém de fora consegue é distorcer um número.
--
-- Retenção de 90 dias: dá para comparar um mês com o anterior. Apagada junto de
-- uma gravação qualquer, sem agendador (mesma escolha de erro_aplicacao, 028).
CREATE TABLE telemetria_diaria (
  -- O dia de Brasília, e não de UTC (CLAUDE.md): das 21h à meia-noite já é outro dia.
  dia    DATE NOT NULL,
  tipo   TEXT NOT NULL CHECK (tipo IN ('uso', 'desempenho')),
  -- 'tela:/relatorios', 'acao:chamado_aberto', 'LCP:/relatorios'
  chave  TEXT NOT NULL CHECK (length(chave) BETWEEN 3 AND 80),
  n      BIGINT NOT NULL DEFAULT 0,
  -- Só para desempenho: a soma dá a média (soma / n) e `ruins` conta o que passou do limite
  -- recomendado (LCP 2,5 s, FCP 1,8 s, CLS 0,1, INP 200 ms).
  soma   DOUBLE PRECISION NOT NULL DEFAULT 0,
  ruins  BIGINT NOT NULL DEFAULT 0,
  maximo DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, tipo, chave)
);

-- Como em 005 e 013: a tabela não nasce exposta na API automática do Supabase. Só existem
-- anon e authenticated num projeto Supabase; num PostgreSQL comum isto não faz nada.
DO $$
DECLARE
  papel TEXT;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON TABLE telemetria_diaria FROM %I', papel);
    END IF;
  END LOOP;
END $$;

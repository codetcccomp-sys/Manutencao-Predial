-- Prazo em horas úteis, por prioridade.
--
-- O prazo era sempre em horas corridas: um chamado de prioridade média (72 h)
-- aberto na sexta às 17h vencia na segunda às 17h, depois de um fim de semana
-- em que ninguém trabalha — e entrava no indicador de atraso por um tempo que
-- não era da equipe. Para o imprevisto grave (crítica, alta) as horas
-- corridas fazem sentido; para o resto, a régua honesta é o expediente.
--
-- A escolha é por prioridade e fica com a gestão. O padrão continua sendo
-- "corridas" em todas: a migração não muda prazo de ninguém sozinha.

CREATE TYPE contagem_prazo AS ENUM ('corridas', 'uteis');

ALTER TABLE sla ADD COLUMN contagem contagem_prazo NOT NULL DEFAULT 'corridas';

-- O expediente da instituição. Dia sem linha é dia sem expediente.
-- 0 = domingo, como o EXTRACT(DOW) do Postgres.
CREATE TABLE expediente (
  dia_semana SMALLINT PRIMARY KEY CHECK (dia_semana BETWEEN 0 AND 6),
  inicio     TIME NOT NULL,
  fim        TIME NOT NULL,
  CHECK (fim > inicio)
);

INSERT INTO expediente (dia_semana, inicio, fim) VALUES
  (1, '08:00', '18:00'),
  (2, '08:00', '18:00'),
  (3, '08:00', '18:00'),
  (4, '08:00', '18:00'),
  (5, '08:00', '18:00');

CREATE TABLE feriado (
  data      DATE PRIMARY KEY,
  descricao VARCHAR(150) NOT NULL
);

-- O tempo suspenso ("aguardando material") medido em horas úteis, ao lado do
-- corrido que já existia. Repriorizar recalcula o prazo desde a abertura, e
-- para devolver a espera ao prazo em horas úteis é preciso saber quanto dela
-- caiu dentro do expediente.
ALTER TABLE chamado ADD COLUMN tempo_suspenso_util INTERVAL NOT NULL DEFAULT '0 seconds';

-- Soma `duracao` de expediente a partir de `inicio`.
--
-- Anda dia a dia no fuso da instituição: em cada dia útil (com expediente e
-- sem feriado), consome a janela de trabalho a partir de onde o relógio está.
-- Sem nenhum expediente cadastrado, não há horas úteis para contar — aí vale
-- a conta corrida, em vez de um prazo que nunca chega.
-- STRICT: prazo nulo (prioridade sem SLA) devolve nulo na hora. Sem isso o
-- laço andaria com um relógio nulo até o teto de passos.
CREATE FUNCTION somar_horas_uteis(inicio TIMESTAMPTZ, duracao INTERVAL, fuso TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE
  restante    INTERVAL := duracao;
  relogio     TIMESTAMP := inicio AT TIME ZONE fuso;
  dia         DATE;
  janela      RECORD;
  abre        TIMESTAMP;
  fecha       TIMESTAMP;
  passos      INTEGER := 0;
BEGIN
  IF restante <= INTERVAL '0' THEN
    RETURN inicio;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM expediente) THEN
    RETURN inicio + duracao;
  END IF;

  LOOP
    passos := passos + 1;
    -- Dez anos de calendário: um feriado cadastrado em cada dia útil seria
    -- configuração quebrada, e o erro é melhor que um laço sem fim.
    IF passos > 3700 THEN
      RAISE EXCEPTION 'o expediente cadastrado não tem horas úteis suficientes para este prazo';
    END IF;

    dia := relogio::date;
    SELECT e.inicio AS ini, e.fim INTO janela FROM expediente e WHERE e.dia_semana = EXTRACT(DOW FROM dia);

    IF FOUND AND NOT EXISTS (SELECT 1 FROM feriado WHERE data = dia) THEN
      abre := GREATEST(relogio, dia + janela.ini);
      fecha := dia + janela.fim;
      IF abre < fecha THEN
        IF fecha - abre >= restante THEN
          RETURN (abre + restante) AT TIME ZONE fuso;
        END IF;
        restante := restante - (fecha - abre);
      END IF;
    END IF;

    relogio := (dia + 1)::timestamp;
  END LOOP;
END
$$;

-- Quanto de expediente há entre dois instantes. É a medida da espera por
-- material em horas úteis.
CREATE FUNCTION horas_uteis_entre(a TIMESTAMPTZ, b TIMESTAMPTZ, fuso TEXT)
RETURNS INTERVAL
LANGUAGE plpgsql STABLE AS $$
DECLARE
  total   INTERVAL := INTERVAL '0';
  de      TIMESTAMP := a AT TIME ZONE fuso;
  ate     TIMESTAMP := b AT TIME ZONE fuso;
  dia     DATE;
  janela  RECORD;
  abre    TIMESTAMP;
  fecha   TIMESTAMP;
BEGIN
  IF a IS NULL OR b IS NULL OR b <= a THEN
    RETURN INTERVAL '0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM expediente) THEN
    RETURN b - a;
  END IF;

  dia := de::date;
  WHILE dia <= ate::date LOOP
    SELECT e.inicio AS ini, e.fim INTO janela FROM expediente e WHERE e.dia_semana = EXTRACT(DOW FROM dia);
    IF FOUND AND NOT EXISTS (SELECT 1 FROM feriado WHERE data = dia) THEN
      abre := GREATEST(de, dia + janela.ini);
      fecha := LEAST(ate, dia + janela.fim);
      IF abre < fecha THEN
        total := total + (fecha - abre);
      END IF;
    END IF;
    dia := dia + 1;
  END LOOP;

  RETURN total;
END
$$;

-- O prazo de um chamado, numa função só, para criar, repriorizar e reabrir
-- fazerem a mesma conta. Devolve NULL quando a prioridade não tem prazo
-- configurado (quem chama mantém o que havia).
CREATE FUNCTION prazo_sla(
  prioridade prioridade_chamado,
  inicio TIMESTAMPTZ,
  suspenso_corrido INTERVAL,
  suspenso_util INTERVAL,
  fuso TEXT
)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE AS $$
  SELECT CASE s.contagem
           WHEN 'uteis' THEN somar_horas_uteis(inicio, make_interval(hours => s.prazo_horas) + suspenso_util, fuso)
           ELSE inicio + make_interval(hours => s.prazo_horas) + suspenso_corrido
         END
    FROM sla s
   WHERE s.prioridade = prazo_sla.prioridade
$$;

-- Em produção o backend conecta como smp_backend, que não é dono do schema.
-- Os privilégios padrão do projeto dão a ele tabelas e sequências novas, mas
-- NÃO funções novas (a migração 005 tirou o EXECUTE público). Sem este GRANT,
-- a primeira chamada dá "permission denied for function" — e só em produção,
-- porque em desenvolvimento e no CI o papel nem existe. O teste
-- tests/migracoes.test.js cobra este bloco em toda migração que cria função.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smp_backend') THEN
    GRANT EXECUTE ON FUNCTION somar_horas_uteis(TIMESTAMPTZ, INTERVAL, TEXT) TO smp_backend;
    GRANT EXECUTE ON FUNCTION horas_uteis_entre(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO smp_backend;
    GRANT EXECUTE ON FUNCTION prazo_sla(prioridade_chamado, TIMESTAMPTZ, INTERVAL, INTERVAL, TEXT) TO smp_backend;
  END IF;
END $$;

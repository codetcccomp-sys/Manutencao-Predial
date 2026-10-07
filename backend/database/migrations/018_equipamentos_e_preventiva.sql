-- Equipamentos (ativos) e manutenção preventiva.
--
-- Até aqui o sistema só conhecia o chamado corretivo: alguém percebe o
-- problema e pede. A ABNT NBR 5674 põe no centro da gestão de manutenção o
-- contrário disso — um plano, com o que verificar, em que periodicidade e por
-- quem, e o registro de que foi feito. Sem plano, a manutenção do prédio é a
-- soma das reclamações; a bomba d'água só recebe atenção no dia em que para.
--
-- Duas peças:
--
-- 1. `equipamento`: o que se mantém (bomba, quadro elétrico, split, elevador).
--    Até agora o chamado apontava só para um LOCAL, e "a sala 204 teve cinco
--    chamados" não diz se foi o mesmo ar-condicionado cinco vezes. Com o
--    equipamento, o histórico passa a ser do objeto, que é a pergunta que
--    decide entre consertar de novo ou trocar.
--
-- 2. `plano_preventivo`: "limpar o filtro do split da sala 204 a cada 3
--    meses". Uma tarefa agendada lê os planos vencendo e gera o chamado
--    sozinha, pelo mesmo fluxo do corretivo — triagem, atribuição, execução,
--    conclusão com o serviço descrito. Não há um segundo sistema para a
--    preventiva: ela é um chamado com origem diferente.

-- O nome da tabela é "equipamento", e não "ativo", porque `ativo` já é o nome
-- da coluna booleana de todos os cadastros (local, equipe, usuário). Um
-- `ativo.ativo` seria um convite ao erro em toda consulta.
CREATE TABLE equipamento (
  id               SERIAL PRIMARY KEY,
  -- O código da etiqueta (patrimônio, ou o que a instituição usar). É ele que
  -- vai no QR Code colado no equipamento, então é único e guardado já
  -- normalizado: maiúsculas, sem espaço nas pontas. "bomba-01" e "BOMBA-01 "
  -- seriam a mesma etiqueta lida de dois jeitos.
  codigo           VARCHAR(40)  NOT NULL UNIQUE
                   CHECK (codigo = upper(btrim(codigo)) AND codigo ~ '^[A-Z0-9][A-Z0-9._/-]*$'),
  nome             VARCHAR(150) NOT NULL,
  -- O sistema (elétrica, hidráulica, climatização...) é a categoria que já
  -- existe para os chamados: um chamado aberto para o equipamento herda a
  -- categoria certa sem perguntar de novo.
  categoria_id     INTEGER      NOT NULL REFERENCES categoria(id),
  local_id         INTEGER      NOT NULL REFERENCES local(id),
  fabricante       VARCHAR(100),
  modelo           VARCHAR(100),
  numero_serie     VARCHAR(100),
  data_instalacao  DATE,
  observacao       TEXT,
  ativo            BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_em        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_equipamento_local ON equipamento (local_id);

CREATE TYPE unidade_repeticao AS ENUM ('dia', 'semana', 'mes', 'ano');

-- O passo do plano como intervalo do Postgres: 3 + 'mes' vira '3 months'. É o
-- calendário do banco que soma mês e ano, com fim de mês tratado ("31 de
-- janeiro + 1 mês" é o último dia de fevereiro), e é a mesma conta na tarefa
-- agendada, na tela e nos testes.
CREATE FUNCTION passo_preventivo(quantidade INTEGER, unidade unidade_repeticao)
RETURNS INTERVAL
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE unidade
    WHEN 'dia'    THEN make_interval(days   => quantidade)
    WHEN 'semana' THEN make_interval(weeks  => quantidade)
    WHEN 'mes'    THEN make_interval(months => quantidade)
    WHEN 'ano'    THEN make_interval(years  => quantidade)
  END
$$;

CREATE TABLE plano_preventivo (
  id                  SERIAL PRIMARY KEY,
  titulo              VARCHAR(200) NOT NULL,
  -- O roteiro do serviço: o que verificar, o que trocar, o que medir. Vira a
  -- descrição de cada chamado gerado, então o técnico recebe o checklist
  -- junto com a tarefa.
  descricao           TEXT         NOT NULL,
  equipamento_id      INTEGER      REFERENCES equipamento(id),
  local_id            INTEGER      NOT NULL REFERENCES local(id),
  categoria_id        INTEGER      NOT NULL REFERENCES categoria(id),
  prioridade          prioridade_chamado NOT NULL DEFAULT 'media',
  -- "A cada 3 meses" é guardado como 3 + 'mes', e não como 90 dias: a
  -- revisão trimestral de março cai em junho no mesmo dia, e não três dias
  -- antes por causa dos meses de 31. É o calendário do Postgres que soma.
  repetir_a_cada      INTEGER      NOT NULL CHECK (repetir_a_cada BETWEEN 1 AND 366),
  unidade_repeticao   unidade_repeticao NOT NULL,
  -- A âncora do calendário do plano. Toda execução é `data_inicio + n
  -- períodos`, contada sempre a partir daqui, e nunca "a anterior + 1
  -- período": um plano mensal que começa num dia 31 cairia em 28 de
  -- fevereiro, e somando a partir daí ficaria no dia 28 para sempre. Contando
  -- da âncora, março volta para o 31.
  data_inicio         DATE         NOT NULL,
  -- A próxima execução ainda não gerada. É derivada da âncora, e guardada
  -- para a tarefa agendada achar os planos vencendo por índice. A tarefa gera
  -- o chamado `antecedencia_dias` antes dela.
  proxima_execucao    DATE         NOT NULL,
  antecedencia_dias   INTEGER      NOT NULL DEFAULT 0 CHECK (antecedencia_dias BETWEEN 0 AND 60),
  -- Responsável padrão. Com ele, o chamado já nasce atribuído; sem ele, entra
  -- na triagem como qualquer outro.
  tecnico_id          INTEGER      REFERENCES usuario(id),
  ativo               BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_por          INTEGER      NOT NULL REFERENCES usuario(id),
  criado_em           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  atualizado_em       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- O que a tarefa agendada procura: planos ativos com a próxima execução
-- chegando. Parcial, porque plano desativado nunca é procurado.
CREATE INDEX idx_plano_preventivo_vencendo ON plano_preventivo (proxima_execucao) WHERE ativo;

CREATE TRIGGER trg_plano_preventivo_atualizado_em
BEFORE UPDATE ON plano_preventivo
FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

CREATE TYPE origem_chamado AS ENUM ('corretiva', 'preventiva');

ALTER TABLE chamado
  ADD COLUMN equipamento_id INTEGER REFERENCES equipamento(id),
  ADD COLUMN origem         origem_chamado NOT NULL DEFAULT 'corretiva',
  ADD COLUMN plano_id       INTEGER REFERENCES plano_preventivo(id),
  -- A data que o plano previa para este serviço. É o que permite medir o
  -- cumprimento do plano (feito até a data, ou não) e o que impede a mesma
  -- execução de virar dois chamados.
  ADD COLUMN data_prevista  DATE,
  ADD CONSTRAINT chamado_preventiva_coerente CHECK (
    (origem = 'corretiva' AND plano_id IS NULL AND data_prevista IS NULL)
    OR (origem = 'preventiva' AND plano_id IS NOT NULL AND data_prevista IS NOT NULL)
  );

CREATE INDEX idx_chamado_equipamento ON chamado (equipamento_id) WHERE equipamento_id IS NOT NULL;

-- Uma execução prevista, um chamado. Duas passagens do agendador ao mesmo
-- tempo (um retry, um disparo manual junto com o automático) colidem aqui e
-- a segunda não cria nada — a garantia é do banco, não de quem chama.
CREATE UNIQUE INDEX idx_chamado_plano_data ON chamado (plano_id, data_prevista)
  WHERE plano_id IS NOT NULL;

-- O e-mail do aviso usa o tipo do aviso; a preventiva gerada e atribuída
-- avisa o técnico como qualquer atribuição.
COMMENT ON TABLE plano_preventivo IS
  'Manutenção preventiva (NBR 5674): o que fazer, a cada quanto, onde e por quem. Gera chamados pela tarefa /tarefas/gerar-preventivas.';

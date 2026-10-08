-- Distribuição automática de chamados rotineiros.
--
-- RF04/RF05 fazem todo chamado corretivo passar pela triagem do gestor antes
-- de ter técnico. A análise do projeto apontou o gargalo: numa instituição
-- com muitos chamados simples por dia (lâmpada, tomada, torneira pingando), o
-- gestor vira o ponto por onde tudo espera, e a lâmpada fica queimada até ele
-- abrir a fila.
--
-- A regra diz, para uma categoria (e, se quiser, só numa unidade ou num bloco),
-- para qual equipe o chamado vai e com que prioridade. Dentro da equipe, vai
-- para o técnico de plantão, se houver, ou para quem tem menos chamados em
-- aberto. Nenhuma regra existe por padrão: a distribuição só vale para o que
-- a gestão decidir ligar, e o resto continua na triagem como sempre.

CREATE TABLE regra_distribuicao (
  id             SERIAL PRIMARY KEY,
  categoria_id   INTEGER NOT NULL REFERENCES categoria(id),
  -- Alcance: as duas nulas valem para a instituição toda; só a unidade, para
  -- um prédio; unidade e bloco, para um bloco dele. Texto, e não o id de um
  -- local, porque "Bloco A" é um conjunto de locais — uma regra por sala
  -- seria cadastro sem fim. Comparadas como a chave natural do local (014):
  -- sem caixa e sem espaço nas pontas.
  unidade        VARCHAR(150),
  bloco          VARCHAR(100),
  equipe_id      INTEGER NOT NULL REFERENCES equipe(id),
  -- Técnico de plantão: recebe tudo o que a regra distribui enquanto estiver
  -- ativo e na equipe. Sem ele, a equipe divide por carga.
  tecnico_id     INTEGER REFERENCES usuario(id),
  prioridade     prioridade_chamado NOT NULL DEFAULT 'baixa',
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  criado_por     INTEGER NOT NULL REFERENCES usuario(id),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Bloco sem unidade não diz onde fica: "Bloco A" existe em mais de um prédio.
  CHECK (bloco IS NULL OR unidade IS NOT NULL),
  CHECK (unidade IS NULL OR btrim(unidade) <> ''),
  CHECK (bloco IS NULL OR btrim(bloco) <> '')
);

-- Duas regras ativas com o mesmo alcance para a mesma categoria deixariam a
-- escolha ao acaso da ordem física da tabela. Desligadas não contam: são o
-- registro do que valeu antes, e os chamados que elas distribuíram continuam
-- apontando para elas.
CREATE UNIQUE INDEX idx_regra_distribuicao_alcance
    ON regra_distribuicao (
      categoria_id,
      lower(btrim(coalesce(unidade, ''))),
      lower(btrim(coalesce(bloco, '')))
    )
 WHERE ativo;

CREATE TRIGGER trg_regra_distribuicao_atualizado_em
BEFORE UPDATE ON regra_distribuicao
FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- Qual regra distribuiu o chamado, como regra_priorizacao_id guarda qual
-- regra sugeriu a prioridade: sem isso, depois de a regra mudar, ninguém
-- explicaria por que aquele chamado foi parar naquela equipe.
ALTER TABLE chamado
  ADD COLUMN regra_distribuicao_id INTEGER REFERENCES regra_distribuicao(id);

-- ============================================================
-- Sistema de Manutenção Predial — Schema PostgreSQL
-- Fonte: Casos_de_Uso_e_Modelo_de_Dados.docx (dicionário de dados)
-- Baseado em RF01–RF11, RNF01–RNF06, RN01–RN10 (Termo de Abertura)
-- ============================================================

CREATE TYPE perfil_usuario AS ENUM ('solicitante', 'tecnico', 'gestor', 'administrador');
CREATE TYPE tipo_anexo AS ENUM ('foto', 'documento');
CREATE TYPE prioridade_chamado AS ENUM ('baixa', 'media', 'alta', 'critica');
CREATE TYPE estado_chamado AS ENUM (
  'aberto', 'em_triagem', 'atribuido', 'em_andamento',
  'aguardando_material', 'concluido', 'cancelado'
);
CREATE TYPE tipo_notificacao AS ENUM ('atribuicao', 'mudanca_estado', 'atraso', 'comentario', 'conclusao');

CREATE TABLE usuario (
  id             SERIAL PRIMARY KEY,
  nome           VARCHAR(150) NOT NULL,
  email          VARCHAR(150) NOT NULL UNIQUE,
  senha_hash     TEXT NOT NULL,
  perfil         perfil_usuario NOT NULL,
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE local (
  id         SERIAL PRIMARY KEY,
  unidade    VARCHAR(150) NOT NULL,
  bloco      VARCHAR(100),
  pavimento  VARCHAR(100),
  setor      VARCHAR(100),
  ambiente   VARCHAR(150),
  ativo      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE categoria (
  id    SERIAL PRIMARY KEY,
  nome  VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE equipe (
  id    SERIAL PRIMARY KEY,
  nome  VARCHAR(100) NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE equipe_tecnico (
  equipe_id   INTEGER NOT NULL REFERENCES equipe(id),
  usuario_id  INTEGER NOT NULL REFERENCES usuario(id),
  PRIMARY KEY (equipe_id, usuario_id)
);

CREATE TABLE chamado (
  id                          SERIAL PRIMARY KEY,
  protocolo                   VARCHAR(30) NOT NULL UNIQUE,
  titulo                      VARCHAR(200) NOT NULL,
  descricao                   TEXT NOT NULL,
  categoria_id                INTEGER NOT NULL REFERENCES categoria(id),
  local_id                    INTEGER NOT NULL REFERENCES local(id),
  solicitante_id              INTEGER NOT NULL REFERENCES usuario(id),
  tecnico_id                  INTEGER REFERENCES usuario(id),
  equipe_id                   INTEGER REFERENCES equipe(id),
  prioridade                  prioridade_chamado NOT NULL DEFAULT 'baixa',
  estado                      estado_chamado NOT NULL DEFAULT 'aberto',
  data_abertura               TIMESTAMPTZ NOT NULL DEFAULT now(),
  prazo_estimado               TIMESTAMPTZ,
  data_conclusao               TIMESTAMPTZ,
  aguardando_material_desde   TIMESTAMPTZ,
  tempo_suspenso_total        INTERVAL NOT NULL DEFAULT '0 seconds',
  criado_em                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chamado_estado ON chamado(estado);
CREATE INDEX idx_chamado_solicitante ON chamado(solicitante_id);
CREATE INDEX idx_chamado_tecnico ON chamado(tecnico_id);
CREATE INDEX idx_chamado_categoria ON chamado(categoria_id);
CREATE INDEX idx_chamado_local ON chamado(local_id);

CREATE TABLE anexo (
  id               SERIAL PRIMARY KEY,
  chamado_id       INTEGER NOT NULL REFERENCES chamado(id),
  usuario_id       INTEGER NOT NULL REFERENCES usuario(id),
  tipo             tipo_anexo NOT NULL,
  caminho_arquivo  TEXT NOT NULL,
  data_upload      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_anexo_chamado ON anexo(chamado_id);

CREATE TABLE historico_chamado (
  id               SERIAL PRIMARY KEY,
  chamado_id       INTEGER NOT NULL REFERENCES chamado(id),
  usuario_id       INTEGER NOT NULL REFERENCES usuario(id),
  estado_anterior  VARCHAR(30),
  estado_novo      VARCHAR(30) NOT NULL,
  observacao       TEXT,
  data             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_historico_chamado ON historico_chamado(chamado_id);

CREATE TABLE material (
  id              SERIAL PRIMARY KEY,
  nome            VARCHAR(150) NOT NULL,
  unidade_medida  VARCHAR(30) NOT NULL
);

CREATE TABLE chamado_material (
  chamado_id  INTEGER NOT NULL REFERENCES chamado(id),
  material_id INTEGER NOT NULL REFERENCES material(id),
  quantidade  NUMERIC(10,2) NOT NULL,
  PRIMARY KEY (chamado_id, material_id)
);

CREATE TABLE avaliacao (
  id          SERIAL PRIMARY KEY,
  chamado_id  INTEGER NOT NULL UNIQUE REFERENCES chamado(id),
  nota        SMALLINT NOT NULL CHECK (nota BETWEEN 1 AND 5),
  comentario  TEXT,
  data        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notificacao (
  id          SERIAL PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuario(id),
  chamado_id  INTEGER NOT NULL REFERENCES chamado(id),
  tipo        tipo_notificacao NOT NULL,
  mensagem    TEXT NOT NULL,
  lida        BOOLEAN NOT NULL DEFAULT FALSE,
  data        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notificacao_usuario ON notificacao(usuario_id, lida);

CREATE OR REPLACE FUNCTION set_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chamado_atualizado_em
BEFORE UPDATE ON chamado
FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

INSERT INTO categoria (nome) VALUES
  ('elétrica'), ('hidráulica'), ('climatização'),
  ('estrutura'), ('pintura'), ('mobiliário'), ('outra');

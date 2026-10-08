-- Autocadastro sob aprovação (RF01).
--
-- O Termo de Abertura prevê que o solicitante se cadastre sozinho, mas sob
-- aprovação. O sistema criava a conta já ativa: qualquer pessoa com o link
-- entrava e abria chamados em nome da instituição. A análise do projeto
-- apontou o risco; a saída sem depender de domínio de e-mail institucional é
-- a que o próprio Termo descreve — o cadastro fica esperando a gestão.

-- Configurações que a administração liga e desliga pela tela. Chave e valor,
-- e não uma coluna por opção: a próxima (o domínio de e-mail permitido, por
-- exemplo) entra como linha, sem migração.
CREATE TABLE configuracao (
  chave          VARCHAR(60) PRIMARY KEY,
  valor          JSONB NOT NULL,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por INTEGER REFERENCES usuario(id)
);

-- Desligada ao migrar: ligar muda quem consegue entrar, e isso é decisão de
-- quem administra a instalação, tomada na tela de Usuários — não efeito
-- colateral de um deploy.
INSERT INTO configuracao (chave, valor) VALUES ('cadastro_exige_aprovacao', 'false');

-- Conta pendente é conta inativa com data de pedido. Inativa porque todo o
-- sistema já trata "inativo" como "não entra, não recebe, não aparece": login,
-- recuperação de senha, listas de usuários, avisos. Um estado novo exigiria
-- ensinar cada um desses lugares; reaproveitar o que já existe não deixa
-- nenhum esquecido. A data separa o pedido da conta desligada por alguém.
ALTER TABLE usuario
  ADD COLUMN cadastro_pendente_desde TIMESTAMPTZ,
  ADD CONSTRAINT usuario_pendente_inativo CHECK (cadastro_pendente_desde IS NULL OR NOT ativo);

CREATE INDEX idx_usuario_pendente ON usuario (cadastro_pendente_desde)
 WHERE cadastro_pendente_desde IS NOT NULL;

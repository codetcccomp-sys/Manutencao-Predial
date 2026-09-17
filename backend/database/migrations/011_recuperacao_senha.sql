-- Recuperação de senha (RF01).
--
-- Sem isso, esquecer a senha significava perder a conta: só um administrador
-- contornava, e se quem esquecesse fosse o próprio administrador, restava
-- acesso direto ao banco.

CREATE TABLE recuperacao_senha (
  id          SERIAL PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuario(id),
  -- Guarda o hash, nunca o token. Quem lesse a tabela — backup, dump, log de
  -- consulta — poderia redefinir a senha de qualquer pessoa se o valor
  -- estivesse em claro. O token só existe no e-mail do destinatário.
  token_hash  TEXT NOT NULL UNIQUE,
  expira_em   TIMESTAMPTZ NOT NULL,
  usado_em    TIMESTAMPTZ,
  ip          TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expira_em > criado_em)
);

-- Busca pelo hash na validação, e varredura por usuário ao invalidar os
-- pedidos pendentes depois de uma redefinição bem-sucedida.
CREATE INDEX idx_recuperacao_usuario ON recuperacao_senha (usuario_id) WHERE usado_em IS NULL;

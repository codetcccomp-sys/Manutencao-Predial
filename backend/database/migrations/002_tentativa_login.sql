-- Rate limiting de login.
--
-- O contador vive no banco, e não em memória do processo, porque a API roda
-- em funções serverless: cada instância tem a própria memória, instâncias
-- nascem e morrem a cada requisição e várias atendem em paralelo. Um contador
-- em memória seria zerado justamente sob o volume que ele deveria conter.

CREATE TABLE tentativa_login (
  id       SERIAL PRIMARY KEY,
  email    VARCHAR(150) NOT NULL,
  ip       TEXT NOT NULL,
  sucesso  BOOLEAN NOT NULL,
  data     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- As duas contagens da janela: por e-mail (não falsificável pelo cliente) e
-- por IP (defesa secundária, contra varredura de muitos e-mails da mesma origem).
CREATE INDEX idx_tentativa_login_email ON tentativa_login (email, data DESC) WHERE NOT sucesso;
CREATE INDEX idx_tentativa_login_ip ON tentativa_login (ip, data DESC) WHERE NOT sucesso;

-- Usado pela limpeza periódica das tentativas antigas.
CREATE INDEX idx_tentativa_login_data ON tentativa_login (data);

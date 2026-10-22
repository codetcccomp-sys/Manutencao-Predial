-- Os erros de servidor (5xx), guardados.
--
-- Hoje um erro só existe no console da função serverless. Na Vercel Hobby os
-- logs de execução duram 1 hora: um erro das 2h da manhã já não existe às 9h,
-- e quem abre o painel de manhã não tem o que investigar. Gravar no banco dá
-- ao administrador uma lista que sobrevive à noite.
--
-- Não guarda pessoa: nem usuário, nem IP, nem corpo da requisição, nem a query
-- string. O caminho, o código e a mensagem (com e-mails mascarados) bastam
-- para achar o defeito. A retenção é de 30 dias, como a do registro das
-- tarefas agendadas (019): mais que isso é tabela crescendo sem ninguém ler.
CREATE TABLE erro_aplicacao (
  id           BIGSERIAL PRIMARY KEY,
  ocorrido_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  metodo       TEXT        NOT NULL,
  rota         TEXT        NOT NULL,
  status       INTEGER     NOT NULL,
  codigo       TEXT,
  mensagem     TEXT        NOT NULL,
  -- Só as linhas "at ..." do stack: a primeira linha repete a mensagem, que
  -- já passou pela máscara de e-mail, e não deve voltar sem ela.
  pilha        TEXT
);

CREATE INDEX idx_erro_aplicacao_recentes ON erro_aplicacao (ocorrido_em DESC);

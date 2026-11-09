-- ATENÇÃO — JÁ RODOU EM PRODUÇÃO, EM 12/10/2026. NÃO RODE DE NOVO LÁ.
--
-- Este script apaga TODOS os chamados. Desde 12/10/2026 os chamados da produção
-- são reais, e rodá-lo outra vez os apagaria junto com a demonstração que ele
-- existia para tirar. Ele continua aqui como registro do que foi feito e para
-- limpar um banco de demonstração ou de homologação. Antes de rodar em qualquer
-- banco, confira em qual está conectado.
--
-- Limpeza dos dados de demonstração, antes do piloto (docs/piloto.md, §2.0).
--
-- Apaga todos os chamados, com histórico, comentários, anexos, avaliações,
-- materiais usados e avisos, e as contas que não ficam. Ficam as contas de
-- administrador e as listadas em `limpeza.manter`. O resto do cadastro fica
-- como está: locais, equipamentos, planos preventivos, equipes, categorias,
-- materiais, feriados, expediente, prazos e regras.
--
-- Este arquivo não abre nem fecha transação: quem roda decide, e a ordem é
-- sempre ensaiar antes. Depois de conferir que o backup do dia rodou:
--
--   BEGIN;
--   SET LOCAL limpeza.manter = 'pessoa@instituicao.br, outra@instituicao.br';
--   -- o conteúdo deste arquivo
--   ROLLBACK;  -- o resumo do fim diz o que sairia; depois, o mesmo com COMMIT
--
-- Com `SET LOCAL limpeza.manter = 'so-administradores'`, ficam só eles. Vazio
-- não serve para isso: numa conexão reaproveitada (o editor do Supabase, o
-- pooler), a variável que alguém já usou volta vazia em vez de não definida,
-- e "vazio" não pode querer dizer "apague todo mundo".
--
-- Nenhuma chave estrangeira do esquema apaga em cascata. Se uma tabela nova
-- passar a apontar para `usuario` ou `chamado` e não for tratada aqui, a
-- limpeza falha inteira em vez de levar junto o que não devia; o teste
-- (tests/limparDemonstracao.test.js) acusa a tabela antes disso.

-- 1. Trava das tabelas, antes de qualquer conferência: o que se confere vale
-- até o fim, porque ninguém muda nada no meio.
-- Ninguém escreve nessas tabelas até o COMMIT (ou ROLLBACK); ler continua
-- valendo. Sem isto, um chamado aberto no meio da limpeza aparecia entre um
-- DELETE e outro e derrubava a transação, ou sobrava depois dela. A ordem
-- começa pelo chamado, que é por onde as escritas do sistema começam.
-- A espera pela trava tem limite (15 s, ou o valor de limpeza.espera): se uma
-- escrita longa a estiver segurando, a limpeza desiste sem apagar nada, em vez
-- de deixar na fila quem usa o sistema. É só rodar de novo.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', coalesce(nullif(current_setting('limpeza.espera', true), ''), '15s'), true);
END $$;
LOCK TABLE chamado, historico_chamado, comentario, anexo, avaliacao, chamado_material, notificacao,
           usuario, equipe_tecnico, plano_preventivo, regra_distribuicao, configuracao, sla_versao,
           recuperacao_senha, codigo_recuperacao_2fa, tentativa_login, tentativa_recuperacao
  IN EXCLUSIVE MODE;

-- 2. Travas de segurança: lista declarada, e-mails que existem, alguém para administrar.
DO $$
DECLARE
  lista text := btrim(coalesce(current_setting('limpeza.manter', true), ''));
  faltando text;
BEGIN
  IF lista = '' THEN
    RAISE EXCEPTION 'Diga antes quais contas ficam: SET LOCAL limpeza.manter = ''a@x.br, b@y.br'' (ou ''so-administradores'').';
  END IF;

  -- Um e-mail digitado errado apagaria a conta que deveria ficar.
  SELECT string_agg(e, ', ') INTO faltando
    FROM unnest(string_to_array(lower(replace(lista, ' ', '')), ',')) AS e
   WHERE e NOT IN ('', 'so-administradores') AND NOT EXISTS (SELECT 1 FROM usuario u WHERE u.email = e);
  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION 'Sem conta com este e-mail, confira a lista: %', faltando;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM usuario WHERE perfil = 'administrador' AND ativo AND anonimizado_em IS NULL) THEN
    RAISE EXCEPTION 'Nenhum administrador ativo: depois da limpeza ninguém conseguiria administrar o sistema.';
  END IF;

  -- Apagar a linha não apaga o arquivo do Storage: a foto ficaria guardada
  -- sem chamado nenhum, fora da regra de retenção.
  IF EXISTS (SELECT 1 FROM anexo WHERE armazenamento <> 'banco') THEN
    RAISE EXCEPTION 'Há anexos no Supabase Storage. Apague os arquivos do repositório antes; esta limpeza só cuida do banco.';
  END IF;
END $$;

-- 3. Quem fica, e a contagem de antes para o resumo.
DROP TABLE IF EXISTS pg_temp.limpeza_contas;
CREATE TEMP TABLE limpeza_contas AS
SELECT u.id, u.email, u.perfil,
       u.perfil = 'administrador'
         OR u.email = ANY (string_to_array(lower(replace(current_setting('limpeza.manter'), ' ', '')), ','))
         AS fica
  FROM usuario u;

-- O que era de quem sai (autoria de plano e de regra) passa ao administrador
-- mais antigo que fica.
DROP TABLE IF EXISTS pg_temp.limpeza_herdeiro;
CREATE TEMP TABLE limpeza_herdeiro AS
SELECT min(u.id) AS id
  FROM usuario u
 WHERE u.perfil = 'administrador' AND u.ativo AND u.anonimizado_em IS NULL;

CREATE OR REPLACE FUNCTION pg_temp.limpeza_contagem()
RETURNS TABLE (item text, total bigint) LANGUAGE sql AS $$
  SELECT 'usuario', count(*) FROM usuario
  UNION ALL SELECT 'chamado', count(*) FROM chamado
  UNION ALL SELECT 'historico_chamado', count(*) FROM historico_chamado
  UNION ALL SELECT 'comentario', count(*) FROM comentario
  UNION ALL SELECT 'anexo', count(*) FROM anexo
  UNION ALL SELECT 'notificacao', count(*) FROM notificacao
  UNION ALL SELECT 'local', count(*) FROM local
  UNION ALL SELECT 'equipamento', count(*) FROM equipamento
  UNION ALL SELECT 'plano_preventivo', count(*) FROM plano_preventivo
  UNION ALL SELECT 'equipe', count(*) FROM equipe
  UNION ALL SELECT 'feriado', count(*) FROM feriado
$$;

DROP TABLE IF EXISTS pg_temp.limpeza_antes;
CREATE TEMP TABLE limpeza_antes AS SELECT * FROM pg_temp.limpeza_contagem();

-- 4. A preventiva aberta que sai volta para a fila do plano. Sem isto, o
-- plano que já tinha gerado a execução de novembro pularia para dezembro, e a
-- de novembro não aconteceria no piloto. Volta para a mais antiga em aberto;
-- o agendador gera de novo quando a janela dela chegar (ou já, se passou).
UPDATE plano_preventivo p
   SET proxima_execucao = aberta.primeira
  FROM (SELECT plano_id, min(data_prevista) AS primeira
          FROM chamado
         WHERE plano_id IS NOT NULL AND estado NOT IN ('concluido', 'cancelado')
         GROUP BY plano_id) AS aberta
 WHERE p.id = aberta.plano_id AND aberta.primeira < p.proxima_execucao;

-- 5. Os chamados, e tudo o que pendura neles.
DELETE FROM anexo;
DELETE FROM historico_chamado;
DELETE FROM comentario;
DELETE FROM avaliacao;
DELETE FROM chamado_material;
DELETE FROM notificacao;
DELETE FROM chamado;

-- 6. As contas que saem, depois de soltar o que ainda aponta para elas.
DELETE FROM equipe_tecnico WHERE usuario_id IN (SELECT id FROM limpeza_contas WHERE NOT fica);

-- Plano e regra seguem valendo sem o técnico: o plano gera o chamado para a
-- triagem, e a regra divide pela equipe.
UPDATE plano_preventivo SET tecnico_id = NULL
 WHERE tecnico_id IN (SELECT id FROM limpeza_contas WHERE NOT fica);
UPDATE plano_preventivo SET criado_por = (SELECT id FROM limpeza_herdeiro)
 WHERE criado_por IN (SELECT id FROM limpeza_contas WHERE NOT fica);
UPDATE regra_distribuicao SET tecnico_id = NULL
 WHERE tecnico_id IN (SELECT id FROM limpeza_contas WHERE NOT fica);
UPDATE regra_distribuicao SET criado_por = (SELECT id FROM limpeza_herdeiro)
 WHERE criado_por IN (SELECT id FROM limpeza_contas WHERE NOT fica);
UPDATE configuracao SET atualizado_por = NULL
 WHERE atualizado_por IN (SELECT id FROM limpeza_contas WHERE NOT fica);
-- A versão do SLA é configuração e fica; só perde o nome de quem a gravou (032).
UPDATE sla_versao SET alterado_por = NULL
 WHERE alterado_por IN (SELECT id FROM limpeza_contas WHERE NOT fica);

DELETE FROM recuperacao_senha WHERE usuario_id IN (SELECT id FROM limpeza_contas WHERE NOT fica);
DELETE FROM codigo_recuperacao_2fa WHERE usuario_id IN (SELECT id FROM limpeza_contas WHERE NOT fica);
DELETE FROM usuario WHERE id IN (SELECT id FROM limpeza_contas WHERE NOT fica);

-- Os contadores do limite de tentativas guardam e-mail e IP de quem tentou
-- entrar; recomeçam zerados, como o resto.
DELETE FROM tentativa_login;
DELETE FROM tentativa_recuperacao;

-- 7. O resumo: quanto havia, quanto ficou, e quem ficou.
SELECT item, antes, depois
  FROM (SELECT 1 AS ordem, a.item, a.total AS antes, d.total AS depois
          FROM limpeza_antes a
          JOIN pg_temp.limpeza_contagem() d USING (item)
        UNION ALL
        SELECT 2, 'fica: ' || c.email || ' (' || c.perfil || ')', NULL, NULL
          FROM limpeza_contas c
         WHERE c.fica) AS resumo
 ORDER BY ordem, item;

-- Espalha no tempo os chamados do banco DESCARTÁVEL de vídeo, com prazos e histórico
-- coerentes com o estado de cada um (um atribuído de dias atrás já aparece atrasado).
--
-- A semente pelo semear.mjs cria tudo "agora", e a API não deixa escolher a data de
-- abertura: sem este passo o gráfico de chamados por dia seria um pico num único dia.
-- Rodado por rodar.sh, só contra o banco smp_video, e pelo workflow "Demonstração publicada"
-- (.github/workflows/demonstracao.yml), contra o banco da demonstração, depois da trava
-- backend/database/guarda-demonstracao.js. Nunca contra um banco com chamados de verdade:
-- ele reescreve a data de todo chamado corretivo.
SELECT setseed(0.42);

CREATE TEMP TABLE alvo AS
SELECT c.id,
       now() - CASE
         WHEN c.estado = 'concluido'                   THEN interval '1 day'  * (4 + random() * 10)
         WHEN c.estado IN ('em_andamento','atribuido') THEN interval '1 day'  * (1 + random() * 5)
         WHEN c.estado = 'em_triagem'                  THEN interval '1 hour' * (6 + random() * 40)
         WHEN c.estado = 'cancelado'                   THEN interval '1 day'  * (2 + random() * 6)
         ELSE                                               interval '1 hour' * (1 + random() * 20)
       END AS abertura,
       6 + random() * 54 AS horas_ate_concluir
  FROM chamado c
 -- A preventiva já nasce com a data e o prazo do plano (fim do dia previsto).
 WHERE c.origem = 'corretiva';

UPDATE chamado c SET
  data_abertura   = a.abertura,
  criado_em       = a.abertura,
  priorizado_em   = CASE WHEN c.priorizado_em  IS NOT NULL THEN a.abertura + interval '1 hour'  END,
  inicio_execucao = CASE WHEN c.inicio_execucao IS NOT NULL THEN a.abertura + interval '3 hours' END,
  data_conclusao  = CASE WHEN c.data_conclusao IS NOT NULL
                         THEN a.abertura + interval '1 hour' * a.horas_ate_concluir END,
  -- A confirmação de EPI é feita na hora de concluir: acompanha a conclusão, e
  -- não fica com a data da semeadura (o que apareceria na tela como EPI
  -- confirmado depois de o chamado já estar encerrado).
  epi_confirmado_em = CASE WHEN c.epi_confirmado_em IS NOT NULL
                           THEN a.abertura + interval '1 hour' * a.horas_ate_concluir END
  FROM alvo a WHERE a.id = c.id;

UPDATE chamado c SET
  prazo_estimado = c.data_abertura + s.prazo_horas * interval '1 hour' + c.tempo_suspenso_total,
  atualizado_em  = COALESCE(c.data_conclusao, c.inicio_execucao, c.priorizado_em, c.data_abertura)
  FROM sla s WHERE s.prioridade = c.prioridade AND c.origem = 'corretiva';

UPDATE historico_chamado h SET data = CASE h.estado_novo
    WHEN 'aberto'       THEN c.data_abertura
    WHEN 'em_triagem'   THEN c.data_abertura + interval '40 minutes'
    WHEN 'atribuido'    THEN c.data_abertura + interval '2 hours'
    WHEN 'em_andamento' THEN c.data_abertura + interval '3 hours'
    WHEN 'concluido'    THEN c.data_conclusao
    WHEN 'cancelado'    THEN c.data_abertura + interval '5 hours'
    ELSE c.data_abertura + interval '1 hour' END
  FROM chamado c WHERE c.id = h.chamado_id;

UPDATE notificacao SET data = now() - interval '1 hour' * (1 + random() * 20);

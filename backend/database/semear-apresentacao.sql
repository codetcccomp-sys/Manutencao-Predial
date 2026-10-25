-- Dados FICTÍCIOS para a apresentação, no banco da produção (docs/apresentacao-na-producao.md).
--
-- Antes de o sistema ter uso real, a produção serve de demonstração: 35 chamados espalhados
-- pelas últimas semanas, em todos os estados, com histórico, comentários, avaliações e avisos.
-- Quando o uso real começar, `remover-apresentacao.sql` tira tudo isto (e só isto).
--
-- O que este script faz e o que ele NÃO faz:
--  * Só roda se NÃO houver chamado real. Um chamado que não seja de apresentação (protocolo sem
--    `-DEMO`) derruba o script antes de gravar qualquer coisa: o piloto não é lugar de dado inventado.
--  * Todas as contas fictícias nascem INATIVAS e com senha que ninguém conhece (o hash é de um
--    valor aleatório descartado), no domínio reservado `.invalid`. Ninguém consegue entrar por
--    elas, nenhum aviso sai por e-mail para elas e elas não aparecem para atribuição. A
--    apresentação usa as contas reais; as fictícias só aparecem como autoras e responsáveis.
--  * As contas reais de técnico e de solicitante (a mais antiga de cada perfil) entram na
--    história como responsável e como solicitante, para a fila e o "meus pedidos" delas terem o
--    que mostrar. Se não existirem, as fictícias ocupam o lugar.
--  * Nada daqui manda e-mail: os avisos já nascem com `email_enviado_em`, e o atraso e o crítico
--    sem atendimento já nascem avisados. A tarefa de 15 minutos não encontra nada para avisar.
--  * Não mexe no cadastro (locais, categorias, planos, regras): usa o que existe e só acrescenta
--    um local se faltar (banco de teste).
--
-- Não abre nem fecha transação: quem roda decide. Ensaie antes:
--   BEGIN; -- o conteúdo deste arquivo ; ROLLBACK;   (o resumo do fim diz o que entraria)
-- e só então repita com COMMIT. Para refazer com datas de hoje, rode antes
-- `remover-apresentacao.sql`.

-- 1. Travas: nenhum chamado real, nada fictício de uma rodada anterior, regra de priorização.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM chamado WHERE protocolo NOT LIKE 'SMP-%-DEMO%') THEN
    RAISE EXCEPTION 'Há chamado que não é de apresentação. Dado fictício não entra onde há uso real.';
  END IF;
  IF EXISTS (SELECT 1 FROM chamado WHERE protocolo LIKE 'SMP-%-DEMO%')
     OR EXISTS (SELECT 1 FROM usuario WHERE email LIKE '%@conserva.invalid') THEN
    RAISE EXCEPTION 'A apresentação já está semeada. Rode remover-apresentacao.sql antes, para refazer com datas de hoje.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM regra_priorizacao WHERE vigencia_fim IS NULL) THEN
    RAISE EXCEPTION 'Não há regra de priorização vigente.';
  END IF;
END $$;

DROP TABLE IF EXISTS pg_temp.pessoa, pg_temp.alvo_local, pg_temp.def, pg_temp.base, pg_temp.evento;

-- 2. As pessoas. A senha é o hash de um valor aleatório que não foi guardado em lugar nenhum.
CREATE TEMP TABLE pessoa (chave text PRIMARY KEY, id integer NOT NULL);

WITH reais AS (
  SELECT (SELECT min(id) FROM usuario WHERE perfil = 'tecnico' AND ativo AND email NOT LIKE '%@conserva.invalid') AS tecnico,
         (SELECT min(id) FROM usuario WHERE perfil = 'solicitante' AND ativo AND email NOT LIKE '%@conserva.invalid') AS solicitante
), quem(chave, nome, email, perfil, so_sem_real) AS (
  VALUES ('gestor', 'Ana Ribeiro',    'ana.ribeiro@conserva.invalid',    'gestor',      false),
         ('t1',     'Paulo Tavares',  'paulo.tavares@conserva.invalid',  'tecnico',     false),
         ('t2',     'Carlos Menezes', 'carlos.menezes@conserva.invalid', 'tecnico',     false),
         ('t3',     'Rita Alencar',   'rita.alencar@conserva.invalid',   'tecnico',     true),
         ('s1',     'Jorge Pacheco',  'jorge.pacheco@conserva.invalid',  'solicitante', false),
         ('s2',     'Marta Coelho',   'marta.coelho@conserva.invalid',   'solicitante', false),
         ('s3',     'Lúcia Fontes',   'lucia.fontes@conserva.invalid',   'solicitante', false),
         ('s4',     'Sérgio Vasques', 'sergio.vasques@conserva.invalid', 'solicitante', true)
), novos AS (
  INSERT INTO usuario (nome, email, senha_hash, perfil, ativo)
  SELECT q.nome, q.email, '$2b$12$aXVbI02.Nli2a.m62ILPKelhT8BhJKQo075nRzDewQiPv/8XdIcjy', q.perfil::perfil_usuario, false
    FROM quem q, reais r
   WHERE NOT q.so_sem_real
      OR (q.chave = 't3' AND r.tecnico IS NULL)
      OR (q.chave = 's4' AND r.solicitante IS NULL)
  RETURNING id, email
)
INSERT INTO pessoa (chave, id)
SELECT q.chave, n.id FROM quem q JOIN novos n USING (email)
UNION ALL SELECT 't3', r.tecnico FROM reais r WHERE r.tecnico IS NOT NULL
UNION ALL SELECT 's4', r.solicitante FROM reais r WHERE r.solicitante IS NOT NULL;

-- 3. Os locais: os do cadastro de teste da Sede. Um que falte (banco de teste) é criado.
CREATE TEMP TABLE alvo_local (chave text PRIMARY KEY, setor text, ambiente text, bloco text, pavimento text, id integer);
INSERT INTO alvo_local (chave, setor, ambiente, bloco, pavimento) VALUES
  ('banh_m',   'Sanitários',     'Banheiro masculino',        'A', 'Térreo'),
  ('banh_f',   'Sanitários',     'Banheiro feminino',         'A', '1º andar'),
  ('corredor', 'Circulação',     'Corredor',                  'A', 'Térreo'),
  ('sala202',  'Ensino',         'Sala 202',                  'A', '2º andar'),
  ('lab_inf',  'Ensino',         'Laboratório de Informática','B', 'Térreo'),
  ('casa_maq', 'Áreas técnicas', 'Casa de máquinas',          'A', 'Cobertura'),
  ('recepcao', 'Administrativo', 'Recepção',                  'A', 'Térreo'),
  ('reunioes', 'Administrativo', 'Sala de Reuniões',          'A', 'Térreo'),
  ('quadro',   'Áreas técnicas', 'Quadro elétrico geral',     'A', 'Térreo'),
  ('auditorio','Ensino',         'Auditório',                 'B', '1º andar'),
  ('cantina',  'Convivência',    'Cantina',                   'A', 'Térreo'),
  ('estac',    'Externo',        'Estacionamento',            NULL, NULL),
  ('portao',   'Externo',        'Portão principal',          NULL, NULL),
  ('biblio',   'Ensino',         'Biblioteca',                'B', '1º andar'),
  ('escada',   'Circulação',     'Escada',                    'A', NULL),
  ('caixa',    'Áreas técnicas', 'Caixa d’água',              'A', 'Cobertura'),
  ('quadra',   'Convivência',    'Quadra poliesportiva',      'B', 'Térreo');

INSERT INTO local (unidade, bloco, pavimento, setor, ambiente)
SELECT 'Sede', a.bloco, a.pavimento, a.setor, a.ambiente
  FROM alvo_local a
 WHERE NOT EXISTS (
   SELECT 1 FROM local l
    WHERE l.unidade = 'Sede' AND l.ambiente = a.ambiente AND l.setor = a.setor
      AND l.bloco IS NOT DISTINCT FROM a.bloco AND l.pavimento IS NOT DISTINCT FROM a.pavimento);

UPDATE alvo_local a SET id = (
  SELECT min(l.id) FROM local l
   WHERE l.unidade = 'Sede' AND l.ambiente = a.ambiente AND l.setor = a.setor
     AND l.bloco IS NOT DISTINCT FROM a.bloco AND l.pavimento IS NOT DISTINCT FROM a.pavimento);

-- 4. Os chamados. (dias, hora): quando foi aberto, no relógio de Brasília. `dur`: horas até concluir.
-- Fatores (urgência, impacto, risco) são o que o solicitante respondeu na abertura; a prioridade
-- sai da regra vigente, e `forca` marca o único em que a gestão divergiu, com justificativa (RN05).
CREATE TEMP TABLE def (
  n int PRIMARY KEY, titulo text, descricao text, cat text, loc text, s text, t text, ate text,
  u int, i int, r int, dias int, hora numeric, dur numeric, nota int, forca prioridade_chamado
);
INSERT INTO def VALUES
 ( 1, 'Torneira vazando no banheiro masculino', 'A torneira da pia do meio pinga sem parar desde ontem e já molhou o piso.', 'hid', 'banh_m', 's1', 't1', 'concluido', 2,1,1, 19, 8.5, 20, 5, NULL),
 ( 2, 'Lâmpadas queimadas no corredor', 'Duas lâmpadas do corredor do térreo estão queimadas e o fim do corredor fica escuro.', 'ele', 'corredor', 's2', 't2', 'concluido', 1,2,2, 18, 9, 14, 5, NULL),
 ( 3, 'Ar-condicionado da sala 202 não refrigera', 'O aparelho liga mas sopra ar quente. Há aula marcada para a tarde.', 'cli', 'sala202', 's3', 't1', 'concluido', 3,2,1, 17, 7.5, 30, 4, NULL),
 ( 4, 'Computadores do laboratório sem rede', 'Os 12 computadores do laboratório perderam a conexão com a rede interna.', 'out', 'lab_inf', 's4', 't3', 'concluido', 3,3,1, 16, 8, 9, 5, NULL),
 ( 5, 'Barulho forte na bomba da casa de máquinas', 'Ruído metálico constante vindo da bomba principal, com vibração no piso.', 'hid', 'casa_maq', 's1', 't2', 'concluido', 3,3,3, 15, 10, 27, 3, NULL),
 ( 6, 'Porta da recepção não fecha direito', 'A porta de vidro arrasta no chão e a trava não encaixa.', 'est', 'recepcao', 's2', 't1', 'concluido', 2,2,2, 14, 8, 52, 4, NULL),
 ( 7, 'Vazamento no teto do corredor', 'Mancha de umidade crescendo no teto, com gotejamento nos dias de chuva.', 'hid', 'corredor', 's3', 't2', 'concluido', 3,2,2, 13, 14, 40, 5, NULL),
 ( 8, 'Tomada com mau contato na sala 202', 'A tomada junto à lousa solta faísca ao conectar o projetor.', 'ele', 'sala202', 's4', 't3', 'concluido', 3,2,4, 12, 8, 6, 4, NULL),
 ( 9, 'Descarga com defeito no banheiro feminino', 'A descarga do segundo box não aciona.', 'hid', 'banh_f', 's1', 't1', 'concluido', 2,1,1, 11, 9, 22, 5, NULL),
 (10, 'Projetor do auditório sem imagem', 'O projetor liga, mas não exibe imagem nenhuma.', 'out', 'auditorio', 's2', 't3', 'concluido', 2,1,1, 10, 10, 18, 5, NULL),
 (11, 'Piso solto na recepção', 'Três placas do piso estão soltas e já houve tropeço.', 'est', 'recepcao', 's3', 't2', 'concluido', 3,2,3, 9, 8, 36, 4, NULL),
 (12, 'Pintura descascando na biblioteca', 'A parede dos fundos está descascando perto das estantes.', 'pin', 'biblio', 's4', 't1', 'concluido', 1,1,1, 9, 15, 58, NULL, NULL),
 (13, 'Cadeiras quebradas na sala 202', 'Quatro cadeiras com o encosto solto.', 'mob', 'sala202', 's1', 't2', 'concluido', 2,1,1, 8, 9, 44, 4, NULL),
 (14, 'Disjuntor desarmando no quadro geral', 'O disjuntor da bomba desarma toda vez que a carga aumenta.', 'ele', 'quadro', 's2', 't3', 'concluido', 3,3,4, 7, 8, 7, 5, NULL),
 (15, 'Switch do laboratório reiniciando sozinho', 'O switch de rede reinicia a cada poucas horas e derruba as máquinas.', 'out', 'lab_inf', 's3', 't1', 'concluido', 3,3,2, 6, 9, 26, 5, NULL),
 (16, 'Bebedouro da cantina sem pressão', 'O jato do bebedouro está muito fraco.', 'hid', 'cantina', 's4', 't2', 'concluido', 1,2,1, 5, 11, 30, 4, NULL),
 (17, 'Janela da sala 202 emperrada', 'Não abre nem fecha, o vidro está solto na guia.', 'est', 'sala202', 's1', 't3', 'concluido', 2,1,2, 4, 9, 21, NULL, NULL),
 (18, 'Infiltração na laje da casa de máquinas', 'Mancha de umidade na laje, junto ao quadro elétrico.', 'est', 'casa_maq', 's2', 't2', 'em_andamento', 3,3,4, 3, 8, NULL, NULL, NULL),
 (19, 'Pia entupida no banheiro masculino', 'A água da pia desce muito devagar e volta cheirando mal.', 'hid', 'banh_m', 's3', 't1', 'em_andamento', 2,2,2, 2, 9, NULL, NULL, NULL),
 (20, 'Split da recepção pingando', 'O aparelho pinga água sobre o balcão de atendimento.', 'cli', 'recepcao', 's4', 't3', 'em_andamento', 2,2,1, 1, 10, NULL, NULL, NULL),
 (21, 'Câmera de segurança do estacionamento offline', 'A câmera parou de gravar e a imagem não aparece na portaria.', 'out', 'estac', 's1', 't3', 'em_andamento', 2,3,3, 2, 14, NULL, NULL, NULL),
 (22, 'Porta corta-fogo da escada travada', 'A porta não fecha sozinha, a mola soltou.', 'est', 'escada', 's2', 't2', 'em_andamento', 3,3,4, 1, 15, NULL, NULL, NULL),
 (23, 'Vazamento no registro da caixa d’água', 'O registro de saída pinga continuamente.', 'hid', 'caixa', 's3', 't1', 'aguardando_material', 3,3,2, 4, 9, NULL, NULL, NULL),
 (24, 'Mofo na parede da biblioteca', 'Mofo se espalhando na parede dos fundos.', 'pin', 'biblio', 's4', 't1', 'atribuido', 1,2,2, 1, 16, NULL, NULL, NULL),
 (25, 'Fechadura da sala de reuniões emperrada', 'A chave gira mas a fechadura não destrava.', 'est', 'reunioes', 's1', 't3', 'atribuido', 2,1,1, 2, 10, NULL, NULL, NULL),
 (26, 'Luminária de emergência da escada apagada', 'A luminária não acende no teste mensal.', 'ele', 'escada', 's2', 't2', 'atribuido', 3,3,4, 1, 11, NULL, NULL, NULL),
 (27, 'Rachadura na parede do corredor', 'Fissura vertical de um metro, apareceu depois da chuva forte.', 'est', 'corredor', 's3', 't1', 'atribuido', 2,2,2, 1, 13, NULL, NULL, 'alta'),
 (28, 'Impressora da recepção atolando', 'A impressora atola papel a cada duas folhas.', 'out', 'recepcao', 's4', NULL, 'em_triagem', 1,1,1, 1, 14, NULL, NULL, NULL),
 (29, 'Wi-fi fraco na biblioteca', 'No segundo andar o wi-fi cai a cada poucos minutos.', 'out', 'biblio', 's1', NULL, 'em_triagem', 2,2,1, 0, 8, NULL, NULL, NULL),
 (30, 'Tabela de basquete solta na quadra', 'A tabela balança e a fixação do aro está folgada.', 'est', 'quadra', 's2', NULL, 'em_triagem', 2,2,3, 0, 7.5, NULL, NULL, NULL),
 (31, 'Goteira na entrada do auditório', 'Pinga água do beiral na porta de entrada.', 'hid', 'auditorio', 's3', NULL, 'aberto', 3,2,2, 0, 9, NULL, NULL, NULL),
 (32, 'Mau cheiro no ralo do banheiro feminino', 'Cheiro de esgoto no banheiro do 1º andar.', 'hid', 'banh_f', 's4', NULL, 'aberto', 2,1,1, 0, 9.5, NULL, NULL, NULL),
 (33, 'Portão principal travando', 'O portão trava no meio do curso e não fecha por completo.', 'est', 'portao', 's1', NULL, 'aberto', 2,3,2, 0, 10, NULL, NULL, NULL),
 (34, 'Pedido duplicado de lâmpada', 'Aberto por engano, já existe outro chamado para o corredor.', 'ele', 'corredor', 's2', NULL, 'cancelado', 1,1,1, 6, 10, NULL, NULL, NULL),
 (35, 'Cortina da sala 202 caindo', 'O trilho da cortina soltou da parede.', 'mob', 'sala202', 's3', NULL, 'cancelado', 1,1,1, 3, 9, NULL, NULL, NULL);

-- 5. As datas e a prioridade de cada um. Hoje, o horário nunca passa de "agora menos duas horas".
CREATE TEMP TABLE base AS
SELECT d.*,
       LEAST(
         ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - d.dias * interval '1 day')
            + d.hora * interval '1 hour') AT TIME ZONE 'America/Sao_Paulo',
         now() - interval '2 hours') AS abertura,
       (SELECT id FROM regra_priorizacao WHERE vigencia_fim IS NULL) AS regra_id,
       CASE
         WHEN d.r >= g.risco_critico_minimo THEN 'critica'
         WHEN g.peso_urgencia * d.u + g.peso_impacto * d.i + g.peso_risco * d.r >= g.limiar_critica THEN 'critica'
         WHEN g.peso_urgencia * d.u + g.peso_impacto * d.i + g.peso_risco * d.r >= g.limiar_alta THEN 'alta'
         WHEN g.peso_urgencia * d.u + g.peso_impacto * d.i + g.peso_risco * d.r >= g.limiar_media THEN 'media'
         ELSE 'baixa'
       END::prioridade_chamado AS sugerida
  FROM def d, regra_priorizacao g
 WHERE g.vigencia_fim IS NULL;

-- 6. Os chamados.
INSERT INTO chamado (
  protocolo, titulo, descricao, categoria_id, local_id, solicitante_id, tecnico_id,
  prioridade, estado, data_abertura, criado_em, prazo_estimado,
  urgencia, impacto, risco, prioridade_sugerida, prioridade_justificativa, regra_priorizacao_id,
  priorizado_em, priorizado_por, diagnostico, inicio_execucao, servico_realizado, tempo_empregado_minutos,
  data_conclusao, aguardando_material_desde, epi_confirmado_em, epi_confirmado_por,
  atraso_notificado_para, critico_notificado_em, atualizado_em)
SELECT
  'SMP-' || to_char(b.abertura AT TIME ZONE 'America/Sao_Paulo', 'YYYYMMDD') || '-DEMO' || lpad(b.n::text, 2, '0'),
  b.titulo, b.descricao,
  COALESCE((SELECT id FROM categoria WHERE lower(nome) LIKE
              CASE b.cat WHEN 'hid' THEN 'hidr%' WHEN 'ele' THEN 'el_tric%' WHEN 'cli' THEN 'climat%'
                         WHEN 'est' THEN 'estrutur%' WHEN 'pin' THEN 'pintur%' WHEN 'mob' THEN 'mobili%' ELSE 'outr%' END
             ORDER BY id LIMIT 1),
           (SELECT min(id) FROM categoria)),
  (SELECT id FROM alvo_local WHERE chave = b.loc),
  (SELECT id FROM pessoa WHERE chave = b.s),
  (SELECT id FROM pessoa WHERE chave = b.t),
  COALESCE(b.forca, b.sugerida), b.ate::estado_chamado, b.abertura, b.abertura,
  prazo_sla(COALESCE(b.forca, b.sugerida), b.abertura, '0 seconds', '0 seconds', 'America/Sao_Paulo'),
  b.u, b.i, b.r, b.sugerida,
  CASE WHEN b.forca IS NOT NULL THEN 'Fissura apareceu depois da chuva forte, ao lado de uma sala de aula: tratar antes do previsto.' END,
  b.regra_id,
  CASE WHEN b.ate NOT IN ('aberto', 'em_triagem', 'cancelado') THEN b.abertura + interval '55 minutes' END,
  CASE WHEN b.ate NOT IN ('aberto', 'em_triagem', 'cancelado') THEN (SELECT id FROM pessoa WHERE chave = 'gestor') END,
  CASE WHEN b.ate IN ('em_andamento', 'aguardando_material', 'concluido') THEN 'Constatado no local; material separado e serviço iniciado.' END,
  CASE WHEN b.ate IN ('em_andamento', 'aguardando_material', 'concluido') THEN b.abertura + interval '3 hours' END,
  CASE WHEN b.ate = 'concluido' THEN
    (ARRAY['Troca do vedante e reaperto do registro; teste de vazamento sem ocorrência.',
           'Substituição por peça nova e teste de funcionamento no local.',
           'Limpeza, ajuste e recarga; equipamento voltou a operar normalmente.',
           'Reinício do equipamento e troca do cabo danificado; conexão restabelecida.',
           'Troca do componente defeituoso e alinhamento; sem ruído nem vibração.'])[1 + b.n % 5] END,
  CASE WHEN b.ate = 'concluido' THEN 40 + (b.n * 7) % 120 END,
  CASE WHEN b.ate = 'concluido' THEN LEAST(b.abertura + b.dur * interval '1 hour', now() - interval '1 hour') END,
  CASE WHEN b.ate = 'aguardando_material' THEN now() - interval '2 days' END,
  CASE WHEN b.ate = 'concluido' THEN LEAST(b.abertura + b.dur * interval '1 hour', now() - interval '1 hour') END,
  CASE WHEN b.ate = 'concluido' THEN (SELECT id FROM pessoa WHERE chave = b.t) END,
  -- O que a tarefa de 15 minutos procuraria: já consta como avisado, para ela não escrever a ninguém.
  prazo_sla(COALESCE(b.forca, b.sugerida), b.abertura, '0 seconds', '0 seconds', 'America/Sao_Paulo'),
  CASE WHEN COALESCE(b.forca, b.sugerida) = 'critica' THEN b.abertura + interval '20 minutes' END,
  now()
FROM base b
ORDER BY b.n;

-- 7. A linha do tempo de cada chamado.
CREATE TEMP TABLE evento AS
SELECT c.id AS chamado_id, b.n, b.ate, b.abertura, c.data_conclusao,
       (SELECT id FROM pessoa WHERE chave = b.s) AS solic,
       (SELECT id FROM pessoa WHERE chave = b.t) AS tecnico,
       (SELECT id FROM pessoa WHERE chave = 'gestor') AS gestor,
       c.protocolo, b.titulo
  FROM chamado c JOIN base b ON c.protocolo LIKE '%-DEMO' || lpad(b.n::text, 2, '0');

INSERT INTO historico_chamado (chamado_id, usuario_id, estado_anterior, estado_novo, observacao, data)
SELECT chamado_id, solic, NULL, 'aberto', 'Chamado aberto.', abertura FROM evento
UNION ALL
SELECT chamado_id, gestor, 'aberto', 'em_triagem', NULL, abertura + interval '40 minutes'
  FROM evento WHERE ate NOT IN ('aberto')
UNION ALL
SELECT chamado_id, gestor, 'em_triagem', 'atribuido', 'Chamado atribuído a técnico/equipe.', abertura + interval '2 hours'
  FROM evento WHERE ate IN ('atribuido', 'em_andamento', 'aguardando_material', 'concluido')
UNION ALL
SELECT chamado_id, tecnico, 'atribuido', 'em_andamento', NULL, abertura + interval '3 hours'
  FROM evento WHERE ate IN ('em_andamento', 'aguardando_material', 'concluido')
UNION ALL
SELECT chamado_id, tecnico, 'em_andamento', 'aguardando_material', 'Aguardando a vedação do registro.', now() - interval '2 days'
  FROM evento WHERE ate = 'aguardando_material'
UNION ALL
SELECT chamado_id, tecnico, 'em_andamento', 'concluido', 'Uso de EPI confirmado.', data_conclusao
  FROM evento WHERE ate = 'concluido'
UNION ALL
SELECT chamado_id, gestor, 'em_triagem', 'cancelado', 'Cancelado pela gestão.', abertura + interval '5 hours'
  FROM evento WHERE ate = 'cancelado';

-- 8. Conversa, avaliações e avisos.
INSERT INTO comentario (chamado_id, usuario_id, texto, data)
SELECT chamado_id, tecnico, 'Estive no local: confirmo o problema. Já separei o material e volto amanhã cedo.', abertura + interval '4 hours'
  FROM evento WHERE n IN (18, 19, 22)
UNION ALL
SELECT chamado_id, solic, 'Obrigado! Fica muito mais difícil usar o espaço assim, pode priorizar?', abertura + interval '6 hours'
  FROM evento WHERE n IN (18, 20)
UNION ALL
SELECT chamado_id, gestor, 'Material pedido ao almoxarifado; prazo de entrega informado para amanhã.', now() - interval '1 day 20 hours'
  FROM evento WHERE n = 23;

INSERT INTO avaliacao (chamado_id, nota, comentario, data)
SELECT e.chamado_id, b.nota,
       CASE b.nota WHEN 5 THEN 'Resolvido rápido, obrigado.' WHEN 3 THEN 'Resolveu, mas demorou mais do que o combinado.' END,
       e.data_conclusao + interval '3 hours'
  FROM evento e JOIN base b USING (n)
 WHERE b.nota IS NOT NULL AND e.data_conclusao + interval '3 hours' < now();

-- Todo aviso nasce já enviado: o e-mail só sai para o que está com `email_enviado_em` vazio e
-- passa por `notificacoes.despacharVarios`, que não é chamado aqui.
INSERT INTO notificacao (usuario_id, chamado_id, tipo, mensagem, lida, data, email_enviado_em)
SELECT tecnico, chamado_id, 'atribuicao'::tipo_notificacao, 'Você foi designado para o chamado ' || protocolo || '.',
       abertura + interval '2 hours' < now() - interval '3 days', abertura + interval '2 hours', abertura + interval '2 hours'
  FROM evento WHERE ate IN ('atribuido', 'em_andamento', 'aguardando_material', 'concluido')
UNION ALL
SELECT solic, chamado_id, 'conclusao', 'O chamado ' || protocolo || ' mudou de estado: em_andamento → concluido.',
       data_conclusao < now() - interval '3 days', data_conclusao, data_conclusao
  FROM evento WHERE ate = 'concluido'
UNION ALL
SELECT solic, chamado_id, 'mudanca_estado', 'O chamado ' || protocolo || ' mudou de estado: atribuido → em_andamento.',
       abertura + interval '3 hours' < now() - interval '3 days', abertura + interval '3 hours', abertura + interval '3 hours'
  FROM evento WHERE ate IN ('em_andamento', 'aguardando_material');

-- 9. O resumo: o que entrou.
SELECT 'chamados' AS item, count(*) AS total FROM chamado WHERE protocolo LIKE 'SMP-%-DEMO%'
UNION ALL SELECT 'contas fictícias (inativas)', count(*) FROM usuario WHERE email LIKE '%@conserva.invalid'
UNION ALL SELECT 'historico', count(*) FROM historico_chamado h JOIN chamado c ON c.id = h.chamado_id WHERE c.protocolo LIKE 'SMP-%-DEMO%'
UNION ALL SELECT 'avisos', count(*) FROM notificacao n JOIN chamado c ON c.id = n.chamado_id WHERE c.protocolo LIKE 'SMP-%-DEMO%'
UNION ALL SELECT 'estado ' || estado::text, count(*) FROM chamado WHERE protocolo LIKE 'SMP-%-DEMO%' GROUP BY estado
ORDER BY 1;

-- O aviso de "crítico sem atendimento" fora da tela (RF08).
--
-- Hoje o alerta de 15 minutos (config/atendimento.js) só existe como um cálculo da
-- consulta, desenhado numa faixa do aplicativo: um crítico aberto às 22h só é visto
-- quando alguém abrir o aplicativo. O agendador que já roda a cada 15 minutos passa a
-- procurar esses chamados e avisar a gestão por e-mail e no sino.
--
-- Uma vez por chamado: esta coluna é a reivindicação, como `atraso_notificado_para`
-- (migração 011) é a do aviso de atraso. Marcar antes de avisar custa, no pior caso,
-- um aviso perdido; avisar sem marcar custaria o mesmo e-mail a cada passagem, para
-- sempre, para quem está de plantão.
ALTER TABLE chamado ADD COLUMN critico_notificado_em TIMESTAMPTZ;

-- Fora de uma transação que já use o valor novo: ADD VALUE só vale depois do COMMIT, e
-- esta migração não o usa (como a 010, da reabertura).
ALTER TYPE tipo_notificacao ADD VALUE IF NOT EXISTS 'critico_sem_atendimento';

-- A varredura procura, a cada 15 minutos, os críticos corretivos ainda abertos e sem
-- aviso: um conjunto minúsculo no meio de uma tabela que cresce. O índice parcial o
-- alcança sem varrer a tabela, e some da escrita assim que o chamado é atendido.
CREATE INDEX idx_chamado_critico_sem_aviso ON chamado (data_abertura)
  WHERE prioridade = 'critica' AND origem = 'corretiva' AND estado = 'aberto'
    AND critico_notificado_em IS NULL;

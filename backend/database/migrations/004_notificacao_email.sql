-- Marca quando a notificação virou e-mail.
--
-- Sem isso não há como distinguir "não foi enviada" de "foi enviada e o
-- destinatário não viu", nem como reprocessar um lote que falhou quando o
-- SMTP estava fora do ar.

ALTER TABLE notificacao ADD COLUMN email_enviado_em TIMESTAMPTZ;

-- Fila de pendências: as notificações que ainda não viraram e-mail.
CREATE INDEX idx_notificacao_email_pendente ON notificacao (data) WHERE email_enviado_em IS NULL;

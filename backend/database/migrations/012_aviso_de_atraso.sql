-- Aviso de atraso (RF08).
--
-- O atraso já era visível na tela — "em atraso" é uma leitura do relógio
-- sobre o prazo —, mas ninguém era avisado: quem não abrisse o sistema não
-- ficava sabendo. Faltava um gatilho de tempo, que nenhuma requisição de
-- usuário dá.
--
-- Guardar "para qual prazo já avisamos" resolve dois problemas de uma vez.
-- Uma marca booleana faria a varredura reenviar o aviso a cada passagem, ou
-- nunca mais reenviar depois do primeiro. Guardando o próprio prazo:
--
--   * enquanto o prazo for o mesmo, o aviso sai uma vez só, por mais vezes
--     que a varredura rode;
--   * quando o prazo muda — repriorização, tempo suspenso devolvido ao sair
--     de "aguardando material", reabertura —, o valor guardado deixa de bater
--     e um novo estouro volta a avisar, que é o correto: é outro
--     descumprimento, não o mesmo.
--
-- E nada precisa limpar a coluna: quem move o prazo já a invalida por
-- consequência.

ALTER TABLE chamado
  ADD COLUMN IF NOT EXISTS atraso_notificado_para TIMESTAMPTZ;

COMMENT ON COLUMN chamado.atraso_notificado_para IS
  'Valor de prazo_estimado para o qual o aviso de atraso já foi emitido. '
  'Diferente do prazo atual (ou nulo) significa que um novo aviso é devido.';

-- A varredura procura sempre a mesma fatia: em aberto, com prazo vencido e
-- ainda não avisado para o prazo vigente. O índice parcial de 007 já cobre
-- "em aberto com prazo"; incluir a coluna aqui evita ir à heap para descartar
-- o que já foi avisado, que com o tempo é a maioria dos vencidos.
DROP INDEX IF EXISTS idx_chamado_prazo_em_aberto;

CREATE INDEX idx_chamado_prazo_em_aberto
    ON chamado (prazo_estimado)
 INCLUDE (atraso_notificado_para)
 WHERE estado NOT IN ('concluido', 'cancelado');

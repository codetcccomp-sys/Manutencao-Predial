-- Índices nas datas que os relatórios e a lista usam para recortar e ordenar.
--
-- Todo relatório filtra por período em `data_abertura`, o gráfico por dia
-- conta conclusões por `data_conclusao`, e a lista de chamados ordena pelos
-- mais recentes. Sem índice, cada um desses é uma leitura da tabela inteira:
-- imperceptível com centenas de chamados, e o tipo de lentidão que aparece de
-- repente — sem nenhuma mudança de código — quando a base passa de dezenas de
-- milhares, que é onde um prédio grande chega em poucos anos.
--
-- Os dois são btree simples. O de conclusão é parcial porque chamado em aberto
-- não tem data de conclusão, e indexar o nulo só ocuparia espaço — o plano
-- Free do Supabase tem 500 MB para tudo.
CREATE INDEX IF NOT EXISTS idx_chamado_data_abertura ON chamado (data_abertura);

CREATE INDEX IF NOT EXISTS idx_chamado_data_conclusao ON chamado (data_conclusao)
  WHERE data_conclusao IS NOT NULL;

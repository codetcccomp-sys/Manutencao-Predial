-- Anexos guardados no próprio banco.
--
-- A tabela nasceu com "caminho_arquivo", desenhada para um servidor com disco
-- próprio. A API roda em funções serverless: o sistema de arquivos é somente
-- leitura fora de /tmp, e o que for escrito em /tmp morre com a instância —
-- um caminho gravado aqui apontaria para um arquivo que já não existe na
-- requisição seguinte.
--
-- O conteúdo passa a ficar em bytea, o que mantém o anexo na mesma transação
-- e no mesmo backup do resto do chamado, sem credencial nova nem serviço a
-- mais. O custo é ocupar espaço do Postgres: se o volume crescer, o caminho
-- é migrar para armazenamento de objetos, e aí estas colunas viram a origem
-- da cópia.

ALTER TABLE anexo DROP COLUMN caminho_arquivo;

ALTER TABLE anexo
  ADD COLUMN nome_arquivo  VARCHAR(255) NOT NULL,
  ADD COLUMN mime_type     VARCHAR(100) NOT NULL,
  ADD COLUMN tamanho_bytes INTEGER NOT NULL,
  ADD COLUMN conteudo      BYTEA NOT NULL;

-- O armazenamento fica no padrão de bytea (EXTENDED): o conteúdo já vai para
-- o TOAST quando passa do limite da página, então a listagem de metadados não
-- carrega os bytes junto, e a compressão do TOAST ainda vale para PDF.

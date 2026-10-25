-- Tira da produção os dados FICTÍCIOS da apresentação (semear-apresentacao.sql), e só eles.
--
-- Diferente de `limpar-demonstracao.sql`, que apaga TODOS os chamados e por isso não pode rodar onde
-- há uso real, este script reconhece o que semeou: os chamados com protocolo `SMP-AAAAMMDD-DEMOnn`
-- (as letras M e O nunca saem do gerador de protocolo, que só usa 0-9 e A-F) e as contas do domínio
-- reservado `@conserva.invalid`. Chamado real e conta real ficam. O cadastro (locais, categorias,
-- planos, regras) também: o seed não o altera.
--
-- Não abre nem fecha transação: ensaie com BEGIN … ROLLBACK, depois repita com COMMIT.
--
-- Uma conta real que tenha participado de chamado fictício (técnico, solicitante) fica; o que ela
-- tinha de fictício vai embora junto com o chamado, avisos e comentários inclusive.

DO $$
BEGIN
  -- Uma conta fictícia que alguém ativou ou usou fora do seed não se apaga em silêncio.
  IF EXISTS (SELECT 1 FROM usuario WHERE email LIKE '%@conserva.invalid' AND ativo) THEN
    RAISE EXCEPTION 'Há conta fictícia ativa. Confira antes: alguém a ativou, e ela pode ter sido usada.';
  END IF;
END $$;

DROP TABLE IF EXISTS pg_temp.fic_chamado, pg_temp.fic_conta;
CREATE TEMP TABLE fic_chamado AS SELECT id FROM chamado WHERE protocolo LIKE 'SMP-%-DEMO%';
CREATE TEMP TABLE fic_conta AS SELECT id FROM usuario WHERE email LIKE '%@conserva.invalid';

-- Os anexos, se alguém tiver anexado algo a um chamado fictício, saem com ele; os do Storage
-- são arquivos fora do banco e não se apagam daqui.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM anexo WHERE chamado_id IN (SELECT id FROM fic_chamado) AND armazenamento <> 'banco') THEN
    RAISE EXCEPTION 'Há anexo no Supabase Storage em chamado de apresentação. Apague o arquivo no repositório antes.';
  END IF;
END $$;

DELETE FROM anexo           WHERE chamado_id IN (SELECT id FROM fic_chamado);
DELETE FROM historico_chamado WHERE chamado_id IN (SELECT id FROM fic_chamado);
DELETE FROM comentario      WHERE chamado_id IN (SELECT id FROM fic_chamado);
DELETE FROM avaliacao       WHERE chamado_id IN (SELECT id FROM fic_chamado);
DELETE FROM chamado_material WHERE chamado_id IN (SELECT id FROM fic_chamado);
DELETE FROM notificacao     WHERE chamado_id IN (SELECT id FROM fic_chamado);
DELETE FROM chamado         WHERE id IN (SELECT id FROM fic_chamado);

-- Comentário ou histórico que uma conta fictícia deixou em chamado real (não deveria existir)
-- impede apagá-la: a chave estrangeira recusa, em vez de apagar o registro de um chamado real.
DELETE FROM equipe_tecnico WHERE usuario_id IN (SELECT id FROM fic_conta);
DELETE FROM recuperacao_senha WHERE usuario_id IN (SELECT id FROM fic_conta);
DELETE FROM codigo_recuperacao_2fa WHERE usuario_id IN (SELECT id FROM fic_conta);
DELETE FROM usuario WHERE id IN (SELECT id FROM fic_conta);

SELECT 'chamados de apresentação restantes' AS item, count(*) AS total FROM chamado WHERE protocolo LIKE 'SMP-%-DEMO%'
UNION ALL SELECT 'contas fictícias restantes', count(*) FROM usuario WHERE email LIKE '%@conserva.invalid'
UNION ALL SELECT 'chamados (todos)', count(*) FROM chamado
UNION ALL SELECT 'contas (todas)', count(*) FROM usuario;

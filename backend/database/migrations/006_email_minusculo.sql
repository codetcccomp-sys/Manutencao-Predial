-- E-mail deixa de distinguir maiúsculas de minúsculas.
--
-- usuario.email era consultado por igualdade exata: quem se cadastrou como
-- "Joao@empresa.com" não conseguia entrar digitando "joao@empresa.com", e o
-- UNIQUE da coluna não impedia as duas contas existirem lado a lado para a
-- mesma pessoa.
--
-- A normalização passa a valer no banco, e não só no código, porque a
-- aplicação não é a única a escrever aqui: correções manuais por SQL
-- acontecem, e a garantia precisa sobreviver a elas.

-- Se já existirem contas que só diferem pela caixa, a migração para e diz
-- quais são: escolher qual delas sobrevive é decisão de quem opera o
-- sistema, não de um UPDATE automático.
DO $$
DECLARE
  conflitos TEXT;
BEGIN
  SELECT string_agg(email || ' (' || contas || ')', ', ')
    INTO conflitos
    FROM (
      SELECT lower(email) AS email, count(*) AS contas
        FROM usuario
       GROUP BY lower(email)
      HAVING count(*) > 1
    ) duplicados;

  IF conflitos IS NOT NULL THEN
    RAISE EXCEPTION
      'Há contas que diferem apenas por maiúsculas e precisam ser unificadas à mão antes desta migração: %',
      conflitos;
  END IF;
END $$;

UPDATE usuario SET email = lower(email) WHERE email <> lower(email);

-- Com o CHECK garantindo que tudo é minúsculo, o UNIQUE que a coluna já tem
-- passa a valer como unicidade sem distinção de caixa — sem precisar de um
-- segundo índice sobre lower(email).
ALTER TABLE usuario ADD CONSTRAINT usuario_email_minusculo CHECK (email = lower(email));

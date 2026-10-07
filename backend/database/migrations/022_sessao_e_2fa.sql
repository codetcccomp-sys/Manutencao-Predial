-- Sessão revogável e verificação em duas etapas.

-- Versão da sessão. Todo token carrega a versão em que foi emitido; subir a
-- versão derruba de uma vez todas as sessões abertas da pessoa.
--
-- Sem isto, redefinir a senha não tirava ninguém de dentro: quem tivesse
-- roubado a sessão (um computador compartilhado esquecido logado, um token
-- copiado) continuava com ela por até 8 horas depois de a vítima trocar a
-- senha — justamente o momento em que ela achava que tinha resolvido.
--
-- O padrão 0 casa com tokens antigos, sem a versão: publicar isto não
-- desloga ninguém.
ALTER TABLE usuario
  ADD COLUMN sessao_versao     INTEGER NOT NULL DEFAULT 0,
  -- TOTP (o código de 6 dígitos do aplicativo autenticador). Opcional por
  -- pessoa; recomendado para gestão e administração, que podem mais.
  ADD COLUMN totp_segredo      TEXT,
  -- O segredo de um cadastro em andamento: só vira o segredo de verdade
  -- quando a pessoa prova que o aplicativo dela gera o código certo. Ativar
  -- direto travaria para fora quem leu o QR com o aplicativo errado.
  ADD COLUMN totp_pendente     TEXT,
  ADD COLUMN totp_ativado_em   TIMESTAMPTZ,
  -- O último passo de 30 s aceito. Um código usado não vale de novo, nem
  -- dentro da própria janela: quem o viu por cima do ombro não entra com ele.
  ADD COLUMN totp_ultimo_passo BIGINT;

-- Códigos de recuperação: para quem perdeu o celular. Uso único, guardados
-- como hash (como a senha: o banco vazado não entrega os códigos).
CREATE TABLE codigo_recuperacao_2fa (
  id          SERIAL PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuario(id),
  codigo_hash TEXT NOT NULL,
  usado_em    TIMESTAMPTZ,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_codigo_recuperacao_2fa_livres ON codigo_recuperacao_2fa (usuario_id) WHERE usado_em IS NULL;

-- Sem RLS de propósito, como as demais tabelas (ver migração 005): o acesso
-- pelo PostgREST está fechado por privilégio, e ligar RLS sem política
-- bloquearia o smp_backend, que não é dono da tabela.

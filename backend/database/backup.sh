#!/usr/bin/env bash
#
# Backup do banco, restaurado e conferido antes de ser guardado.
#
# Um backup que nunca foi restaurado não é um backup — é uma suposição
# (docs/piloto.md §2.3). Por isso este script não para no pg_dump: restaura o
# arquivo num banco descartável, confere que as tabelas voltaram com as mesmas
# contagens da origem e só então cifra e entrega. Se a restauração falha, o
# script falha, e o agendador avisa.
#
# Variáveis:
#   ORIGEM_URL     string de conexão do banco de produção (Session pooler do
#                  Supabase, porta 5432: o modo transação, 6543, não serve ao
#                  pg_dump). Obrigatória.
#   RESTAURO_URL   banco vazio onde a restauração é testada. Obrigatória. O
#                  script recria o schema public dele: nunca aponte para um
#                  banco com dados.
#   SENHA_BACKUP   frase para cifrar o arquivo (AES-256). Obrigatória, a menos
#                  que SEM_CRIPTOGRAFIA=1 (só para teste local): o dump tem nome,
#                  e-mail e hash de senha de pessoas, e não sai daqui em claro.
#
# Uso: backup.sh <pasta de saída>

set -euo pipefail

SAIDA="${1:?informe a pasta de saída}"
: "${ORIGEM_URL:?defina ORIGEM_URL (string de conexão do banco de origem)}"
: "${RESTAURO_URL:?defina RESTAURO_URL (banco vazio para testar a restauração)}"
if [[ "${SEM_CRIPTOGRAFIA:-0}" != "1" ]]; then
  : "${SENHA_BACKUP:?defina SENHA_BACKUP (ou SEM_CRIPTOGRAFIA=1 só em teste local)}"
fi

mkdir -p "$SAIDA"
CARIMBO="$(date -u +%Y-%m-%dT%H%MZ)"
ARQUIVO="$SAIDA/conserva-$CARIMBO.dump"

# As contagens que provam que a restauração trouxe o conteúdo, não só a
# estrutura. Contadas na origem logo antes do dump: um chamado aberto entre
# as duas leituras faria a conferência acusar diferença que não é defeito, e
# o pg_dump lê tudo numa transação só, então a janela é de segundos.
CONTAGEM_SQL="
  SELECT 'usuario',           count(*) FROM usuario
  UNION ALL SELECT 'chamado',           count(*) FROM chamado
  UNION ALL SELECT 'historico_chamado', count(*) FROM historico_chamado
  UNION ALL SELECT 'local',             count(*) FROM local
  UNION ALL SELECT 'plano_preventivo',  count(*) FROM plano_preventivo
  UNION ALL SELECT 'migracao',          count(*) FROM migracao
  ORDER BY 1"

contar() {
  psql "$1" -X -A -t -F ' ' -v ON_ERROR_STOP=1 -c "$CONTAGEM_SQL"
}

echo "▸ contando a origem"
contar "$ORIGEM_URL" > "$SAIDA/contagem-origem.txt"

echo "▸ pg_dump (schema public)"
# Só o public: é onde o sistema vive. Os schemas do Supabase (auth, storage,
# realtime) não são usados por ele e não restauram fora do Supabase.
pg_dump "$ORIGEM_URL" --schema=public --no-owner --no-privileges --format=custom --file="$ARQUIVO"

echo "▸ restaurando num banco descartável"
psql "$RESTAURO_URL" -X -q -v ON_ERROR_STOP=1 -c 'SET client_min_messages = warning' \
  -c 'DROP SCHEMA IF EXISTS public CASCADE' -c 'CREATE SCHEMA public'
# O dump traz o CREATE SCHEMA public, e o banco de restauro já tem o schema:
# a lista de itens deixa esse de fora, e o resto restaura com
# --exit-on-error — uma restauração "quase" completa é exatamente o que este
# teste existe para pegar.
pg_restore --list "$ARQUIVO" | grep -v ' SCHEMA - public ' > "$SAIDA/itens.lst"
pg_restore --no-owner --no-privileges --exit-on-error --use-list="$SAIDA/itens.lst" \
  --dbname="$RESTAURO_URL" "$ARQUIVO"
rm -f "$SAIDA/itens.lst"

echo "▸ conferindo a restauração"
contar "$RESTAURO_URL" > "$SAIDA/contagem-restauro.txt"
if ! diff -u "$SAIDA/contagem-origem.txt" "$SAIDA/contagem-restauro.txt"; then
  echo "✗ a restauração não trouxe o mesmo conteúdo da origem" >&2
  exit 1
fi
cat "$SAIDA/contagem-restauro.txt"
rm -f "$SAIDA/contagem-restauro.txt"

if [[ "${SEM_CRIPTOGRAFIA:-0}" == "1" ]]; then
  echo "✔ $ARQUIVO (SEM criptografia — só para teste local)"
  exit 0
fi

echo "▸ cifrando"
# A frase entra por descritor de arquivo, não por argumento: argumento aparece
# na lista de processos da máquina.
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --symmetric --cipher-algo AES256 --output "$ARQUIVO.gpg" "$ARQUIVO" 3<<<"$SENHA_BACKUP"
rm -f "$ARQUIVO"
echo "✔ $ARQUIVO.gpg"

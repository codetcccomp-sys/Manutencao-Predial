#!/usr/bin/env bash
# Recria o banco DESCARTÁVEL smp_video e o semeia, para que cada gravação do comercial parta
# do mesmo estado (as cenas abrem um chamado e geram uma preventiva). Supõe a API de vídeo já
# no ar em localhost:3333 (ver README). Mesmas travas do ../rodar.sh.
set -euo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACK="$(cd "$AQUI/../../../backend" && pwd)"
if [[ -n "${DATABASE_URL:-}" || "${NODE_ENV:-}" == "production" ]]; then
  echo "recusado: DATABASE_URL ou NODE_ENV=production indicam um banco real." >&2; exit 1
fi
if [[ -f "$BACK/.env" ]]; then set -a; source "$BACK/.env"; set +a; fi
: "${DB_HOST:=localhost}" "${DB_PORT:=5432}" "${DB_USER:?defina DB_USER}" "${DB_PASSWORD:?defina DB_PASSWORD}"
if [[ "$DB_HOST" != "localhost" && "$DB_HOST" != "127.0.0.1" ]]; then
  echo "recusado: DB_HOST=$DB_HOST não é local." >&2; exit 1
fi
export PGPASSWORD="$DB_PASSWORD" DB_HOST DB_PORT DB_USER DB_PASSWORD
PSQL=(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -d postgres -c 'DROP DATABASE IF EXISTS smp_video WITH (FORCE)'
"${PSQL[@]}" -d postgres -c 'CREATE DATABASE smp_video'
( cd "$BACK" && DB_NAME=smp_video npm run migrate --silent >/dev/null )
( cd "$BACK" && DB_NAME=smp_video E2E_ADMIN_EMAIL=admin_video@exemplo.com E2E_ADMIN_SENHA=senha_video_local node database/semear-admin.js >/dev/null )
node "$AQUI/../semear.mjs" >/dev/null
"${PSQL[@]}" -d smp_video -f "$AQUI/../datas.sql" >/dev/null
echo "✔ banco smp_video semeado"

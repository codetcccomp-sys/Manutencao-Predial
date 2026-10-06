#!/usr/bin/env bash
# Grava o vídeo de demonstração do Conserva Predial, do zero, num banco DESCARTÁVEL.
#
#   npm run video                 (na pasta frontend)
#
# Passos: cria o banco smp_video, migra, semeia (pela API), espalha as datas, sobe o
# backend e a build, grava, sintetiza a narração (se o Kokoro estiver instalado) e junta
# tudo num MP4. Ao sair, desliga os servidores, mesmo se algo falhar no meio.
# Veja o README desta pasta para o que instalar.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONT="$(cd "$AQUI/.." && pwd)"
BACK="$(cd "$FRONT/../backend" && pwd)"
SAIDA="$AQUI/saida"

# Travas: este script CRIA contas e APAGA o banco smp_video. Contra um banco de verdade
# seria o pior erro possível, então ele recusa tudo o que não parece uma máquina de dev.
if [[ -n "${DATABASE_URL:-}" || "${NODE_ENV:-}" == "production" ]]; then
  echo "recusado: DATABASE_URL ou NODE_ENV=production indicam um banco real." >&2
  exit 1
fi
if [[ -f "$BACK/.env" ]]; then set -a; source "$BACK/.env"; set +a; fi
: "${DB_HOST:=localhost}" "${DB_PORT:=5432}" "${DB_USER:?defina DB_USER (backend/.env)}" "${DB_PASSWORD:?defina DB_PASSWORD (backend/.env)}"
if [[ "$DB_HOST" != "localhost" && "$DB_HOST" != "127.0.0.1" ]]; then
  echo "recusado: DB_HOST=$DB_HOST não é local." >&2
  exit 1
fi

export PGPASSWORD="$DB_PASSWORD"
BANCO=smp_video
PSQL=(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -v ON_ERROR_STOP=1 -q)

PIDS=()
desligar() { for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null || true; done; }
trap desligar EXIT

esperar() { # url
  for _ in $(seq 1 60); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 1; done
  echo "não respondeu: $1" >&2; return 1
}

for porta in 3333 4173; do
  if (echo > "/dev/tcp/127.0.0.1/$porta") 2>/dev/null; then
    echo "a porta $porta já está em uso; encerre o que roda nela e tente de novo." >&2; exit 1
  fi
done

echo "▸ banco descartável $BANCO"
dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --if-exists "$BANCO"
createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$BANCO" || {
  echo "O papel $DB_USER não pode criar bancos. Como superusuário:  ALTER ROLE $DB_USER CREATEDB;" >&2; exit 1; }

echo "▸ migrações e administrador"
( cd "$BACK" && DB_NAME="$BANCO" npm run migrate --silent >/dev/null )
( cd "$BACK" && DB_NAME="$BANCO" E2E_ADMIN_EMAIL=admin_video@exemplo.com E2E_ADMIN_SENHA=senha_video_local node database/semear-admin.js >/dev/null )

echo "▸ backend (porta 3333) e build (porta 4173)"
( cd "$BACK" && PORT=3333 NODE_ENV=test JWT_SECRET=segredo_video JWT_EXPIRES_IN=8h CRON_SECRET=video DB_NAME="$BANCO" exec node src/server.js ) >"$SAIDA.backend.log" 2>&1 &
PIDS+=($!)
( cd "$FRONT" && npm run build --silent >/dev/null && exec node node_modules/vite/bin/vite.js preview --port 4173 --strictPort ) >"$SAIDA.preview.log" 2>&1 &
PIDS+=($!)
esperar http://localhost:3333/health/db
esperar http://localhost:4173/login

echo "▸ semente (pela API) e datas"
node "$AQUI/semear.mjs" >/dev/null
"${PSQL[@]}" -d "$BANCO" -f "$AQUI/datas.sql"

mkdir -p "$SAIDA"
rm -f "$SAIDA"/*.webm "$SAIDA/legendas.json" "$SAIDA/capitulos.json" "$SAIDA/narracao.wav" "$SAIDA"/*.mp4

PY="${PYTHON:-}"
[[ -z "$PY" && -x "$AQUI/.venv/bin/python" ]] && PY="$AQUI/.venv/bin/python"
PY="${PY:-python3}"
NARRAR=0
if [[ "${SEM_VOZ:-0}" != "1" ]] && "$PY" -c "import kokoro_onnx, soundfile" 2>/dev/null \
   && [[ -f "${KOKORO_MODELO:-$AQUI/modelo}/kokoro-v1.0.int8.onnx" ]]; then
  NARRAR=1
  for d in /usr/lib/x86_64-linux-gnu/espeak-ng-data /usr/share/espeak-ng-data /usr/lib/espeak-ng-data; do
    [[ -d "$d" && -z "${ESPEAK_DATA_PATH:-}" ]] && export ESPEAK_DATA_PATH="$d"
  done
  # Só sintetiza de novo se as falas mudaram: são minutos de CPU.
  if [[ ! -f "$SAIDA/manifesto.json" || "$AQUI/falas.json" -nt "$SAIDA/manifesto.json" ]]; then
    echo "▸ narração: sintetizando a voz (alguns minutos)"
    "$PY" "$AQUI/narrar.py" sintetizar
  else
    echo "▸ narração: reaproveitando as falas já sintetizadas"
  fi
else
  rm -f "$SAIDA/manifesto.json"
  echo "▸ sem narração (Kokoro ou o modelo não encontrados; veja o README). Só legendas."
fi

echo "▸ gravando"
( cd "$FRONT" && node "$AQUI/gravar.mjs" "$SAIDA" )

WEBM="$(ls "$SAIDA"/*.webm | head -1)"
MP4="$SAIDA/conserva-predial-demonstracao.mp4"
if command -v ffmpeg >/dev/null; then
  if [[ "$NARRAR" == "1" ]]; then
    "$PY" "$AQUI/narrar.py" misturar
    ffmpeg -v error -y -i "$WEBM" -i "$SAIDA/narracao.wav" -map 0:v -map 1:a \
      -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest -movflags +faststart "$MP4"
  else
    ffmpeg -v error -y -i "$WEBM" -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -movflags +faststart "$MP4"
  fi
  echo "✔ $MP4"
else
  echo "✔ $WEBM (instale o ffmpeg para gerar o MP4 e juntar a voz)"
fi

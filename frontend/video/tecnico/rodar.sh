#!/usr/bin/env bash
# Grava o vídeo técnico do Conserva Predial (slides narrados). Não precisa de banco nem
# de servidor: só o Chromium do Playwright, o ffmpeg e, para a voz, o Kokoro (o mesmo do
# vídeo de demonstração; veja ../README.md).
#
#   npm run video:tecnico          (na pasta frontend)
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIDEO="$(cd "$AQUI/.." && pwd)"
FRONT="$(cd "$VIDEO/.." && pwd)"
SAIDA="$AQUI/saida"
mkdir -p "$SAIDA"
rm -f "$SAIDA"/*.webm "$SAIDA/legendas.json" "$SAIDA/narracao.wav" "$SAIDA"/*.mp4

PY="${PYTHON:-}"
[[ -z "$PY" && -x "$VIDEO/.venv/bin/python" ]] && PY="$VIDEO/.venv/bin/python"
PY="${PY:-python3}"
export FALAS="$AQUI/falas.json" SAIDA

NARRAR=0
if [[ "${SEM_VOZ:-0}" != "1" ]] && "$PY" -c "import kokoro_onnx, soundfile" 2>/dev/null \
   && [[ -f "${KOKORO_MODELO:-$VIDEO/modelo}/kokoro-v1.0.int8.onnx" ]]; then
  NARRAR=1
  for d in /usr/lib/x86_64-linux-gnu/espeak-ng-data /usr/share/espeak-ng-data /usr/lib/espeak-ng-data; do
    [[ -d "$d" && -z "${ESPEAK_DATA_PATH:-}" ]] && export ESPEAK_DATA_PATH="$d"
  done
  if [[ ! -f "$SAIDA/manifesto.json" || "$AQUI/falas.json" -nt "$SAIDA/manifesto.json" ]]; then
    echo "▸ narração: sintetizando a voz (alguns minutos)"
    "$PY" "$VIDEO/narrar.py" sintetizar
  else
    echo "▸ narração: reaproveitando as falas já sintetizadas"
  fi
else
  rm -f "$SAIDA/manifesto.json"
  echo "▸ sem narração (Kokoro ou o modelo não encontrados). Só legendas."
fi

echo "▸ gravando os slides"
( cd "$FRONT" && node "$AQUI/gravar.mjs" "$SAIDA" )

WEBM="$(ls "$SAIDA"/*.webm | head -1)"
MP4="$SAIDA/conserva-predial-tecnico.mp4"
if command -v ffmpeg >/dev/null; then
  if [[ "$NARRAR" == "1" ]]; then
    "$PY" "$VIDEO/narrar.py" misturar
    ffmpeg -v error -y -i "$WEBM" -i "$SAIDA/narracao.wav" -map 0:v -map 1:a \
      -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest -movflags +faststart "$MP4"
  else
    ffmpeg -v error -y -i "$WEBM" -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart "$MP4"
  fi
  echo "✔ $MP4"
else
  echo "✔ $WEBM (instale o ffmpeg para gerar o MP4 e juntar a voz)"
fi

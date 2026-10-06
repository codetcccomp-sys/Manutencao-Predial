#!/usr/bin/env python3
"""
Narração do vídeo de demonstração, com voz masculina em português do Brasil.

Dois passos, na ordem em que o vídeo os usa:

  narrar.py sintetizar            falas.json -> saida/audio/*.wav + saida/manifesto.json
  narrar.py misturar              saida/legendas.json + clipes -> saida/narracao.wav

A voz é o Kokoro (modelo aberto, roda no próprio computador, sem enviar texto a
serviço nenhum), na voz `pm_alex`. O modelo e o arquivo de vozes (~120 MB) vêm da
pasta apontada por KOKORO_MODELO, ou de video/modelo/ (ignorada pelo git).

Por que dois passos e não um só: a gravação precisa saber QUANTO DURA cada fala
antes de rodar, para esperar o fim de cada uma antes de mostrar a legenda seguinte.
Sem isso a voz atropelaria a próxima cena, ou o vídeo teria silêncio sem motivo.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, "saida")
AUDIO = os.path.join(SAIDA, "audio")
MODELO = os.environ.get("KOKORO_MODELO", os.path.join(AQUI, "modelo"))
VOZ = os.environ.get("VOZ", "pm_alex")  # masculina, pt-BR; a outra masculina é pm_santa
VELOCIDADE = float(os.environ.get("VELOCIDADE", "1.0"))
TAXA = 24000


def sintetizar():
    from kokoro_onnx import Kokoro

    falas = json.load(open(os.path.join(AQUI, "falas.json"), encoding="utf-8"))
    os.makedirs(AUDIO, exist_ok=True)
    motor = Kokoro(os.path.join(MODELO, "kokoro-v1.0.int8.onnx"), os.path.join(MODELO, "voices-v1.0.bin"))

    manifesto = {}
    for i, (chave, fala) in enumerate(falas.items()):
        arquivo = os.path.join(AUDIO, f"{i:02d}.wav")
        amostras, taxa = motor.create(fala, voice=VOZ, speed=VELOCIDADE, lang="pt-br")
        # Meio segundo de respiro no fim: a fala seguinte não cola na anterior.
        amostras = np.concatenate([amostras, np.zeros(int(taxa * 0.35), dtype=amostras.dtype)])
        sf.write(arquivo, amostras, taxa)
        manifesto[chave] = {"arquivo": arquivo, "duracao": round(len(amostras) / taxa, 3)}
        print(f"[{i + 1}/{len(falas)}] {manifesto[chave]['duracao']:5.1f}s  {chave[:60]}", flush=True)

    json.dump(manifesto, open(os.path.join(SAIDA, "manifesto.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    total = sum(m["duracao"] for m in manifesto.values())
    print(f"\n{len(manifesto)} falas, {total:.0f}s de voz ({VOZ}).")


def misturar():
    manifesto = json.load(open(os.path.join(SAIDA, "manifesto.json"), encoding="utf-8"))
    legendas = json.load(open(os.path.join(SAIDA, "legendas.json"), encoding="utf-8"))

    fim = max(l["t"] + manifesto[l["chave"]]["duracao"] for l in legendas) + 2
    trilha = np.zeros(int(fim * TAXA), dtype=np.float32)

    for l in legendas:
        amostras, taxa = sf.read(manifesto[l["chave"]]["arquivo"], dtype="float32")
        assert taxa == TAXA, f"taxa inesperada: {taxa}"
        ini = int(l["t"] * TAXA)
        trecho = trilha[ini : ini + len(amostras)]
        # A gravação espera cada fala acabar; se mesmo assim duas se tocarem, o erro
        # aparece aqui em vez de virar uma sobreposição que só se descobre ouvindo.
        assert not np.any(np.abs(trecho) > 1e-4), f"falas sobrepostas em t={l['t']:.1f}s ({l['chave'][:40]})"
        trilha[ini : ini + len(amostras)] = amostras[: len(trilha) - ini]

    pico = float(np.abs(trilha).max()) or 1.0
    trilha *= min(1.0, 0.89 / pico)  # sem estourar, mantendo o volume natural da voz
    sf.write(os.path.join(SAIDA, "narracao.wav"), trilha, TAXA)
    print(f"narracao.wav: {len(trilha) / TAXA:.1f}s, {len(legendas)} falas")


if __name__ == "__main__":
    {"sintetizar": sintetizar, "misturar": misturar}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()

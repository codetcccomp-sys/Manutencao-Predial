#!/usr/bin/env python3
"""
Monta o vídeo comercial (60 s, 1920×1080) a partir do que o gravar.mjs e o narrar.py deixaram
em saida/: corta os clipes pelas marcas, funde as cenas, grava as legendas na imagem, compõe a
trilha e mistura com a narração.

  montar.py            -> saida/conserva-predial-comercial.mp4  (+ .srt e trilha.wav)

A trilha é sintetizada aqui (acordes longos, sem melodia): não há arquivo de música de
terceiros no repositório, logo não há licença a conferir. Quer outra? Aponte TRILHA=arquivo.

O ROTEIRO abaixo é a fonte da montagem: cada cena diz de qual clipe sai, em que marca começa,
quanto dura e a que instante da cena a fala entra. A soma (menos as fusões) dá 60 s.
"""
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.environ.get("SAIDA", os.path.join(AQUI, "saida"))
FALAS = json.load(open(os.path.join(AQUI, "falas.json"), encoding="utf-8"))
MANIFESTO = json.load(open(os.path.join(SAIDA, "manifesto.json"), encoding="utf-8"))
MARCAS = json.load(open(os.path.join(SAIDA, "marcas.json"), encoding="utf-8"))
FUSAO = 0.5
FPS = 30

# (clipe, marca de referência, deslocamento em s, duração, fala, atraso da fala na cena)
ROTEIRO = [
    ("abertura", "inicio", 0.0, 11.0, "abertura", 0.4),
    ("marca", "inicio", 0.0, 4.4, "apresentacao", 0.8),
    ("visao", "inicio", 0.3, 4.4, None, 0),
    ("chamado", "inicio", 0.0, 9.8, "chamado", 1.5),
    ("painel", "inicio", 0.0, 9.0, "painel", 0.7),
    ("preventiva", "gerado", -5.2, 9.0, "preventiva", 0.7),
    ("encerramento", "inicio", 0.0, 15.4, "encerramento", 0.8),
]

# Legendas: cada fala em trechos curtos. O instante de cada trecho é proporcional ao número de
# letras, o que basta para frases deste tamanho (erro de poucos décimos de segundo).
LEGENDAS = {
    "abertura": [
        "Você sabe, agora, em que pé está cada pedido",
        "de manutenção do seu prédio?",
        "Quando o aviso chega por mensagem,",
        "por telefone ou no corredor,",
        "é fácil perder a conta.",
    ],
    "apresentacao": ["O Conserva Predial reúne os chamados", "de manutenção em um só lugar,", "do pedido à conclusão."],
    "chamado": ["Quem percebe o problema abre o chamado", "em poucos passos,", "e recebe o protocolo na hora."],
    "painel": ["A gestão vê, num painel,", "o que está sem técnico", "e o que passou do prazo."],
    "preventiva": ["E os planos de manutenção preventiva", "abrem os chamados na data prevista."],
    "encerramento": [
        "Com o Conserva Predial, você sabe",
        "o que foi pedido, quem está cuidando,",
        "e o que está no prazo.",
        "Agende uma demonstração",
        "e conheça o sistema na prática.",
    ],
}


def rodar(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def linha_do_tempo():
    cenas, t = [], 0.0
    for clipe, marca, desloc, dur, fala, atraso in ROTEIRO:
        inicio_no_clipe = MARCAS[clipe][marca] + desloc
        sobra = MARCAS[clipe]["fim"] - inicio_no_clipe - dur
        if inicio_no_clipe < 0 or sobra < 0:
            sys.exit(f"clipe {clipe}: falta material ({sobra:.2f}s). Grave de novo ou encurte a cena.")
        cenas.append({"clipe": clipe, "de": inicio_no_clipe, "dur": dur, "t": t, "fala": fala, "t_fala": t + atraso})
        t += dur - FUSAO
    return cenas, t + FUSAO


def legendas(cenas):
    trechos = []
    for c in cenas:
        if not c["fala"]:
            continue
        # A voz termina 0,35 s antes do fim do arquivo (respiro acrescentado na síntese).
        voz = MANIFESTO[c["fala"]]["duracao"] - 0.35
        partes = LEGENDAS[c["fala"]]
        if "".join(partes).replace(" ", "") != FALAS[c["fala"]].replace(" ", "").replace("demonstração,", "demonstração"):
            sys.exit(f"legenda de '{c['fala']}' não confere com a fala: o que se lê tem de ser o que se ouve.")
        total = sum(len(p) for p in partes)
        t = c["t_fala"]
        for p in partes:
            d = voz * len(p) / total
            trechos.append((t, t + d, p))
            t += d
    return trechos


def escrever_legendas(trechos):
    def hms(t, sep):
        h, r = divmod(t, 3600)
        m, s = divmod(r, 60)
        return f"{int(h):02d}:{int(m):02d}:{s:06.3f}".replace(".", sep)

    with open(os.path.join(SAIDA, "conserva-predial-comercial.srt"), "w", encoding="utf-8") as f:
        for i, (a, b, texto) in enumerate(trechos, 1):
            f.write(f"{i}\n{hms(a, ',')} --> {hms(b, ',')}\n{texto}\n\n")

    def ass(t):
        h, r = divmod(t, 3600)
        m, s = divmod(r, 60)
        return f"{int(h)}:{int(m):02d}:{s:05.2f}"

    caminho = os.path.join(SAIDA, "legendas.ass")
    with open(caminho, "w", encoding="utf-8") as f:
        f.write(
            "[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\n\n"
            "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
            "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
            "Alignment, MarginL, MarginR, MarginV, Encoding\n"
            # Caixa azul-marinho da marca (#0F1B33, levemente translúcida) com texto branco: lê-se
            # sobre a tela clara do sistema e sobre as artes escuras.
            "Style: L,Inter,46,&H00FFFFFF,&H00FFFFFF,&H18331B0F,&H18331B0F,-1,0,0,0,100,100,0,0,3,14,0,2,80,80,54,1\n\n"
            "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        )
        for a, b, texto in trechos:
            f.write(f"Dialogue: 0,{ass(a)},{ass(b)},L,,0,0,0,,{texto}\n")
    return caminho


def trilha(duracao, taxa=44100):
    """Acordes longos e suaves em dó maior, com um pulso discreto. Nada de melodia: é fundo."""
    t = np.arange(int(duracao * taxa)) / taxa
    som = np.zeros_like(t)
    acordes = [(130.81, 164.81, 196.00, 246.94), (110.00, 130.81, 164.81, 196.00),
               (87.31, 130.81, 174.61, 220.00), (98.00, 146.83, 196.00, 246.94)]
    compasso = 5.0
    for i in range(int(duracao / compasso) + 1):
        ini = i * compasso
        local = t - ini
        env = np.clip(local / 1.6, 0, 1) * np.clip((compasso + 1.6 - local) / 1.6, 0, 1) * (local >= 0)
        for f in acordes[i % len(acordes)]:
            for mult, ganho in ((1, 1.0), (2, 0.28), (3, 0.08)):
                som += env * ganho * np.sin(2 * np.pi * f * mult * t + 0.3 * np.sin(2 * np.pi * 0.11 * t))
        # Pulso: a fundamental uma oitava acima, a cada meio tempo, quase inaudível.
        f0 = acordes[i % len(acordes)][0] * 4
        for k in range(8):
            l2 = t - ini - k * compasso / 8
            som += 0.5 * (l2 >= 0) * np.exp(-np.clip(l2, 0, None) * 7) * np.sin(2 * np.pi * f0 * t) * (l2 < 1.5)
    som /= np.max(np.abs(som))
    som *= np.clip(t / 2.0, 0, 1) * np.clip((duracao - t) / 3.0, 0, 1)
    estereo = np.stack([som, np.roll(som, int(0.011 * taxa))], axis=1) * 0.6
    caminho = os.path.join(SAIDA, "trilha.wav")
    sf.write(caminho, estereo, taxa)
    return caminho


def main():
    cenas, total = linha_do_tempo()
    trechos = legendas(cenas)
    ass = escrever_legendas(trechos)
    musica = os.environ.get("TRILHA") or trilha(total)

    entradas, filtros = [], []
    for i, c in enumerate(cenas):
        entradas += ["-ss", f"{c['de']:.3f}", "-t", f"{c['dur']:.3f}", "-i", os.path.join(SAIDA, "clipes", c["clipe"] + ".webm")]
        filtros.append(f"[{i}:v]fps={FPS},scale=1920:1080:flags=lanczos,format=yuv420p,setpts=PTS-STARTPTS,"
                       f"tpad=stop_mode=clone:stop_duration=1[v{i}]")
    anterior = "v0"
    for i in range(1, len(cenas)):
        filtros.append(f"[{anterior}][v{i}]xfade=transition=fade:duration={FUSAO}:offset={cenas[i]['t']:.3f}[x{i}]")
        anterior = f"x{i}"
    ass_esc = ass.replace("\\", "/").replace(":", "\\:")
    filtros.append(f"[{anterior}]subtitles='{ass_esc}',fade=t=out:st={total - 0.6:.2f}:d=0.6,trim=duration={total:.3f}[v]")

    n = len(cenas)
    vozes = []
    for c in cenas:
        if not c["fala"]:
            continue
        k = n + len(vozes)
        entradas += ["-i", MANIFESTO[c["fala"]]["arquivo"]]
        ms = int(c["t_fala"] * 1000)
        filtros.append(f"[{k}:a]aresample=48000,adelay={ms}|{ms}[a{k}]")
        vozes.append(f"[a{k}]")
    km = n + len(vozes)
    entradas += ["-i", musica]
    filtros.append(f"{''.join(vozes)}amix=inputs={len(vozes)}:normalize=0,highpass=f=70,"
                   "acompressor=threshold=-20dB:ratio=3:attack=5:release=120,volume=5dB,asplit[voz][chave]")
    # A trilha baixa quando a voz entra (sidechain) e nunca passa de fundo.
    filtros.append(f"[{km}:a]aresample=48000,volume=-17dB[m0];[m0][chave]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=500[m]")
    filtros.append(f"[voz][m]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9,atrim=duration={total:.3f}[a]")

    destino = os.path.join(SAIDA, "conserva-predial-comercial.mp4")
    rodar(*entradas, "-filter_complex", ";".join(filtros), "-map", "[v]", "-map", "[a]",
          "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS),
          "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", destino)
    print(f"✔ {destino}  ({total:.1f}s)")
    for c in cenas:
        print(f"  {c['t']:5.1f}s  {c['clipe']:<13}" + (f" fala em {c['t_fala']:.1f}s" if c["fala"] else ""))


if __name__ == "__main__":
    main()

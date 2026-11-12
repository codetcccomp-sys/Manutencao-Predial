"""
Monta o vídeo comercial (45 a 60 s, 1920×1080) a partir do que o gravar.mjs e o narrar.py
deixaram em saida/: junta as cenas com fusão curta, grava as legendas na imagem, compõe a
trilha e mistura com a narração.

  montar.py            -> saida/conserva-predial-comercial.mp4  (+ .srt e trilha.wav)

Não há tempos escritos aqui: cada cena dura o que durou a gravação, e cada fala entra no
instante que o gravar.mjs anotou em marcas.json (lá a fala comanda a ação). Para mudar o
ritmo, mude a cena em gravar.mjs e grave de novo.

A trilha é sintetizada aqui (acordes longos, sem melodia): não há arquivo de música de
terceiros no repositório, logo não há licença a conferir. Quer outra? Aponte TRILHA=arquivo.
"""
import json
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.environ.get("SAIDA", os.path.join(AQUI, "saida"))
FALAS = json.load(open(os.path.join(AQUI, "falas.json"), encoding="utf-8"))
MANIFESTO = json.load(open(os.path.join(SAIDA, "manifesto.json"), encoding="utf-8"))
MARCAS = json.load(open(os.path.join(SAIDA, "marcas.json"), encoding="utf-8"))
ENDERECO = os.environ.get("ENDERECO", "conserva-predial.vercel.app")
FUSAO = 0.4
FPS = 30
CENAS = ["problema", "marca", "registro", "atribuicao", "conclusao", "painel", "preventiva", "encerramento"]
# Linha de legenda: curta o bastante para se ler num celular, com a letra grande.
LARGURA = 40


def rodar(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def linha_do_tempo():
    cenas, t = [], 0.0
    for nome in CENAS:
        m = MARCAS.get(nome)
        if not m or "falas" not in m:
            sys.exit(f"cena {nome}: sem gravação. Rode o gravar.mjs.")
        dur = m["fim"] - m["inicio"]
        falas = [{"chave": f["chave"], "t": t + f["t"] - m["inicio"]} for f in m["falas"]]
        cenas.append({"clipe": nome, "de": m["inicio"], "dur": dur, "t": t, "falas": falas})
        t += dur - FUSAO
    total = t + FUSAO
    falas = [f for c in cenas for f in c["falas"]]
    for a, b in zip(falas, falas[1:]):
        if a["t"] + MANIFESTO[a["chave"]]["duracao"] - 0.35 > b["t"]:
            sys.exit(f"as falas {a['chave']} e {b['chave']} se atropelam: aumente a espera na cena.")
    faltando = set(FALAS) - {f["chave"] for f in falas}
    if faltando:
        sys.exit(f"falas sem cena: {sorted(faltando)}")
    if not 45 <= total <= 60:
        sys.exit(f"o vídeo ficou com {total:.1f}s; o pedido é de 45 a 60 s.")
    return cenas, total


def quebrar(texto):
    """Parte a fala em linhas curtas e equilibradas, respeitando a pontuação."""
    pedacos = [p.strip() for p in re.findall(r"[^,.:;?!]+[,.:;?!]*", texto) if p.strip()]
    # Pedaço curto ("No painel,") anda junto com o seguinte, a menos que feche a frase.
    juntos = []
    for p in pedacos:
        if juntos and len(juntos[-1]) < 16 and juntos[-1][-1] not in ".?!":
            juntos[-1] += " " + p
        else:
            juntos.append(p)
    linhas = []
    for p in juntos:
        n = -(-len(p) // LARGURA)  # quantas linhas, arredondando para cima
        alvo = len(p) / n
        feitas, atual = 0, ""
        for palavra in p.split():
            if atual and feitas < n - 1 and len(atual) + 1 + len(palavra) / 2 > alvo:
                linhas.append(atual)
                feitas += 1
                atual = palavra
            else:
                atual = f"{atual} {palavra}".strip()
        linhas.append(atual)
    return linhas


def legendas(cenas):
    # O instante de cada linha é proporcional ao número de letras: como cada fala começa num
    # instante medido e é curta, o erro fica em poucos décimos de segundo.
    trechos = []
    for c in cenas:
        for f in c["falas"]:
            voz = MANIFESTO[f["chave"]]["duracao"] - 0.35
            partes = quebrar(FALAS[f["chave"]])
            total = sum(len(p) for p in partes)
            t = f["t"]
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
            "Style: L,Inter,56,&H00FFFFFF,&H00FFFFFF,&H18331B0F,&H18331B0F,-1,0,0,0,100,100,0,0,3,16,0,2,80,80,48,1\n\n"
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
    for f in [f for c in cenas for f in c["falas"]]:
        k = n + len(vozes)
        entradas += ["-i", MANIFESTO[f["chave"]]["arquivo"]]
        ms = int(f["t"] * 1000)
        filtros.append(f"[{k}:a]aresample=48000,adelay={ms}|{ms}[a{k}]")
        vozes.append(f"[a{k}]")
    km = n + len(vozes)
    entradas += ["-i", musica]
    filtros.append(f"{''.join(vozes)}amix=inputs={len(vozes)}:normalize=0,highpass=f=70,"
                   "acompressor=threshold=-20dB:ratio=3:attack=5:release=120,volume=5dB,asplit[voz][chave]")
    # A trilha baixa quando a voz entra (sidechain) e nunca passa de fundo.
    filtros.append(f"[{km}:a]aresample=48000,volume=-20dB[m0];[m0][chave]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=500[m]")
    filtros.append(f"[voz][m]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9,atrim=duration={total:.3f}[a]")

    destino = os.path.join(SAIDA, "conserva-predial-comercial.mp4")
    rodar(*entradas, "-filter_complex", ";".join(filtros), "-map", "[v]", "-map", "[a]",
          "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS),
          "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", destino)
    print(f"✔ {destino}  ({total:.1f}s)")
    for c in cenas:
        print(f"  {c['t']:5.1f}s  {c['clipe']:<13}" + "".join(f" {f['chave']}@{f['t']:.1f}" for f in c["falas"]))
    conferir_qr(destino, total)


def conferir_qr(video, total):
    """Lê o QR Code de um quadro do vídeo pronto: tem de abrir o endereço do cartão final."""
    try:
        import cv2
    except ImportError:
        print("  QR Code não conferido (instale opencv-python-headless).")
        return
    quadro = os.path.join(SAIDA, "quadro-final.png")
    rodar("-ss", f"{total - 2:.2f}", "-i", video, "-frames:v", "1", quadro)
    lido, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.imread(quadro))
    if lido != f"https://{ENDERECO}":
        sys.exit(f"o QR Code do vídeo lê {lido!r}, e não https://{ENDERECO}.")
    print(f"  QR Code conferido no vídeo pronto: {lido}")


if __name__ == "__main__":
    main()

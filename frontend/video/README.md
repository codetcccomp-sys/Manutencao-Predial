# Vídeos: demonstração e parte técnica

Dois vídeos, gerados do zero por script, com legendas e, se o Kokoro estiver instalado,
com **narração em voz masculina** (português do Brasil):

- **Demonstração** (`npm run video`): o sistema em uso, solicitante → gestão → técnico →
  avaliação → relatórios → manutenção preventiva e etiquetas com QR Code → verificação em
  duas etapas → administração.
- **Parte técnica** (`npm run video:tecnico`, pasta `tecnico/`): slides narrados sobre
  arquitetura, esteira do backend, dados e migrações, segurança, frontend, testes e
  operação. Não precisa de banco nem de servidor; cada trecho de `tecnico/slides.html` com
  `data-fala` aparece junto com a fala de mesmo nome em `tecnico/falas.json`, e sai também
  um `.srt` com as legendas. Resultado em `tecnico/saida/conserva-predial-tecnico.mp4`.

```bash
cd frontend
npm run video
```

O resultado é `frontend/video/saida/conserva-predial-demonstracao.mp4` (cerca de 6
minutos, 1280×720).

Sem `ffmpeg` no sistema, o pacote `imageio-ffmpeg` (no mesmo `.venv` da voz) traz um
binário estático: `ln -s "$(.venv/bin/python -c 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())')" .venv/bin/ffmpeg`
e rode com `PATH="$PWD/video/.venv/bin:$PATH"`.

## O que ele faz, e por que é seguro rodar

`rodar.sh` cria um banco **descartável** (`smp_video`), migra, semeia 40 chamados **pela
API** (como o e2e faz: inserir por SQL criaria estados que a aplicação nunca produz) e só
depois espalha as datas (`datas.sql`), porque a API não deixa escolher a data de abertura
e sem isso o gráfico por dia seria um pico num único dia. Sobe o backend e a build, grava
com o Playwright e **desliga tudo ao sair**, mesmo se algo falhar.

Ele recusa rodar com `DATABASE_URL` ou `NODE_ENV=production`, ou com `DB_HOST` que não seja
local: o script cria contas e apaga o banco `smp_video`. As contas do roteiro
(`*@conserva.demo`, senha `senha123`, e o administrador `admin_video@exemplo.com`) existem
só nesse banco.

Precisa de: PostgreSQL local (o papel de `backend/.env` precisa poder criar bancos:
`ALTER ROLE smp_user CREATEDB;`), Chromium para o Playwright (`PLAYWRIGHT_CHROMIUM`, se não
for o que o `playwright install` baixou) e `ffmpeg` para gerar o MP4 (sem ele sai um
`.webm`).

## Narração

A voz é o [Kokoro](https://github.com/thewh1teagle/kokoro-onnx), um modelo aberto que
roda no próprio computador: nenhum texto sai da máquina. Voz `pm_alex` (a outra masculina
é `pm_santa`, com `VOZ=pm_santa`).

```bash
python3 -m venv frontend/video/.venv
frontend/video/.venv/bin/pip install kokoro-onnx soundfile
sudo apt install espeak-ng                      # a fonética do português

mkdir frontend/video/modelo && cd frontend/video/modelo
BASE=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
curl -LO $BASE/kokoro-v1.0.int8.onnx            # ~90 MB
curl -LO $BASE/voices-v1.0.bin                  # ~28 MB
```

Sem isso o vídeo sai só com legendas (ou force com `SEM_VOZ=1`).

**O texto falado** está em `falas.json`, uma entrada por legenda: a fala é escrita para ser
ouvida (siglas soletradas, como "P D F", frases inteiras), não a legenda lida em voz alta.
Mudou uma legenda em `gravar.mjs`? Mude a chave igual em `falas.json`, ou a gravação para
com "Fala sem áudio no manifesto".

Como a voz e a tela ficam sincronizadas: a síntese roda **antes** e mede a duração de cada
fala; a gravação espera cada uma terminar antes de mostrar a legenda seguinte; e a mistura
(`narrar.py misturar`) coloca cada fala no instante exato em que a legenda apareceu. Se
duas falas se sobrepuserem, a mistura falha em vez de entregar um áudio atropelado.

## Arquivos

| Arquivo | Para quê |
| --- | --- |
| `rodar.sh` | Orquestra tudo, e desliga os servidores ao sair |
| `semear.mjs` | Pessoas, locais e 40 chamados em todos os estados, pela API |
| `datas.sql` | Espalha os chamados por cerca de duas semanas, com prazos coerentes |
| `gravar.mjs` | O roteiro (cada legenda, clique e digitação) e a gravação |
| `falas.json` | O texto falado de cada legenda |
| `narrar.py` | Sintetiza a voz e monta a trilha de áudio (`FALAS` e `SAIDA` apontam para outro roteiro) |
| `tecnico/` | O vídeo técnico: `slides.html`, `falas.json`, `gravar.mjs`, `rodar.sh` |

`saida/`, `tecnico/saida/`, `modelo/` e `.venv/` não vão para o git.

## O que ninguém ouviu antes de você

A voz sintética foi verificada por duração, volume e ausência de sobreposição, mas **não
por ouvido**. Escute antes de usar: se alguma palavra sair estranha, mude a grafia em
`falas.json` (por exemplo, separar uma sigla em letras) e rode de novo; só as falas
alteradas custam tempo se você apagar `saida/manifesto.json`.

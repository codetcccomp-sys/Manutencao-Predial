# Vídeo comercial (60 s, 1920×1080)

Peça de apresentação para quem compra: abertura com o problema, a marca, três
funcionalidades em uso na interface real e o convite para agendar uma demonstração.
Resultado em `saida/conserva-predial-comercial.mp4`, com `.srt` ao lado.

## Roteiro

| Tempo | Cena | Imagem | Narração (`falas.json`) |
| --- | --- | --- | --- |
| 0–10 s | Abertura | Arte: a pergunta e, depois, três recados soltos (mensagem, telefone, corredor). Com `contexto/01–03.jpg`, as fotos entram por baixo | `abertura` |
| 10–18 s | Apresentação | Marca e nome; funde para o painel da gestão (tela real) | `apresentacao` |
| 18–28 s | 1 · Abrir chamado | Solicitante preenche o formulário e recebe o protocolo | `chamado` |
| 28–36 s | 2 · Painel da gestão | Indicadores "Sem técnico" e "Atrasados"; o clique filtra a lista | `painel` |
| 36–45 s | 3 · Preventiva | Plano cadastrado gera o chamado; a tela mostra a "Última execução" | `preventiva` |
| 45–60 s | Encerramento | Os três benefícios, depois marca, chamada e contato | `encerramento` |

Só entram funcionalidades que a tela mostra. Nada de cliente, número de resultado,
integração ou certificação: o vídeo não afirma o que o sistema não faz.

## Como gerar

Precisa do mesmo ambiente do vídeo de demonstração (`../README.md`): PostgreSQL local,
Chromium, `ffmpeg`, Kokoro e `espeak-ng`. Com a API de vídeo (porta 3333, banco
`smp_video`) e a build (porta 4173) no ar, como o `../rodar.sh` as sobe:

```bash
cd frontend
bash video/comercial/preparar.sh                       # recria e semeia o banco descartável
FALAS=$PWD/video/comercial/falas.json SAIDA=$PWD/video/comercial/saida \
  video/.venv/bin/python video/narrar.py sintetizar    # voz (só se as falas mudaram)
CONTATO="(11) 90000-0000 · exemplo.com.br" node video/comercial/gravar.mjs
video/.venv/bin/python video/comercial/montar.py
```

- **Contato**: vem de `CONTATO`. Sem ela o cartão final sai com `[ contato comercial ]`,
  de propósito: o repositório não guarda telefone de ninguém nem inventa um.
- **Só uma cena**: `node video/comercial/gravar.mjs video/comercial/saida encerramento`.
  As cenas `chamado` e `preventiva` escrevem no banco: rode o `preparar.sh` antes de regravá-las.
- **Playwright**: gravar exige navegador e ffmpeg da mesma versão dele. Se os do projeto
  não estiverem instalados, `PLAYWRIGHT_MODULO=/caminho/de/outro/playwright` usa outro.

## Imagens de contexto (opcionais)

A abertura funciona sem foto. Para usar imagens geradas (prédio, área técnica, equipe),
salve-as como `contexto/01.jpg`, `02.jpg` e `03.jpg` (16:9, 1920×1080 ou maior) e grave a
cena `abertura` de novo. Elas ficam atrás de um véu azul-marinho, com aproximação lenta.
Imagem gerada só entra aqui: tela do sistema é sempre gravação.

Sugestão de pedido (sem pessoas reconhecíveis, sem texto e sem logotipo na imagem):

1. *Fachada de um edifício comercial de porte médio no Brasil, fim de tarde, luz natural, fotografia documental, sem pessoas, sem letreiros.*
2. *Casa de máquinas de um prédio: bombas, tubulação e quadro elétrico, limpa e organizada, luz fria, fotografia documental, sem pessoas, sem texto.*
3. *Técnico de manutenção predial visto de costas, de uniforme e com EPI, conferindo um quadro elétrico num corredor de serviço, fotografia documental, sem texto.*

## O que conferir antes de publicar

- **Ouça a narração.** A voz (Kokoro, `pm_alex`) foi conferida por duração e volume, não por
  ouvido. Palavra estranha se corrige mudando a grafia em `falas.json`.
- As legendas são gravadas na imagem e têm de dizer o que se ouve: o `montar.py` para se
  `LEGENDAS` e `falas.json` divergirem.
- Os instantes das artes (abertura e encerramento) seguem as pausas da fala. Mudou a
  narração? Ajuste os atrasos em `gravar.mjs`.
- Nomes e chamados são do semeador (`*@conserva.demo`): dado fictício, nenhum real.
- A trilha é sintetizada pelo `montar.py` (sem música de terceiros). `TRILHA=arquivo` troca.

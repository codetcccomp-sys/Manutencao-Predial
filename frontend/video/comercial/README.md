# Vídeo comercial (45 a 60 s, 1920×1080)

Peça de apresentação para quem gerencia a manutenção de prédios: o problema, a marca, um
chamado do registro à conclusão, o painel da gestão, a preventiva e onde conhecer o sistema.
Resultado em `saida/conserva-predial-comercial.mp4`, com `.srt` ao lado.

## Roteiro

| Cena (`gravar.mjs`) | Imagem | Fala (`falas.json`) |
| --- | --- | --- |
| `problema` | Arte: a pergunta e três pedidos soltos, cada um quando é dito | `problema` |
| `marca` | Marca, nome, mensagem e "Gestão da manutenção predial" | `marca` |
| `registro` | Formulário já preenchido, envio e protocolo em destaque | `registro` |
| `atribuicao` | A gestão escolhe o técnico; o chamado mostra "Atribuído" e o prazo | `atribuicao` |
| `conclusao` | Descrição do serviço e EPI confirmados; o histórico com cada etapa | `conclusao` |
| `painel` | Um indicador por vez: sem técnico, atrasados, em aberto | `painel` |
| `preventiva` | O plano; depois "Gerar agora", com a confirmação da própria tela | `planos`, `gerar` |
| `encerramento` | Três benefícios; depois marca, endereço e QR Code | `beneficios`, `convite` |

**A fala comanda o tempo.** Cada cena anota quando a fala começa e só termina depois dela;
a imagem muda quando a palavra é dita (`quandoDisser`). O `montar.py` não tem tempos
escritos: usa `saida/marcas.json`. Para mudar o ritmo, mude a cena e grave de novo.

O que a narração afirma foi conferido no sistema:

- A preventiva **é** gerada sozinha: o agendador chama `/tarefas/gerar-preventivas` todo dia
  (`backend/vercel.json`). "Gerar agora" é a antecipação manual, e a tela diz isso.
- "Agende uma demonstração" não aparece: não existe canal de agendamento. A chamada é
  "Acesse e conheça o sistema", com o endereço publicado.
- Nada de cliente, número de resultado, integração ou certificação.

## Como gerar

Precisa do mesmo ambiente do vídeo de demonstração (`../README.md`): PostgreSQL local,
Chromium, `ffmpeg`, Kokoro e `espeak-ng`. Com a API de vídeo (porta 3333, banco
`smp_video`) e a build (porta 4173) no ar, como o `../rodar.sh` as sobe:

```bash
cd frontend
bash video/comercial/preparar.sh                       # recria e semeia o banco descartável
FALAS=$PWD/video/comercial/falas.json SAIDA=$PWD/video/comercial/saida \
  video/.venv/bin/python video/narrar.py sintetizar    # voz (antes de gravar: a cena precisa das durações)
node video/comercial/gravar.mjs
video/.venv/bin/python video/comercial/montar.py
```

- **Endereço e QR Code**: `ENDERECO` (padrão `conserva-predial.vercel.app`), no `gravar.mjs`
  e no `montar.py`. O `montar.py` lê o QR de um quadro do vídeo pronto e para se ele não
  abrir esse endereço (precisa de `opencv-python-headless` no `.venv`).
- **Só algumas cenas**: `node video/comercial/gravar.mjs video/comercial/saida painel`.
  `registro`, `atribuicao` e `conclusao` seguem o mesmo chamado e, com `preventiva`,
  escrevem no banco: rode o `preparar.sh` e grave as três juntas, nessa ordem.
- **Duração**: o `montar.py` para se o total sair de 45 a 60 s, se duas falas se
  atropelarem ou se alguma fala ficar sem cena.
- **Playwright**: gravar exige navegador e ffmpeg da mesma versão dele. Se os do projeto
  não estiverem instalados, `PLAYWRIGHT_MODULO=/caminho/de/outro/playwright` usa outro.

## Imagens de contexto (opcionais)

A abertura funciona sem foto. Para usar imagens geradas (prédio, área técnica, equipe),
salve-as como `contexto/01`, `02` e `03` (jpg, png ou webp; 16:9, 1920×1080 ou maior) e grave
a cena `problema` de novo. Confira a licença: imagem de plano gratuito costuma vir com marca
d'água e sem direito a uso comercial. Elas ficam atrás de um véu azul-marinho, com aproximação lenta.
Imagem gerada só entra aqui: tela do sistema é sempre gravação.

Sugestão de pedido (sem pessoas reconhecíveis, sem texto e sem logotipo na imagem):

1. *Fachada de um edifício comercial de porte médio no Brasil, fim de tarde, luz natural, fotografia documental, sem pessoas, sem letreiros.*
2. *Casa de máquinas de um prédio: bombas, tubulação e quadro elétrico, limpa e organizada, luz fria, fotografia documental, sem pessoas, sem texto.*
3. *Técnico de manutenção predial visto de costas, de uniforme e com EPI, conferindo um quadro elétrico num corredor de serviço, fotografia documental, sem texto.*

## O que conferir antes de publicar

- **Ouça a narração.** A voz (Kokoro, `pm_alex`) foi conferida por duração, volume e
  sobreposição, não por ouvido. Palavra estranha se corrige mudando a grafia em `falas.json`.
- A legenda é o texto da fala, quebrado em linhas pelo `montar.py`; o instante de cada linha
  é estimado pelo número de letras (erro de décimos de segundo).
- Nomes, e-mails e chamados são do semeador (`*@conserva.demo`): dado fictício, nenhum real.
- O endereço do cartão final é o do sistema em produção, e abre a tela de login.
- A trilha é sintetizada pelo `montar.py` (sem música de terceiros). `TRILHA=arquivo` troca.

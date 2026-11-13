# Apresentação (Fase 3)

> Roteiro de trabalho da equipe para os pitches de **02/12 e 09/12/2026**:
> 10 minutos, com slides e, se tudo estiver de pé, demonstração ao vivo. As
> senhas das contas de demonstração **não** ficam aqui nem em lugar nenhum do
> repositório; quem apresenta as recebe da equipe.

## O que mostrar ao vivo

Três contas de demonstração, uma por perfil, na ordem do caminho do chamado.
Cada passo é curto de propósito: a demonstração ilustra os slides, não os
substitui.

| Ordem | Conta | O que mostrar | Tempo |
| --- | --- | --- | --- |
| 1 | solicitante (`+demo.jorge`) | Meus pedidos; abrir um chamado com foto; o protocolo que aparece na hora | 1 min |
| 2 | gestor (`+demo.ana`) | O painel (sem técnico, atrasados); o chamado recém-aberto; triagem com urgência, impacto e risco; atribuir ao Paulo | 1 min 30 |
| 3 | técnico (`+demo.paulo`) | A fila com o chamado novo; iniciar, registrar diagnóstico e concluir com a descrição do serviço | 1 min |
| 4 | solicitante | O chamado concluído; avaliar com nota | 30 s |

Abra as três contas **antes** de começar, cada uma numa janela anônima
diferente: trocar de conta no meio da fala come o tempo que a demonstração
tem.

## Plano B

Se a rede da sala falhar ou o sistema não responder em 10 segundos, siga pelos
slides: eles têm as telas de cada perfil, e as notas do apresentador dizem o
que falar em cada uma. Não tente consertar na frente da banca.

## Checklist

### Uma semana antes (25/11)

- [ ] Código congelado: daqui em diante, só correção.
- [ ] Ensaio cronometrado, com a demonstração, em até 10 minutos.
- [ ] Entrar com as três contas de demonstração e com a do administrador.
- [ ] Teste de restauração do backup documentado (RNF04; ver `docs/piloto.md`).

### Na véspera (01/12 e 08/12)

- [ ] Abrir o sistema e o painel do Supabase: o plano gratuito pausa o banco
      depois de 7 dias sem uso, e acordá-lo leva minutos.
- [ ] Refazer os dados de apresentação com datas de hoje: `remover-apresentacao.sql` e depois
      `semear-apresentacao.sql`, ensaiando com `ROLLBACK` (ver `docs/apresentacao-na-producao.md`).
- [ ] Conferir no painel do gestor que há chamados no prazo **e** atrasados.
- [ ] Baixar o PDF dos slides para o computador da apresentação.

### No dia

- [ ] As três janelas anônimas abertas e logadas.
- [ ] Os slides abertos em modo apresentação, com o PDF como reserva.
- [ ] Um chamado "de palco" já pensado: título curto, local conhecido, foto no
      celular.

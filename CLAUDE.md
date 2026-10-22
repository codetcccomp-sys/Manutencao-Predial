# Conserva Predial — guia para quem mexe no código

Sistema de chamados de manutenção predial. API Express + PostgreSQL (`backend/`)
e PWA React/Vite (`frontend/`), publicados na Vercel, com o banco no Supabase.
O README tem o detalhe de cada área; este arquivo diz o que não se descobre
sem ler tudo, e o que **não** existe.

## Stack (a de verdade)

- **Backend**: Node 22 e 24 (`engines`; o CI testa as duas, e a Vercel roda 24), Express, `pg` com SQL cru. **Não há ORM nem Prisma.**
  O schema vive em `backend/database/migrations/NNN_*.sql`, aplicado por
  `database/migrate.js`.
- **Frontend**: React, Vite, Tailwind, React Router. **É PWA, não React
  Native**: nada de WatermelonDB; armazenamento local, se vier, é IndexedDB.
- **Testes**: Jest + Supertest (backend), Vitest + Testing Library (componentes),
  Playwright (ponta a ponta, projetos `computador` e `celular`).
- **Segurança**: sessão em cookie HttpOnly, 2FA por TOTP, CSP estrita
  (`style-src 'self'`: estilo escrito como texto no HTML é bloqueado).

## Comandos

```bash
# Backend (cd backend)
npm ci
npm run dev                      # http://localhost:3333
npm run migrate                  # aplica as pendentes
npm run migrate -- --status      # lista aplicadas e pendentes
npm test                         # toda a suíte, em série (usa o banco do .env)
npm run test:sla                 # só prazo, horas úteis e atraso
node tests/mutacao.js [texto]    # teste de mutação; filtra pela descrição

# Frontend (cd frontend)
npm ci
npm run dev                      # http://localhost:5173
npm test                         # Vitest
npm run build
npm run e2e                      # sobe API (3333) e preview (4173) sozinho
npm run mutacao -- [vitest|playwright|todas] [texto]
```

O e2e precisa das variáveis `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
`DB_PASSWORD`, `E2E_ADMIN_EMAIL` e `E2E_ADMIN_SENHA` (o administrador sai de
`node database/semear-admin.js`), e de `PLAYWRIGHT_CHROMIUM` quando o Chromium
já existe na máquina. Os valores do CI estão em `.github/workflows/ci.yml`.

Não existe `prisma:validate`. A validação do schema é o próprio `npm run migrate`
num banco limpo, mais `backend/tests/migracoes.test.js`.

## Regras de negócio como estão implementadas

- **Prioridade**: enum `baixa | media | alta | critica`. Sai da regra de
  priorização vigente (urgência, impacto e risco — `priorizacao.service`); a
  gestão pode divergir com justificativa.
- **Prazo (SLA)**: mora na tabela `sla` (`prazo_horas` e `contagem`, corridas ou
  úteis), nunca em constante no código. O valor vigente em produção veio da
  folha de validação da instituição: ver `docs/piloto.md` §2.4. Mudar o SLA só
  afeta chamados novos (o prazo é calculado na abertura).
- **Estados do chamado**: `aberto → em_triagem → atribuido → em_andamento ↔
  aguardando_material → concluido`, e `cancelado` (só a gestão cancela).
- **Conclusão** exige a descrição do serviço (RN07) **e a confirmação de uso de
  EPI** (`epi_confirmado: true`, gravada com quem e quando). Vale também para a
  preventiva. A reabertura zera a do chamado; a anterior fica na linha do tempo.
- **Alerta de primeiro atendimento**: chamado `critica`, `corretiva` e ainda em
  `aberto` há mais de 15 min aparece como alerta para a gestão (`sem_atendimento_critico`,
  calculado na consulta como `em_atraso`; faixa no Layout, selo no cartão, aviso
  no chamado). "Atendido" é sair de `aberto`. O 15 é a constante de
  `backend/src/config/atendimento.js`, não uma coluna de `sla`.
- **Equipamento**: tem só `ativo BOOLEAN`.
- **Sem conexão**: o service worker guarda as *leituras* (fila e chamado). Escrita
  falha na hora e a tela diz que nada foi registrado. É decisão deliberada
  (ver o cabeçalho de `frontend/public/sw.js`): sincronizar depois exigiria
  resolver conflito, e conflito mal resolvido vira registro de manutenção falso.

### Diretrizes recebidas e ainda não implementadas

Dependem de decisão do dono do projeto antes de qualquer código:

- Enum de ciclo de vida do ativo (`ATIVO`, `EM_MANUTENCAO`, `DEPRECIADO`,
  `DESCARTADO`) no lugar de `ativo BOOLEAN`. Sugestão: `EM_MANUTENCAO` derivado
  dos chamados abertos, não gravado.
- Fila local de escritas offline. Sugestão: só ações que apenas acrescentam
  (comentários), nunca mudança de estado.

## Convenções do repositório

- Comentário explica o **porquê**, em português, e cita a regra (RN07, RF04…).
- Toda trava nova ganha teste **e** mutação em `tests/mutacao.js` ou
  `testes/mutacao.mjs`. Mutação que passa despercebida é teste decorativo.
- Migração nova é aditiva e roda inteira numa transação. Em produção aplica-se
  pelo mesmo `migrate`, nunca colando SQL sem registrar em `migracao`; faça antes
  um ensaio com `BEGIN … ROLLBACK`.
- Teste novo entra em `docs/matriz-de-testes.md`, numa linha da seção da regra que ele
  prova (arquivo e título exato) ou na tabela "Outras suítes". O
  `backend/tests/matrizDeTestes.test.js` falha se a matriz citar o que não existe ou
  deixar um arquivo de teste de fora.
- As suítes do backend criam contas `@exemplo.com` e o teardown global as
  apaga. Teste que deixa chamado com data no passado **polui as médias** das
  suítes de relatório: apague o que criar, ou volte as datas juntas.
- **Dia é dia de Brasília, não de UTC.** O servidor e o banco rodam em UTC, e das
  21h à meia-noite em Brasília já é o dia seguinte lá (00h–03h UTC). Filtro por
  dia em coluna de instante usa `AT TIME ZONE` com `config/fuso.js`, nunca
  `::date` solto. Teste que depende de "hoje" só se prova num banco **vazio**
  e nessa janela: o banco de desenvolvimento, cheio de dados antigos, esconde o
  defeito, e o do CI, que nasce vazio, o mostra.
- O aviso de privacidade (`frontend/src/pages/Privacidade.jsx`) e `docs/lgpd.md`
  andam juntos: a página descreve o que o sistema faz. Mudou dado guardado, prazo,
  hospedagem ou contato? Mude os dois. Não nomeia controlador nem cita base legal
  enquanto a instituição não existir, e o teste impede que prometa o que não é feito.
  As funções do backend na Vercel ficam em `gru1` (`backend/vercel.json`), junto do
  banco em `sa-east-1`: sem isso a Vercel usa `iad1` e cada consulta cruza o
  continente (117 ms contra 2 ms, medido). O aviso afirma São Paulo, e um teste lê
  o `vercel.json` para que as duas coisas não se separem.
- **Há uma demonstração publicada** (`docs/demonstracao-publicada.md`): site, API e
  banco próprios, com dados fictícios. Os dois projetos da Vercel dela
  (`conserva-predial-demo`, pasta `demo/frontend`; `conserva-predial-demo-api`, pasta
  `backend`) seguem a `main`. Regras: nada é compartilhado com a produção, e
  `JWT_SECRET` e `CRON_SECRET` da demo são **valores novos**, nunca os da produção
  (o token é só `{id, sv}`: a mesma chave faria o token da demo valer na produção).
  O semeador (`frontend/video/semear.mjs`) e o workflow `demonstracao.yml` só escrevem
  num banco marcado como de demonstração (`backend/database/guarda-demonstracao.js`)
  e numa API que o confirma em `/health/db`; endereço novo do site da demo entra em
  `ORIGENS_EXTRAS` da API e em `demo/frontend/vercel.json`, nunca em `DOMINIOS_FIXOS`.
  `reiniciar-demonstracao.sql` apaga o schema inteiro e só roda no banco marcado.
- Tela nova entra na lista de `frontend/e2e/acessibilidade.spec.js`: o axe falha o e2e com
  violação de WCAG 2.2 AA. Texto não usa cinza cru do Tailwind (use os tokens: `contraste.test.js`
  barra), `<select>` e `<input>` levam rótulo, link dentro de frase leva `underline`, e rota nova
  ganha título em `frontend/src/dominio/titulosDeRota.js` (o teste confere cada rota do `App.jsx`).
  Não use `role="tab"` sem setas, `tabpanel` e `aria-controls`: grupo de botões com `aria-pressed`.
- Mexeu em tela: rode o e2e nos dois projetos. Ele já pegou alvo de toque
  pequeno e formulário vazando no celular que o jsdom não vê.

## Segredos e produção

- Senhas, `service_role` do Supabase, `CRON_SECRET` e `.env` nunca vão para chat,
  commit ou log. Quem administra digita direto no Supabase, GitHub ou Vercel.
- **O script `backend/database/limpar-demonstracao.sql` já rodou em produção, em
  12/10/2026. Não rode de novo lá: ele apaga todos os chamados, e desde então
  são reais** (`docs/piloto.md` §2.0). Serve para banco de demonstração ou de
  homologação.
- O cadastro da produção (37 locais da "Sede", 9 planos preventivos) é de teste,
  mantido para a apresentação, em dezembro de 2026. **Os planos estão desativados
  desde 12/10/2026** para não gerarem chamados de teste no meio do piloto. Para
  reativar, em cada plano ajuste a "Próxima execução" para uma data futura e só
  então marque ativo: com a data antiga, o agendador geraria chamados já vencidos
  (`docs/piloto.md` §2.0).
- `exigir_2fa_gestao` e `cadastro_exige_aprovacao` são chaves da tabela
  `configuracao`, ligadas pela tela de Usuários. Ligar muda quem consegue
  entrar: não é efeito colateral de deploy.

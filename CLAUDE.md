# Conserva Predial — guia para quem mexe no código

Sistema de chamados de manutenção predial. API Express + PostgreSQL (`backend/`)
e PWA React/Vite (`frontend/`), publicados na Vercel, com o banco no Supabase.
O README tem o detalhe de cada área; este arquivo diz o que não se descobre
sem ler tudo, e o que **não** existe.

## Stack (a de verdade)

- **Backend**: Node 22, Express, `pg` com SQL cru. **Não há ORM nem Prisma.**
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
- **Equipamento**: tem só `ativo BOOLEAN`.
- **Sem conexão**: o service worker guarda as *leituras* (fila e chamado). Escrita
  falha na hora e a tela diz que nada foi registrado. É decisão deliberada
  (ver o cabeçalho de `frontend/public/sw.js`): sincronizar depois exigiria
  resolver conflito, e conflito mal resolvido vira registro de manutenção falso.

### Diretrizes recebidas e ainda não implementadas

Dependem de decisão do dono do projeto antes de qualquer código:

- Alerta visual quando uma OS `CRÍTICA` passa de 15 min sem atendimento (é um
  relógio de primeiro atendimento, separado do prazo de resolução; falta
  definir o que conta como "atendida").
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
- As suítes do backend criam contas `@exemplo.com` e o teardown global as
  apaga. Teste que deixa chamado com data no passado **polui as médias** das
  suítes de relatório: apague o que criar, ou volte as datas juntas.
- **Dia é dia de Brasília, não de UTC.** O servidor e o banco rodam em UTC, e das
  21h à meia-noite em Brasília já é o dia seguinte lá (00h–03h UTC). Filtro por
  dia em coluna de instante usa `AT TIME ZONE` com `config/fuso.js`, nunca
  `::date` solto. Teste que depende de "hoje" só se prova num banco **vazio**
  e nessa janela: o banco de desenvolvimento, cheio de dados antigos, esconde o
  defeito, e o do CI, que nasce vazio, o mostra.
- Mexeu em tela: rode o e2e nos dois projetos. Ele já pegou alvo de toque
  pequeno e formulário vazando no celular que o jsdom não vê.

## Segredos e produção

- Senhas, `service_role` do Supabase, `CRON_SECRET` e `.env` nunca vão para chat,
  commit ou log. Quem administra digita direto no Supabase, GitHub ou Vercel.
- O script `backend/database/limpar-demonstracao.sql` não roda em produção sem a
  data do piloto e a lista de e-mails que ficam (`docs/piloto.md` §2.0).
- `exigir_2fa_gestao` e `cadastro_exige_aprovacao` são chaves da tabela
  `configuracao`, ligadas pela tela de Usuários. Ligar muda quem consegue
  entrar: não é efeito colateral de deploy.

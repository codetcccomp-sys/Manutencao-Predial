# Sistema de Manutenção Predial

Sistema de abertura e acompanhamento de chamados de manutenção predial, com
perfis de acesso, fluxo de atendimento auditado e relatórios de desempenho.

- **Backend**: Node/Express, PostgreSQL, autenticação JWT
- **Frontend**: React + Vite + Tailwind
- **Hospedagem**: Vercel (duas aplicações) com PostgreSQL no Supabase

## Perfis e permissões

| Perfil | O que enxerga | O que faz |
| --- | --- | --- |
| `solicitante` | os chamados que abriu | abre chamado, anexa arquivo, avalia o atendimento concluído |
| `tecnico` | os chamados designados a ele | muda estado, lança material consumido, anexa arquivo |
| `gestor` | todos os chamados | tudo acima, mais triagem, atribuição, cadastros e relatórios |
| `administrador` | todos os chamados | tudo acima, mais criação de usuários de qualquer perfil |

O cadastro público cria sempre `solicitante`. Os demais perfis só são criados
por um administrador autenticado — do contrário bastaria mandar
`"perfil": "administrador"` no corpo do cadastro para escalar privilégio.

## Fluxo do chamado

```
aberto → em_triagem → atribuido → em_andamento → concluido
                                       ↕
                              aguardando_material
```

Qualquer estado (menos `concluido`) pode ir para `cancelado`. As transições
são validadas no servidor, não só na interface, e cada mudança grava uma
linha em `historico_chamado`. O tempo parado em `aguardando_material` é
acumulado à parte e descontado das métricas de atendimento: é espera por
insumo, não trabalho da equipe.

## Como rodar

Requisitos: Node 22+ e PostgreSQL 16+.

```bash
# Banco
createdb smp

# Backend
cd backend
cp .env.example .env      # ajuste as credenciais
npm ci
npm run migrate           # cria/atualiza o schema
npm run dev               # http://localhost:3333

# Frontend, em outro terminal
cd frontend
npm ci
npm run dev               # http://localhost:5173
```

O frontend chama a API sempre pelo próprio domínio (`/api`): em
desenvolvimento o proxy do Vite encaminha para `localhost:3333`, em produção
um rewrite do `vercel.json` encaminha para o backend. Não há variável de
ambiente de URL da API para configurar, nem CORS no caminho.

## Migrações

O schema é versionado em `backend/database/migrations`, aplicado por
`npm run migrate`. Cada arquivo roda uma vez, dentro de uma transação, e fica
registrado na tabela `migracao`.

```bash
npm run migrate              # aplica as pendentes
npm run migrate -- --status  # lista aplicadas e pendentes
```

Para adotar o mecanismo num banco que já tem o schema criado por outro
caminho, use `--baseline=NNN` para marcar as migrações até `NNN` como
aplicadas sem executá-las.

## Testes

```bash
cd backend
npm test -- --runInBand
```

Os testes rodam contra um PostgreSQL de verdade, não contra mocks: o que está
sendo verificado inclui transação, bloqueio de linha, restrição de chave e
permissão — coisas que um mock de driver só simularia. `--runInBand` evita
que as suítes disputem o mesmo banco.

O CI (`.github/workflows/ci.yml`) sobe um PostgreSQL de serviço, aplica as
migrações pelo mesmo `npm run migrate` e roda a suíte, além de compilar o
frontend.

## Rotas

Todas exigem `Authorization: Bearer <token>`, exceto `/health`, `/health/db`,
`/auth/registrar` e `/auth/login`.

| Método | Rota | Quem |
| --- | --- | --- |
| `POST` | `/auth/registrar` | público (cria `solicitante`) |
| `POST` | `/auth/login` | público (limitado por tentativa) |
| `GET` | `/chamados?pagina=&limite=&estado=&categoria_id=` | autenticado, escopo conforme o perfil |
| `POST` | `/chamados` | solicitante, gestor, administrador |
| `GET` | `/chamados/:id` | quem tem acesso ao chamado |
| `PATCH` | `/chamados/:id/atribuir` | gestor, administrador |
| `PATCH` | `/chamados/:id/estado` | gestão ou técnico designado |
| `POST` | `/chamados/:id/avaliacao` | solicitante, chamado concluído |
| `GET POST DELETE` | `/chamados/:id/materiais` | gestão ou técnico designado (leitura: quem vê o chamado) |
| `GET POST DELETE` | `/chamados/:id/anexos` | quem tem acesso ao chamado |
| `GET` | `/notificacoes` | o próprio usuário |
| `GET POST PATCH` | `/equipes`, `/materiais` | leitura autenticada, escrita para gestão |
| `GET` | `/relatorios/resumo`, `/desempenho`, `/tecnicos` | gestor, administrador |

`GET /health/db` executa uma consulta e devolve 503 quando o banco está
inacessível — `/health` sozinho responde `ok` mesmo com o banco fora, o que
já escondeu falha de conexão em produção.

## Anexos

Aceita JPEG, PNG, WebP e PDF, até 4 MB. O tipo declarado pelo cliente não é
suficiente: o conteúdo é conferido pelos primeiros bytes do arquivo. O
conteúdo fica em `bytea` no próprio banco, porque o sistema de arquivos das
funções serverless é efêmero — um caminho gravado em disco apontaria para um
arquivo que já não existe na requisição seguinte. Se o volume crescer, o
passo seguinte é migrar para armazenamento de objetos.

## Notificações

Cada atribuição e cada mudança de estado grava uma notificação para o
usuário afetado. Se houver SMTP configurado, ela também vira e-mail; sem
SMTP, o envio vira registro em log e nada mais no sistema muda. O despacho
acontece depois do commit da transação: enquanto ela está aberta a
notificação ainda pode desaparecer num rollback, e avisar sobre algo que não
aconteceu é pior que não avisar.

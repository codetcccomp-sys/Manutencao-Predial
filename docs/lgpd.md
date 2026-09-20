# Dados pessoais e retenção

A RNF01 pede que a política de retenção esteja definida **antes da
homologação**. Este documento é o rascunho dela, levantado do banco de
produção e do código — não de um modelo genérico.

> **O que falta você decidir está marcado com 🔲.** São quatro pontos, e
> nenhum deles é técnico: dependem de quem responde pela instituição.
> O resto é descrição do que o sistema já faz, e pode ser conferido no código.

---

## 1. Que dados pessoais o sistema guarda

Levantado das tabelas em produção. "Pessoal" aqui inclui o que identifica uma
pessoa indiretamente, como o endereço de rede.

| Onde | O quê | Por que existe |
| --- | --- | --- |
| `usuario` | nome, e-mail, perfil, data de criação | Identificar quem pede e quem atende |
| `usuario` | `senha_hash` (bcrypt) | Autenticação. A senha em si não é guardada |
| `chamado` | quem abriu, quem atende, textos livres | O registro da manutenção |
| `comentario` | autor e texto livre | Conversa do chamado (RN03) |
| `historico_chamado` | quem mudou o estado e quando | Auditoria do fluxo (§2.4) |
| `avaliacao` | nota e comentário | RF09. Ligada ao chamado, não à pessoa |
| `anexo` | autor, nome do arquivo e **o arquivo** | Foto do problema |
| `notificacao` | destinatário e mensagem | Sino e e-mail |
| `equipe_tecnico` | quem está em qual equipe | Distribuição |
| `tentativa_login` | **e-mail e IP** de cada tentativa | Bloquear força bruta |
| `recuperacao_senha` | **IP** de quem pediu, hash do token | Rastrear pedido de troca de senha |

Dois pontos que passam despercebidos:

**Os anexos são fotos, e foto tem gente dentro.** Uma foto de sala alagada pode
pegar uma pessoa no enquadramento sem que ninguém tenha pensado nisso. O
arquivo fica no banco (`anexo.conteudo`), não num serviço externo.

**`tentativa_login` guarda o e-mail de quem tentou entrar e errou** — inclusive
de quem não tem conta. É dado pessoal de gente que nunca se cadastrou.

---

## 2. Por quanto tempo

O que o sistema **já apaga sozinho**, sem ninguém pedir:

| Dado | Prazo | Onde está no código |
| --- | --- | --- |
| Tentativas de login | **24 horas** | `middlewares/rateLimit.js` |
| Pedidos de redefinição de senha | **7 dias** | `services/recuperacao.service.js` |

O que **nunca é apagado**, por decisão de projeto:

- **Chamados, histórico, comentários, avaliações e anexos.** São registro de
  manutenção do patrimônio, e o sistema não tem exclusão em lugar nenhum: o
  primeiro chamado fica no histórico para sempre.
- **Contas de usuário.** Desativar (`ativo = false`) tira a pessoa do sistema
  mas preserva o que ela escreveu, para o histórico do chamado não ficar com
  buracos.

🔲 **Decidir: por quanto tempo o registro de manutenção deve ser guardado.**
Chamado costuma ter prazo próprio na instituição, ligado ao patrimônio.
Conta de pessoa desligada, não — e hoje ela fica indefinidamente.

---

## 3. Quem pode ver o quê

Isto já está no código e é verificado por teste; não é uma promessa.

| Perfil | Alcance |
| --- | --- |
| `solicitante` | Só os chamados que abriu |
| `tecnico` | Só os chamados designados a ele |
| `gestor` | Todos os chamados, relatórios e cadastros |
| `administrador` | Tudo, mais a criação de usuários |

O cadastro público cria sempre `solicitante`. Os demais perfis só saem da mão
de um administrador autenticado.

---

## 4. Base legal e responsável

🔲 **Base legal.** Em geral, execução de atividade da instituição — mas
confirme com quem responde por isso. Não é uma decisão de engenharia.

**Pessoa de contato para pedido de acesso ou exclusão:**

| | |
| --- | --- |
| Papel | Administrador principal do sistema |
| Contato | `code.tcc.comp@gmail.com` |

> Este documento vive num repositório privado. Se ele for publicado junto com
> o TCC, o endereço vai junto — vale trocá-lo por um institucional antes, ou
> tirar esta linha da versão pública.

🔲 **Nome completo do responsável.** Um documento formal de proteção de dados
precisa de uma pessoa nomeada, não só de um endereço.

---

## 5. O procedimento que o sistema não tem

**Desativar uma pessoa não apaga o que ela escreveu, e isso é proposital.**

Se a política exigir remoção de dados pessoais, ela vai precisar de um
procedimento explícito — anonimizar o nome e o e-mail, mantendo o chamado e o
histórico intactos. Hoje esse procedimento **não existe no sistema**.

Decidir isto antes é bem mais barato do que depois: anonimizar de verdade
significa mexer em `usuario`, nos textos livres de `comentario` e `avaliacao`
(onde alguém pode ter escrito o nome de outra pessoa) e nos anexos.

🔲 **Decidir: a política vai exigir remoção sob pedido?**
Se sim, é trabalho de código, e é melhor fazê-lo antes de haver dado real
para migrar.

---

## 6. O que fazer se houver vazamento

🔲 **Definir, mesmo que em três linhas**, quem é avisado e em que prazo.
Um plano escrito às pressas no dia do incidente não é um plano.

Dados úteis para esse plano:

- O banco é PostgreSQL gerenciado pelo Supabase, com backup automático.
- Só o `DATABASE_URL` dá acesso, e ele é variável de ambiente na Vercel,
  marcada como *sensitive*.
- Trocar a senha do banco invalida todas as sessões de aplicação, mas **não**
  os tokens JWT já emitidos: eles valem até expirar. Revogar de verdade exige
  trocar o `JWT_SECRET`, o que derruba todo mundo de uma vez — e é isso que se
  quer, num incidente.

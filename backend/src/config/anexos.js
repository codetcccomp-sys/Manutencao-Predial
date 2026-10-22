/**
 * Quanto anexo o sistema aceita.
 *
 * O plano gratuito do Supabase tem 500 MB de banco para tudo, e o anexo (em `bytea`, a
 * não ser que o Storage esteja ligado) é o que mais cresce: sem limite nenhum, uma conta
 * que anexasse em laço, ou um chamado com dezenas de fotos, enchia o banco e derrubava o
 * sistema inteiro, inclusive os chamados críticos. Dois freios:
 *
 * - `LIMITE_POR_CHAMADO`: nenhum chamado real precisa de mais que isso (a foto do problema,
 *   as do serviço feito, um laudo em PDF), e a conta é simples de explicar na tela.
 * - O uso do banco é medido e a gestão é avisada ao passar de `ALERTA_PERCENTUAL` do limite
 *   (ver `services/armazenamentoUso.service.js`), com tempo de ligar o Storage antes de
 *   o banco acabar.
 *
 * Mora aqui, e não na tabela `sla`, porque não é regra de negócio da instituição: é folga
 * da hospedagem. O limite do banco vem de `BANCO_LIMITE_MB`, para acompanhar um plano pago.
 */
const LIMITE_POR_CHAMADO = 10;
const ALERTA_PERCENTUAL = 70;
const BANCO_LIMITE_MB_PADRAO = 500;

module.exports = { LIMITE_POR_CHAMADO, ALERTA_PERCENTUAL, BANCO_LIMITE_MB_PADRAO };

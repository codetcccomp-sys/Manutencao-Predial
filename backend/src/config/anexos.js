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
 * RF03: os anexos entram "dentro de limites definidos pela administração". Quantos cabem
 * num chamado é dela (chave `anexos_por_chamado`, na tela de Usuários); `LIMITE_POR_CHAMADO`
 * é só o valor de quem nunca mexeu. O que a administração não escolhe é o teto: ele é
 * folga da hospedagem, e não regra da instituição. Com 20 anexos de até 4 MB, um chamado
 * já pode ocupar 80 MB de um banco de 500. O limite do banco vem de `BANCO_LIMITE_MB`,
 * para acompanhar um plano pago.
 */
const LIMITE_POR_CHAMADO = 10;
const LIMITE_POR_CHAMADO_MINIMO = 1;
const LIMITE_POR_CHAMADO_TETO = 20;
const ALERTA_PERCENTUAL = 70;
const BANCO_LIMITE_MB_PADRAO = 500;

module.exports = {
  LIMITE_POR_CHAMADO,
  LIMITE_POR_CHAMADO_MINIMO,
  LIMITE_POR_CHAMADO_TETO,
  ALERTA_PERCENTUAL,
  BANCO_LIMITE_MB_PADRAO,
};

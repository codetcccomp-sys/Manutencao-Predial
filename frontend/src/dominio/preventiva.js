/**
 * Vocabulário da manutenção preventiva e dos equipamentos, num lugar só.
 */

export const UNIDADES_REPETICAO = {
  dia: ['dia', 'dias'],
  semana: ['semana', 'semanas'],
  mes: ['mês', 'meses'],
  ano: ['ano', 'anos'],
};

/** "a cada mês", "a cada 3 meses" — a mesma frase que o backend escreve no histórico. */
export function descreverPeriodicidade(quantidade, unidade) {
  const formas = UNIDADES_REPETICAO[unidade];
  if (!formas) return '';
  return quantidade === 1 ? `a cada ${formas[0]}` : `a cada ${quantidade} ${formas[1]}`;
}

/**
 * Data de calendário ('2031-03-10') no formato daqui ('10/03/2031').
 *
 * Sem passar por `new Date`: '2031-03-10' é lido como meia-noite em UTC, que
 * em Brasília ainda é dia 9 — a data prevista apareceria um dia antes.
 */
export function formatarDia(dia) {
  if (!dia) return '';
  const [ano, mes, d] = String(dia).slice(0, 10).split('-');
  return `${d}/${mes}/${ano}`;
}

/** Hoje, como data de calendário no fuso de quem está usando. */
export function hojeLocal(agora = new Date()) {
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

export function rotuloLocal(local) {
  if (!local) return '';
  return [local.unidade, local.bloco, local.pavimento, local.setor, local.ambiente]
    .filter(Boolean)
    .join(' / ');
}

export function rotuloEquipamento(equipamento) {
  if (!equipamento) return '';
  return `${equipamento.codigo} — ${equipamento.nome}`;
}

/**
 * Há quanto tempo um chamado crítico está sem ninguém ter pegado.
 *
 * O servidor decide SE há alerta (`sem_atendimento_critico`, a regra de 15
 * minutos mora no backend); aqui só se diz há quanto tempo, a partir da data de
 * abertura, para o selo não mostrar um número parado enquanto a tela fica
 * aberta. O relógio é o do aparelho, como no resto das telas de prazo.
 */

/** Minutos inteiros desde a abertura, ou `null` se a data não for válida. */
export function minutosSemAtendimento(dataAberturaIso, agora = Date.now()) {
  const aberto = new Date(dataAberturaIso).getTime();
  if (Number.isNaN(aberto)) return null;
  return Math.max(0, Math.floor((agora - aberto) / 60_000));
}

/**
 * O tempo em palavras curtas: "23 min", "2 h 05 min", "1 d 3 h".
 *
 * As faixas acompanham o que a decisão pede: em minutos enquanto é minuto, em
 * horas e minutos até o dia virar, e depois só dias e horas (quem lê "1 d 3 h"
 * não precisa dos minutos).
 */
export function tempoEmPalavras(minutos) {
  if (minutos == null) return '';
  if (minutos < 60) return `${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) {
    const resto = minutos % 60;
    return resto === 0 ? `${horas} h` : `${horas} h ${String(resto).padStart(2, '0')} min`;
  }

  const dias = Math.floor(horas / 24);
  const horasDoDia = horas % 24;
  return horasDoDia === 0 ? `${dias} d` : `${dias} d ${horasDoDia} h`;
}

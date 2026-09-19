/**
 * Leitura de CSV.
 *
 * O arquivo que chega numa importação é, quase sempre, uma planilha exportada
 * por alguém — com BOM, com ponto e vírgula porque o Excel em português usa
 * vírgula como decimal, com aspas em volta do que tem separador dentro. Tratar
 * o texto com `split(',')` funciona no exemplo e quebra no arquivo real.
 *
 * Só leitura: a escrita vive em services/exportacao.service.js, onde também
 * mora a defesa contra fórmula, que é assunto de quem escreve.
 */

const SEPARADORES = [';', ',', '\t'];

/**
 * Descobre o separador pela linha de cabeçalho.
 *
 * Contar ocorrências basta porque o cabeçalho é de nomes de coluna, sem
 * separador dentro. A ordem da lista desempata: o ponto e vírgula vem primeiro
 * porque é o que o Excel brasileiro — e a própria exportação deste sistema —
 * produz.
 */
function detectarSeparador(cabecalho) {
  let escolhido = SEPARADORES[0];
  let maior = 0;
  for (const sep of SEPARADORES) {
    const quantas = cabecalho.split(sep).length - 1;
    if (quantas > maior) {
      maior = quantas;
      escolhido = sep;
    }
  }
  return escolhido;
}

/**
 * Converte o texto em registros, preservando o número da linha de origem.
 *
 * O número da linha é o que torna o relatório de erros utilizável: "linha 57"
 * é uma instrução para quem vai corrigir a planilha; "um dos registros é
 * inválido" não é.
 */
function analisar(texto) {
  // Normalizar as quebras antes do laço evita tratar \r\n, \n e \r em três
  // lugares diferentes. Dentro de aspas a troca é inofensiva: nenhum dos
  // campos que este sistema importa tem quebra de linha legítima.
  const limpo = String(texto)
    .replace(/^﻿/, '') // BOM que o Excel grava e que, sem remoção, vira parte do nome da primeira coluna
    .replace(/\r\n?/g, '\n');

  const separador = detectarSeparador(limpo.split('\n', 1)[0] || '');

  const registros = [];
  let campo = '';
  let valores = [];
  let dentroDeAspas = false;
  let linha = 1;
  let inicio = 1;

  function fecharRegistro() {
    valores.push(campo);
    // Linha em branco no fim do arquivo é resíduo de edição, não registro.
    if (valores.some((v) => v.trim() !== '')) {
      registros.push({ linha: inicio, valores });
    }
    campo = '';
    valores = [];
  }

  for (let i = 0; i < limpo.length; i += 1) {
    const c = limpo[i];

    if (dentroDeAspas) {
      if (c === '"') {
        // Aspas duplicadas são uma aspa literal — é assim que o CSV escapa.
        if (limpo[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          dentroDeAspas = false;
        }
      } else {
        if (c === '\n') linha += 1;
        campo += c;
      }
      continue;
    }

    if (c === '"' && campo === '') {
      dentroDeAspas = true;
    } else if (c === separador) {
      valores.push(campo);
      campo = '';
    } else if (c === '\n') {
      fecharRegistro();
      linha += 1;
      inicio = linha;
    } else {
      campo += c;
    }
  }

  if (campo !== '' || valores.length > 0) fecharRegistro();

  return { separador, registros };
}

module.exports = { analisar, detectarSeparador };

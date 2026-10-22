const anexosService = require('../services/anexos.service');
const chamadosService = require('../services/chamados.service');
const { asyncHandler } = require('../utils/asyncHandler');
const { AppError } = require('../middlewares/errorHandler');

const anexar = asyncHandler(async (req, res) => {
  // Quem enxerga o chamado pode anexar: o solicitante manda a foto do
  // problema, o técnico manda o registro do serviço.
  await chamadosService.garantirLeitura(req.params.id, req.usuario);
  const anexo = await anexosService.anexar(req.params.id, req.usuario.id, req.file);
  res.status(201).json({ anexo });
});

const listar = asyncHandler(async (req, res) => {
  await chamadosService.garantirLeitura(req.params.id, req.usuario);
  const anexos = await anexosService.listar(req.params.id);
  // O limite vai junto para a tela dizer "3 de 10" e desligar o envio no limite, sem copiar
  // o número no frontend.
  res.json({ anexos, limite: anexosService.LIMITE_POR_CHAMADO });
});

const baixar = asyncHandler(async (req, res) => {
  // A permissão é a do chamado a que o anexo pertence — checada a partir do
  // registro, não do que vem na URL, senão bastaria pedir /chamados/<meu>/
  // anexos/<id alheio> para ler o anexo de outra pessoa. E é checada antes de
  // buscar os bytes: com o arquivo no Storage, buscar primeiro seria ler um
  // objeto para quem não pode vê-lo.
  const registro = await anexosService.buscarMetadados(req.params.anexoId);
  await chamadosService.garantirLeitura(registro.chamado_id, req.usuario);
  const anexo = await anexosService.buscarConteudo(req.params.anexoId);

  res.set({
    'Content-Type': anexo.mime_type,
    'Content-Length': anexo.conteudo.length,
    // "attachment" e nosniff porque o conteúdo vem de usuário: servir inline
    // deixaria o navegador executar no domínio da aplicação o que ele
    // resolvesse interpretar como documento.
    'Content-Disposition': `attachment; filename="${encodeURIComponent(anexo.nome_arquivo)}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=0, no-store',
  });
  res.send(anexo.conteudo);
});

const remover = asyncHandler(async (req, res) => {
  const anexo = await anexosService.buscarMetadados(req.params.anexoId);
  await chamadosService.garantirLeitura(anexo.chamado_id, req.usuario);

  // Apagar não é o mesmo que ver: só quem enviou, ou a gestão, remove.
  const podeRemover =
    ['administrador', 'gestor'].includes(req.usuario.perfil) || anexo.usuario_id === req.usuario.id;

  if (!podeRemover) {
    throw new AppError('Apenas quem enviou o anexo, ou a gestão, pode removê-lo.', 403, 'ACESSO_NEGADO');
  }

  await anexosService.remover(req.params.anexoId);
  res.status(204).send();
});

module.exports = { anexar, listar, baixar, remover };

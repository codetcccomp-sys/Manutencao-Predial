const { asyncHandler } = require('../utils/asyncHandler');
const { filtroInteiro } = require('../middlewares/entrada');
const equipamentosService = require('../services/equipamentos.service');

const ehGestao = (usuario) => ['administrador', 'gestor'].includes(usuario.perfil);

const listar = asyncHandler(async (req, res) => {
  // Inativos só para a gestão, que os reativa na tela de cadastros. Para quem
  // abre chamado, equipamento desativado não existe mais.
  const equipamentos = await equipamentosService.listar({
    localId: filtroInteiro(req.query.local_id, 'local_id'),
    incluirInativos: ehGestao(req.usuario) && req.query.incluir_inativos === 'true',
    busca: req.query.busca,
  });
  res.json({ equipamentos });
});

const buscarPorCodigo = asyncHandler(async (req, res) => {
  res.json({ equipamento: await equipamentosService.buscarPorCodigo(req.params.codigo) });
});

const buscarPorId = asyncHandler(async (req, res) => {
  // A ficha traz o histórico de chamados do equipamento, que inclui chamados
  // de outras pessoas: é da gestão e dos técnicos. O solicitante recebe só o
  // cadastro — o que ele precisa para abrir o chamado.
  const equipamento =
    req.usuario.perfil === 'solicitante'
      ? await equipamentosService.buscar(req.params.id)
      : await equipamentosService.ficha(req.params.id);
  res.json({ equipamento });
});

const criar = asyncHandler(async (req, res) => {
  res.status(201).json({ equipamento: await equipamentosService.criar(req.body) });
});

const atualizar = asyncHandler(async (req, res) => {
  res.json({ equipamento: await equipamentosService.atualizar(req.params.id, req.body) });
});

module.exports = { listar, buscarPorCodigo, buscarPorId, criar, atualizar };

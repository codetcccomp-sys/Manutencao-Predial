const { Router } = require('express');
const categoriasController = require('../controllers/categorias.controller');
const { authenticate } = require('../middlewares/auth');

const router = Router();

router.use(authenticate);
router.get('/', categoriasController.listar);

module.exports = router;

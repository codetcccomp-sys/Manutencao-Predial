const { AppError } = require('../middlewares/errorHandler');

function validate(schema) {
  return (req, res, next) => {
    const erros = [];

    for (const [campo, regras] of Object.entries(schema)) {
      const valor = req.body[campo];

      if (regras.obrigatorio && (valor === undefined || valor === null || valor === '')) {
        erros.push(`Campo "${campo}" é obrigatório.`);
        continue;
      }

      if (valor === undefined || valor === null) continue;

      if (regras.tipo === 'string' && typeof valor !== 'string') {
        erros.push(`Campo "${campo}" deve ser texto.`);
      }
      if (regras.tipo === 'number' && typeof valor !== 'number') {
        erros.push(`Campo "${campo}" deve ser numérico.`);
      }
      if (regras.enum && !regras.enum.includes(valor)) {
        erros.push(`Campo "${campo}" deve ser um de: ${regras.enum.join(', ')}.`);
      }
      if (regras.minLength && typeof valor === 'string' && valor.length < regras.minLength) {
        erros.push(`Campo "${campo}" deve ter ao menos ${regras.minLength} caracteres.`);
      }
      if (regras.maxLength && typeof valor === 'string' && valor.length > regras.maxLength) {
        erros.push(`Campo "${campo}" deve ter no máximo ${regras.maxLength} caracteres.`);
      }
      // Faixa numérica: sem isso, um valor fora do permitido só era barrado
      // pelo CHECK do banco, que chega aqui como erro interno (500) em vez
      // de erro de validação (422).
      if (regras.min !== undefined && typeof valor === 'number' && valor < regras.min) {
        erros.push(`Campo "${campo}" deve ser no mínimo ${regras.min}.`);
      }
      if (regras.max !== undefined && typeof valor === 'number' && valor > regras.max) {
        erros.push(`Campo "${campo}" deve ser no máximo ${regras.max}.`);
      }
      if (regras.email && typeof valor === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) {
        erros.push(`Campo "${campo}" deve ser um e-mail válido.`);
      }
    }

    if (erros.length > 0) {
      return next(new AppError(erros.join(' '), 422, 'VALIDACAO'));
    }

    next();
  };
}

module.exports = { validate };

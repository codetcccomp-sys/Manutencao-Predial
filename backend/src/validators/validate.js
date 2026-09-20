const { AppError } = require('../middlewares/errorHandler');

function validate(schema) {
  return (req, res, next) => {
    const erros = [];

    for (const [campo, regras] of Object.entries(schema)) {
      // Espaço em volta de um e-mail é quase sempre resíduo de copiar e colar,
      // não intenção. Antes isso batia na regra de formato e voltava "deve ser
      // um e-mail válido", mensagem que não ajuda quem não vê o espaço. O
      // valor é aparado aqui, na fronteira, para que o resto da requisição já
      // trabalhe com a forma limpa.
      //
      // `aparar` estende a mesma ideia a nome de pessoa, de categoria, de
      // equipe. Espaço no fim de um nome não significa nada e atravessa o
      // sistema inteiro: reaparece no cabeçalho, na autoria do comentário e
      // no "Olá, Fulano ." do e-mail. E "Elétrica " ao lado de "Elétrica"
      // são duas categorias que ninguém consegue distinguir na tela.
      //
      // Aparar ANTES de medir `minLength` é o ponto: medindo o valor cru,
      // três espaços passariam por um mínimo de três caracteres e chegariam
      // ao banco como nome vazio.
      if ((regras.email || regras.aparar) && typeof req.body[campo] === 'string') {
        req.body[campo] = req.body[campo].trim();
      }

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

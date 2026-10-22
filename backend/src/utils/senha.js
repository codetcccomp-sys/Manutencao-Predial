const { AppError } = require('../middlewares/errorHandler');

/**
 * A regra de senha nova (RF01).
 *
 * O mínimo era 6 caracteres, e o que segurava o resto era o limite de tentativas de login.
 * Mas senha fraca cai antes de qualquer limite: a lista das mais usadas é a primeira coisa
 * que quem ataca tenta. Dois freios, e nenhuma regra de composição:
 *
 * - 10 caracteres ou mais: o comprimento é o que mais custa a quem adivinha, e vale mais que
 *   "uma maiúscula e um símbolo", que só leva as pessoas a "Senha@123".
 * - Fora de uma lista curta das mais comuns (em português e em inglês), e das triviais
 *   (um caractere repetido, sequência de dígitos, o próprio e-mail).
 *
 * Só vale para senha NOVA (cadastro, conta criada pela administração, redefinição). Quem já
 * tem senha de 6 a 9 caracteres continua entrando: o login não confere o tamanho.
 */
const MINIMO = 10;

const COMUNS = new Set([
  '1234567890', '12345678910', '123456789012', '0123456789', '9876543210', '1234512345',
  '1111111111', '0000000000', '1212121212', '1231231234', '123456789a', 'abcdefghij',
  'qwertyuiop', 'qwertyuiop1', 'qwertyuiop123', 'asdfghjkl1', 'asdfghjklç', '1q2w3e4r5t',
  '1q2w3e4r5t6y', 'qazwsxedc1', 'zxcvbnm123', 'password10', 'password12', 'password123',
  'password1234', 'passw0rd123', 'iloveyou12', 'senha12345', 'senha123456', 'senha1234567',
  'senhasenha', 'minhasenha', 'minhasenha1', 'minhasenha12', 'minhasenha123', 'mudar12345',
  'mudar123456', 'trocar1234', 'trocar12345', 'brasil1234', 'brasil12345', 'brasil2020',
  'brasil2024', 'brasil2025', 'brasil2026', 'conserva123', 'conserva1234', 'conservapredial',
  'predial1234', 'predial12345', 'manutencao', 'manutencao1', 'manutencao12', 'manutencao123',
  'manutencao1234', 'chamado1234', 'chamados123', 'administrador', 'administrador1',
  'administrador123', 'admin12345', 'admin123456', 'abc1234567', 'abcd123456', 'teste12345',
  'teste123456', 'bemvindo123', 'bemvindo12', 'bomdia1234', 'amorzinho1', 'flamengo123',
  'corinthians', 'corinthians1', 'palmeiras1', 'saopaulo123',
]);

function trivial(senha) {
  if (/^(.)\1+$/.test(senha)) return true; // um caractere repetido
  if (!/^\d+$/.test(senha)) return false;
  // Só dígitos em sequência, para cima ou para baixo (de 1234567890 a 9876543210, em qualquer ponto).
  const passos = [...senha].map((c, i, todos) => (i ? Number(c) - Number(todos[i - 1]) : null)).slice(1);
  return passos.every((p) => p === 1 || p === -9) || passos.every((p) => p === -1 || p === 9);
}

function senhaFraca(senha, email) {
  const texto = String(senha).toLowerCase();
  if (COMUNS.has(texto) || trivial(texto)) return true;
  const mail = String(email || '').trim().toLowerCase();
  return Boolean(mail) && (texto === mail || texto === mail.split('@')[0]);
}

/** Recusa a senha nova que não presta. 422 com o motivo, na língua de quem digitou. */
function validarSenhaNova(senha, { email } = {}) {
  if (String(senha ?? '').length < MINIMO) {
    throw new AppError(`A senha precisa ter ao menos ${MINIMO} caracteres.`, 422, 'SENHA_FRACA');
  }
  if (senhaFraca(senha, email)) {
    throw new AppError('Essa senha é muito comum ou fácil de adivinhar. Escolha outra.', 422, 'SENHA_FRACA');
  }
}

module.exports = { validarSenhaNova, MINIMO };

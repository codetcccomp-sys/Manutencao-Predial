/**
 * O mínimo da senha nova (RF01), no mesmo número do servidor (backend/src/utils/senha.js).
 *
 * O servidor é quem decide (e também recusa as senhas comuns); este número só evita mandar
 * ao servidor uma senha que ele recusaria, e diz a regra na tela antes do erro. Sem regra de
 * composição de propósito: "uma frase" é mais fácil de lembrar e mais difícil de adivinhar que
 * "uma maiúscula e um símbolo", que só leva a "Senha@123".
 */
export const MINIMO_SENHA = 10;

export const AJUDA_SENHA = `Ao menos ${MINIMO_SENHA} caracteres. Uma frase com algumas palavras serve.`;

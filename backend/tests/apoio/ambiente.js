/**
 * Roda antes de cada suíte (jest `setupFiles`).
 *
 * O cadastro público tem teto por IP (middlewares/rateLimit.js), e as suítes criam centenas de
 * contas pelo mesmo endereço de loopback. Sem folga, a décima primeira conta de qualquer suíte
 * receberia 429. O login resolve o mesmo problema dando um IP a cada suíte (apoio/ip.js); aqui
 * o cadastro é aberto por inteiro, e só tests/cadastroSeguro.test.js aperta os tetos de volta
 * para provar o limite.
 */
process.env.CADASTRO_MAX_POR_IP = '1000000';
process.env.CADASTRO_MAX_POR_DIA = '1000000';

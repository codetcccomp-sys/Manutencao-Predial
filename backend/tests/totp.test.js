const { base32, codigoNoPasso, verificar, gerarSegredo, passoDe, enderecoOtpauth } = require('../src/utils/totp');

/**
 * O código do autenticador conferido contra os vetores do RFC 6238 (apêndice
 * B, SHA-1). Se a conta estiver errada, o 2FA trava todo mundo para fora —
 * ou, pior, aceita o código errado.
 */
const SEGREDO_RFC = base32(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('no instante %i s o código de 8 dígitos é %s', (segundos, esperado) => {
    expect(codigoNoPasso(SEGREDO_RFC, Math.floor(segundos / 30), 8)).toBe(esperado);
  });

  it('aceita o código do passo atual e dos vizinhos, e devolve em qual bateu', () => {
    const agora = 1_700_000_000_000;
    const passo = passoDe(agora);
    expect(verificar(SEGREDO_RFC, codigoNoPasso(SEGREDO_RFC, passo), agora)).toBe(passo);
    expect(verificar(SEGREDO_RFC, codigoNoPasso(SEGREDO_RFC, passo - 1), agora)).toBe(passo - 1);
    expect(verificar(SEGREDO_RFC, codigoNoPasso(SEGREDO_RFC, passo + 1), agora)).toBe(passo + 1);
  });

  it('recusa código de dois passos atrás, e qualquer coisa que não sejam seis dígitos', () => {
    const agora = 1_700_000_000_000;
    const passo = passoDe(agora);
    expect(verificar(SEGREDO_RFC, codigoNoPasso(SEGREDO_RFC, passo - 2), agora)).toBeNull();
    expect(verificar(SEGREDO_RFC, '12345', agora)).toBeNull();
    expect(verificar(SEGREDO_RFC, 'abcdef', agora)).toBeNull();
    expect(verificar(SEGREDO_RFC, undefined, agora)).toBeNull();
  });

  it('espaços que o aplicativo mostra no meio do código não atrapalham', () => {
    const agora = 1_700_000_000_000;
    const codigo = codigoNoPasso(SEGREDO_RFC, passoDe(agora));
    expect(verificar(SEGREDO_RFC, `${codigo.slice(0, 3)} ${codigo.slice(3)}`, agora)).toBe(passoDe(agora));
  });

  it('segredo novo tem 160 bits em base32', () => {
    expect(gerarSegredo()).toMatch(/^[A-Z2-7]{32}$/);
    expect(gerarSegredo()).not.toBe(gerarSegredo());
  });

  it('o endereço otpauth leva emissor e conta, para o app mostrar de quem é', () => {
    const uri = enderecoOtpauth('JBSWY3DPEHPK3PXP', 'ana@exemplo.com', 'Conserva Predial');
    expect(uri).toBe(
      'otpauth://totp/Conserva%20Predial%3Aana%40exemplo.com?secret=JBSWY3DPEHPK3PXP&issuer=Conserva+Predial&algorithm=SHA1&digits=6&period=30'
    );
  });
});

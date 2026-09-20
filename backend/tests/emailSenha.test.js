const { senhaLimpa } = require('../src/services/email.service');

/**
 * A limpeza da senha de SMTP.
 *
 * Existe porque o erro que ela evita é indistinguível a olho nu: o Gmail
 * responde `535 BadCredentials` tanto para senha errada quanto para senha
 * certa com um espaço sobrando. Quem cadastrou corretamente vai procurar o
 * problema na conta do Google, não no campo — foi o que aconteceu aqui.
 */
describe('Limpeza da senha de SMTP', () => {
  it('tira os espaços de uma senha de app do Google colada da tela', () => {
    // O Google mostra as 16 letras em quatro blocos de quatro, e quem copia
    // da tela leva os espaços junto.
    expect(senhaLimpa('abcd efgh ijkl mnop')).toBe('abcdefghijklmnop');
  });

  it('apara o que veio junto do copiar e colar', () => {
    // Um \n no fim não aparece em campo de senha nenhum, e a Vercel guarda o
    // valor exatamente como chegou.
    expect(senhaLimpa('  abcdefghijklmnop\n')).toBe('abcdefghijklmnop');
    expect(senhaLimpa(' abcd efgh ijkl mnop ')).toBe('abcdefghijklmnop');
  });

  it('não mexe numa senha que já está limpa', () => {
    expect(senhaLimpa('abcdefghijklmnop')).toBe('abcdefghijklmnop');
  });

  it('preserva o espaço de uma frase-senha de outro provedor', () => {
    // Só o formato exato da senha de app do Google perde os espaços. Senha de
    // verdade pode conter espaço, e apagá-los sempre quebraria quem usa outro
    // servidor com uma frase-senha.
    expect(senhaLimpa('cavalo bateria grampo correto')).toBe('cavalo bateria grampo correto');
    expect(senhaLimpa('Uma Senha Com Espaco')).toBe('Uma Senha Com Espaco');
    // Quatro blocos, mas não de quatro letras: não é o formato do Google.
    expect(senhaLimpa('abc defg hijk lmno')).toBe('abc defg hijk lmno');
    // Maiúsculas não aparecem em senha de app do Google.
    expect(senhaLimpa('ABCD EFGH IJKL MNOP')).toBe('ABCD EFGH IJKL MNOP');
  });

  it('aguenta valor ausente sem explodir', () => {
    // Sem SMTP_USER o nodemailer nem recebe `auth`, mas a função não pode ser
    // a que derruba o processo se alguém a chamar antes.
    expect(senhaLimpa(undefined)).toBe('');
    expect(senhaLimpa(null)).toBe('');
  });
});

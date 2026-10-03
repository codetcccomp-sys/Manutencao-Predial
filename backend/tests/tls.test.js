const fs = require('fs');
const { certificadoDaAutoridade, configuracaoTls, CAMINHO_CA } = require('../src/config/tls');

/**
 * De onde vem o certificado do banco, e o que acontece quando ele vem torto.
 *
 * O caso que motivou estes testes: o `.env.example` mostra o PEM numa linha
 * só, com `\n` escrito por extenso — que é como painéis de variável de
 * ambiente costumam aceitar. Nada expande essas sequências. O TLS do Node
 * recebia o texto com barra e "n" literais, não achava certificado dentro e
 * seguia com zero autoridades confiáveis, sem reclamar: toda conexão com o
 * banco falhava, a API inteira caía, e o erro não apontava para o formato da
 * variável. Conferido antes do conserto: `X509Certificate` recusa esse texto
 * com ERR_OSSL_PEM_NO_START_LINE, e `tls.createSecureContext` o aceita calado.
 */

const PEM = fs.readFileSync(CAMINHO_CA, 'utf8');
const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe('DB_CA_CERT', () => {
  it('aceita o PEM com quebras de linha de verdade', () => {
    process.env.DB_CA_CERT = PEM;
    expect(certificadoDaAutoridade()).toContain('-----BEGIN CERTIFICATE-----\n');
  });

  it('aceita o PEM numa linha só, com \\n escrito por extenso', () => {
    const umaLinha = PEM.trim().split('\n').join('\\n');
    expect(umaLinha).not.toContain('\n'); // de fato uma linha só
    process.env.DB_CA_CERT = umaLinha;

    const ca = certificadoDaAutoridade();
    // Devolvido com quebras reais — que é o que o TLS consegue ler.
    expect(ca.split('\n').length).toBeGreaterThan(10);
    expect(ca).not.toContain('\\n');
  });

  it('recusa na subida um valor que não é certificado, em vez de cair a cada consulta', () => {
    process.env.DB_CA_CERT = 'isto não é um certificado';
    expect(() => certificadoDaAutoridade()).toThrow(/não contém um certificado PEM válido/);
  });

  it('sem a variável, usa o arquivo do repositório', () => {
    delete process.env.DB_CA_CERT;
    expect(certificadoDaAutoridade()).toBe(PEM);
  });
});

describe('configuracaoTls', () => {
  it('com certificado, verifica cadeia e hostname', () => {
    delete process.env.DB_CA_CERT;
    expect(configuracaoTls()).toEqual({ ca: PEM, rejectUnauthorized: true });
  });
});

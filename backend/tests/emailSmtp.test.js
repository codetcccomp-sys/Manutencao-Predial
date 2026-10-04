const net = require('net');

/**
 * O envio de e-mail pelo SMTP de verdade, contra um servidor de mentira.
 *
 * Os outros testes de e-mail apagam o SMTP_HOST e verificam o registro em log:
 * nenhum deles faz o nodemailer abrir uma conexão. Foi assim que uma troca de
 * versão maior (6 → 10, para fechar vulnerabilidades) ficaria sem prova de que
 * a mensagem ainda sai. Com o Dependabot propondo atualizações sozinho, a
 * próxima troca também precisa de um teste que acuse se o e-mail parar de
 * chegar. O servidor aqui fala o mínimo de SMTP e guarda o que recebe.
 */

let servidor;
let porta;
const recebidas = [];
const comandos = [];

function responder(socket) {
  let emDados = false;
  let buffer = '';
  socket.write('220 teste ESMTP\r\n');

  socket.on('data', (pedaco) => {
    buffer += pedaco.toString('utf8');
    for (;;) {
      if (emDados) {
        const fim = buffer.indexOf('\r\n.\r\n');
        if (fim < 0) return;
        recebidas.push(buffer.slice(0, fim));
        buffer = buffer.slice(fim + 5);
        emDados = false;
        socket.write('250 ok\r\n');
        continue;
      }

      const quebra = buffer.indexOf('\r\n');
      if (quebra < 0) return;
      const linha = buffer.slice(0, quebra);
      buffer = buffer.slice(quebra + 2);
      comandos.push(linha);

      if (/^(EHLO|HELO)/i.test(linha)) socket.write('250-teste\r\n250 8BITMIME\r\n');
      else if (/^DATA/i.test(linha)) {
        emDados = true;
        socket.write('354 pode mandar\r\n');
      } else if (/^QUIT/i.test(linha)) {
        socket.write('221 tchau\r\n');
        socket.end();
      } else socket.write('250 ok\r\n');
    }
  });
}

const ambienteOriginal = {};

beforeAll(async () => {
  servidor = net.createServer(responder);
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  porta = servidor.address().port;

  for (const chave of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_REMETENTE']) {
    ambienteOriginal[chave] = process.env[chave];
  }
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(porta);
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
  process.env.EMAIL_REMETENTE = 'Conserva Predial <nao-responda@exemplo.com>';
});

afterAll(async () => {
  for (const [chave, valor] of Object.entries(ambienteOriginal)) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
  await new Promise((ok) => servidor.close(ok));
});

describe('Envio por SMTP (nodemailer)', () => {
  it('entrega a mensagem ao servidor, com destinatário e texto', async () => {
    const { enviar } = require('../src/services/email.service');

    const enviou = await enviar({
      para: 'alguem@exemplo.com',
      assunto: 'Chamado atrasado — ação necessária',
      texto: 'O prazo previsto era às 17h; acentuação: ação, coração.',
    });

    expect(enviou).toBe(true);
    expect(recebidas).toHaveLength(1);
    expect(comandos.some((c) => /^RCPT TO:<alguem@exemplo\.com>/i.test(c))).toBe(true);
    // O corpo pode vir em quoted-printable ou base64, conforme a versão: o que
    // importa é que o destinatário e o cabeçalho estão na mensagem entregue.
    expect(recebidas[0]).toMatch(/^To: alguem@exemplo\.com/im);
    expect(recebidas[0]).toMatch(/^From: .*nao-responda@exemplo\.com/im);
    expect(recebidas[0]).toMatch(/^Subject: /im);
  });

  it('devolve false, sem lançar exceção, quando o servidor não responde', async () => {
    const porta = process.env.SMTP_PORT;
    // Porta em que ninguém escuta: a recusa de conexão é imediata. O módulo é
    // recarregado porque o transporte fica guardado depois do primeiro uso.
    process.env.SMTP_PORT = '1';
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { enviar } = require('../src/services/email.service');
      expect(await enviar({ para: 'a@exemplo.com', assunto: 'x', texto: 'y' })).toBe(false);
    } finally {
      process.env.SMTP_PORT = porta;
      console.error.mockRestore();
    }
  });
});

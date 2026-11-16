const net = require('net');
const request = require('supertest');

/**
 * O sistema percebe sozinho quando o servidor de e-mail recusa a senha.
 *
 * O Gmail recusou a senha de app três vezes até 16/11/2026 (ela cai quando a senha da conta do
 * Google muda). Nas três, o envio falhava só no log, que na Vercel dura uma hora, e quem
 * descobria era alguém sem o link de "esqueci minha senha". Aqui, um servidor SMTP de mentira
 * aceita ou recusa o login, e o teste confere que a recusa vira `falhando` na saúde das tarefas
 * (painel da gestão e conferência diária do GitHub), na hora do envio e na conferência de hora
 * em hora.
 */

let servidor;
let porta;
let recusarLogin = false;
let logins = 0;

function responder(socket) {
  let buffer = '';
  let emDados = false;
  socket.write('220 teste ESMTP\r\n');
  socket.on('data', (pedaco) => {
    buffer += pedaco.toString('utf8');
    for (;;) {
      if (emDados) {
        const fim = buffer.indexOf('\r\n.\r\n');
        if (fim < 0) return;
        buffer = buffer.slice(fim + 5);
        emDados = false;
        socket.write('250 ok\r\n');
        continue;
      }
      const quebra = buffer.indexOf('\r\n');
      if (quebra < 0) return;
      const linha = buffer.slice(0, quebra);
      buffer = buffer.slice(quebra + 2);
      if (/^(EHLO|HELO)/i.test(linha)) socket.write('250-teste\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (/^AUTH/i.test(linha)) {
        logins += 1;
        socket.write(
          recusarLogin
            ? '535-5.7.8 Username and Password not accepted.\r\n535 5.7.8 BadCredentials\r\n'
            : '235 2.7.0 Accepted\r\n'
        );
      } else if (/^DATA/i.test(linha)) {
        emDados = true;
        socket.write('354 pode mandar\r\n');
      } else if (/^QUIT/i.test(linha)) {
        socket.write('221 tchau\r\n');
        socket.end();
      } else socket.write('250 ok\r\n');
    }
  });
}

const SEGREDO = 'segredo-da-conferencia-de-email';
const ambienteOriginal = {};
let pool;

beforeAll(async () => {
  servidor = net.createServer(responder);
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  porta = servidor.address().port;
  for (const chave of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_REMETENTE', 'CRON_SECRET']) {
    ambienteOriginal[chave] = process.env[chave];
  }
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(porta);
  process.env.SMTP_USER = 'conta@exemplo.com';
  process.env.SMTP_PASSWORD = 'senha-de-app-de-teste';
  process.env.EMAIL_REMETENTE = 'Conserva Predial <nao-responda@exemplo.com>';
  process.env.CRON_SECRET = SEGREDO;
  jest.resetModules();
  pool = require('../src/config/db');
});

beforeEach(async () => {
  recusarLogin = false;
  logins = 0;
  await pool.query("DELETE FROM execucao_tarefa WHERE tarefa = 'conferir-email'");
});

afterAll(async () => {
  await pool.query("DELETE FROM execucao_tarefa WHERE tarefa = 'conferir-email'");
  for (const [chave, valor] of Object.entries(ambienteOriginal)) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
  await new Promise((ok) => servidor.close(ok));
});

const situacaoDoEmail = async () =>
  (await require('../src/services/execucoes.service').saude()).find((t) => t.tarefa === 'conferir-email');

describe('Conferência do servidor de e-mail', () => {
  it('login aceito: a tarefa fica ok, sem mandar mensagem nenhuma', async () => {
    const { conferirSeVencida } = require('../src/services/conferenciaEmail.service');
    expect(await conferirSeVencida()).toEqual({ conferido: true });
    expect(logins).toBe(1);
    const email = await situacaoDoEmail();
    expect(email.situacao).toBe('ok');
    expect(email.ultimo_resumo).toEqual({ configurado: true });
  });

  it('senha recusada: a tarefa fica falhando, com a resposta do servidor', async () => {
    recusarLogin = true;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { conferirSeVencida } = require('../src/services/conferenciaEmail.service');
      const resultado = await conferirSeVencida();
      expect(resultado.conferido).toBe(true);
      expect(resultado.erro).toMatch(/535/);
    } finally {
      console.error.mockRestore();
    }
    const email = await situacaoDoEmail();
    expect(email.situacao).toBe('falhando');
    expect(email.ultimo_erro).toMatch(/BadCredentials/);
  });

  it('com sucesso há menos de uma hora, não faz login de novo', async () => {
    const { conferirSeVencida } = require('../src/services/conferenciaEmail.service');
    await conferirSeVencida();
    expect(await conferirSeVencida()).toEqual({ conferido: false });
    expect(logins).toBe(1);
  });

  it('com sucesso há mais de uma hora, confere de novo', async () => {
    const { conferirSeVencida } = require('../src/services/conferenciaEmail.service');
    await pool.query(
      `INSERT INTO execucao_tarefa (tarefa, iniciada_em, terminada_em, sucesso)
       VALUES ('conferir-email', now() - interval '61 minutes', now() - interval '61 minutes', TRUE)`
    );
    expect(await conferirSeVencida()).toEqual({ conferido: true });
    expect(logins).toBe(1);
  });

  it('depois de uma falha, confere a cada passagem, e a senha nova tira o aviso na seguinte', async () => {
    const { conferirSeVencida } = require('../src/services/conferenciaEmail.service');
    recusarLogin = true;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await conferirSeVencida();
    } finally {
      console.error.mockRestore();
    }
    expect((await situacaoDoEmail()).situacao).toBe('falhando');

    recusarLogin = false;
    expect(await conferirSeVencida()).toEqual({ conferido: true });
    expect((await situacaoDoEmail()).situacao).toBe('ok');
  });

  it('falha depois de um sucesso recente: confere já na passagem seguinte, sem esperar a hora', async () => {
    const { conferirSeVencida } = require('../src/services/conferenciaEmail.service');
    const execucoes = require('../src/services/execucoes.service');
    await conferirSeVencida();
    // Um envio recusado minutos depois da conferência boa (a senha caiu no meio da hora).
    await execucoes.registrarFalha('conferir-email', '535 5.7.8 BadCredentials');
    expect((await situacaoDoEmail()).situacao).toBe('falhando');

    // A senha nova já está na Vercel: o aviso sai na passagem seguinte, não uma hora depois.
    expect(await conferirSeVencida()).toEqual({ conferido: true });
    expect(logins).toBe(2);
    expect((await situacaoDoEmail()).situacao).toBe('ok');
  });

  it('um envio de verdade recusado vira falha na hora, sem esperar a conferência', async () => {
    recusarLogin = true;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { enviar } = require('../src/services/email.service');
      // Transporte novo: o anterior guardou a conexão do teste de cima.
      expect(await enviar({ para: 'alguem@exemplo.com', assunto: 'x', texto: 'y' })).toBe(false);
    } finally {
      console.error.mockRestore();
    }
    const email = await situacaoDoEmail();
    expect(email.situacao).toBe('falhando');
    expect(email.ultimo_erro).toMatch(/535/);
  });

  it('servidor fora do ar no envio não é senha recusada: fica para a conferência', async () => {
    const original = process.env.SMTP_PORT;
    process.env.SMTP_PORT = '1';
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { enviar } = require('../src/services/email.service');
      expect(await enviar({ para: 'alguem@exemplo.com', assunto: 'x', texto: 'y' })).toBe(false);
    } finally {
      process.env.SMTP_PORT = original;
      console.error.mockRestore();
      jest.resetModules();
      pool = require('../src/config/db');
    }
    expect((await situacaoDoEmail()).situacao).toBe('nunca');
  });

  it('sem SMTP configurado não há o que conferir, e isso não é falha', async () => {
    const host = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    try {
      const { conferirSeVencida } = require('../src/services/conferenciaEmail.service');
      await conferirSeVencida();
    } finally {
      process.env.SMTP_HOST = host;
    }
    expect(logins).toBe(0);
    const email = await situacaoDoEmail();
    expect(email.situacao).toBe('ok');
    expect(email.ultimo_resumo).toEqual({ configurado: false });
  });

  it('a passagem de 15 minutos confere o e-mail, e a falha dele não derruba o aviso de atraso', async () => {
    recusarLogin = true;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = require('../src/app');
      const resp = await request(app).post('/tarefas/notificar-atrasos').set('Authorization', `Bearer ${SEGREDO}`);
      expect(resp.status).toBe(200);
    } finally {
      console.error.mockRestore();
    }
    expect(logins).toBe(1);
    expect((await situacaoDoEmail()).situacao).toBe('falhando');
  });

  it('a saúde das tarefas (conferência do GitHub) confere o e-mail antes de responder', async () => {
    recusarLogin = true;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    let resp;
    try {
      const app = require('../src/app');
      resp = await request(app).get('/tarefas/saude').set('Authorization', `Bearer ${SEGREDO}`);
    } finally {
      console.error.mockRestore();
    }
    expect(resp.status).toBe(200);
    const email = resp.body.tarefas.find((t) => t.tarefa === 'conferir-email');
    expect(email).toMatchObject({ situacao: 'falhando', rotulo: 'Envio de e-mail' });
  });
});

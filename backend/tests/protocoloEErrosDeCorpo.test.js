const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { gerarProtocolo } = require('../src/utils/protocolo');

/**
 * Duas pontas soltas de "dia é dia de Brasília" e de mensagens em português.
 *
 * O protocolo leva a data de abertura, e o servidor roda em UTC: das 21h à meia-noite
 * em Brasília já é o dia seguinte lá. E o `express.json()` levanta erros antes de a
 * rota existir, com a mensagem crua da biblioteca, em inglês.
 */

afterAll(async () => {
  await pool.end();
});

describe('Protocolo', () => {
  it('leva a data de Brasília, não a de UTC', () => {
    // 22h de 31/12 em Brasília é 01h de 01/01 em UTC: o protocolo é do ano velho.
    expect(gerarProtocolo(new Date('2027-01-01T01:00:00Z'))).toMatch(/^SMP-20261231-[0-9A-F]{6}$/);
    // 02:59 UTC ainda é 23:59 em Brasília; 03:00 UTC é a meia-noite de lá.
    expect(gerarProtocolo(new Date('2027-01-01T02:59:59Z'))).toMatch(/^SMP-20261231-/);
    expect(gerarProtocolo(new Date('2027-01-01T03:00:00Z'))).toMatch(/^SMP-20270101-/);
  });

  it('no meio do dia as duas datas coincidem', () => {
    expect(gerarProtocolo(new Date('2026-10-21T15:00:00Z'))).toMatch(/^SMP-20261021-/);
  });

  it('o sufixo muda a cada protocolo', () => {
    const agora = new Date('2026-10-21T15:00:00Z');
    expect(gerarProtocolo(agora)).not.toBe(gerarProtocolo(agora));
  });
});

describe('Erros de corpo da requisição', () => {
  it('um envio grande demais volta em português, dizendo o que fazer', async () => {
    const grande = 'a'.repeat(300 * 1024);

    const resp = await request(app).post('/auth/login').send({ email: 'a@exemplo.com', senha: grande });

    expect(resp.status).toBe(413);
    expect(resp.body.erro.codigo).toBe('CORPO_GRANDE');
    expect(resp.body.erro.mensagem).toMatch(/Divida o arquivo/);
    expect(resp.body.erro.mensagem).not.toMatch(/entity/i);
  });

  it('um JSON quebrado volta em português, sem o texto interno do analisador', async () => {
    const resp = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "a@exemplo.com", ');

    expect(resp.status).toBe(400);
    expect(resp.body.erro.codigo).toBe('JSON_INVALIDO');
    expect(resp.body.erro.mensagem).toBe('O conteúdo enviado não é um JSON válido.');
  });
});

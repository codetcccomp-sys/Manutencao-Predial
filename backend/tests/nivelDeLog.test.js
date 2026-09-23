const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

afterAll(async () => {
  await pool.end();
});

/**
 * Onde cada desfecho é registrado.
 *
 * Tudo saía como `console.error`. Nos logs de produção do piloto, "Token
 * inválido ou expirado" aparecia marcado como ERRO sete vezes, em sete
 * requisições de gente usando o sistema normalmente: um JWT expirar é o
 * combinado, não um defeito.
 *
 * O custo não é o ruído em si — é que marcar o esperado como erro faz o
 * inesperado deixar de se destacar. O painel de erros vira uma lista de
 * acontecimentos normais, e o dia em que algo quebrar de verdade a linha que
 * importa entra no meio dela sem chamar atenção nenhuma.
 */

function espiarLog() {
  return {
    erro: jest.spyOn(console, 'error').mockImplementation(() => {}),
    aviso: jest.spyOn(console, 'warn').mockImplementation(() => {}),
  };
}

describe('4xx é recusa, não erro', () => {
  it('token expirado não vai para o fluxo de erro', async () => {
    const log = espiarLog();
    try {
      const resp = await request(app)
        .get('/chamados')
        .set('Authorization', 'Bearer isto-nao-e-um-token');

      expect(resp.status).toBe(401);
      expect(log.erro).not.toHaveBeenCalled();
      expect(log.aviso.mock.calls.flat().join(' ')).toContain('401');
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('campo faltando também não', async () => {
    const log = espiarLog();
    try {
      const resp = await request(app).post('/auth/login').send({ email: 'sem@senha.com' });

      expect(resp.status).toBe(422);
      expect(log.erro).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe('5xx é nosso, e precisa do stack', () => {
  it('registra o stack, não só a mensagem', async () => {
    const log = espiarLog();
    // Uma falha de verdade no caminho: o pool recusa a consulta, e o handler
    // recebe um erro que não é AppError.
    const consulta = jest.spyOn(pool, 'query').mockRejectedValue(new Error('banco caiu'));
    try {
      // Rota pública e que consulta o banco: sem autenticação no caminho, o
      // 401 não chega antes do 500 que se quer observar. E sem limitador, o
      // `console.error` que o limitador emite ao falhar não se mistura com o
      // que está sendo medido aqui.
      const resp = await request(app)
        .post('/auth/registrar')
        .send({ nome: 'Quem Quer Que Seja', email: 'quebra@exemplo.com', senha: 'senha123' });

      expect(resp.status).toBe(500);
      expect(log.erro).toHaveBeenCalled();

      const registrado = log.erro.mock.calls.flat().join('\n');
      // `err.message` sozinho diz "banco caiu" e não diz de onde. Quem for
      // consertar às duas da manhã precisa da pilha.
      expect(registrado).toContain('banco caiu');
      expect(registrado).toMatch(/\bat\b.*\d+:\d+/);
    } finally {
      consulta.mockRestore();
      jest.restoreAllMocks();
    }
  });
});

const pool = require('../src/config/db');
const { transacao } = require('../src/config/transacao');

afterAll(async () => {
  await pool.end();
});

describe('transacao', () => {
  it('confirma as escritas quando a função conclui', async () => {
    const nome = `commit_${Date.now()}`;

    await transacao(async (client) => {
      await client.query('INSERT INTO categoria (nome) VALUES ($1)', [nome]);
    });

    const { rows } = await pool.query('SELECT id FROM categoria WHERE nome = $1', [nome]);
    expect(rows).toHaveLength(1);

    await pool.query('DELETE FROM categoria WHERE nome = $1', [nome]);
  });

  it('desfaz as escritas anteriores quando a função lança', async () => {
    const nome = `rollback_${Date.now()}`;

    await expect(
      transacao(async (client) => {
        await client.query('INSERT INTO categoria (nome) VALUES ($1)', [nome]);
        throw new Error('falha depois da primeira escrita');
      })
    ).rejects.toThrow('falha depois da primeira escrita');

    const { rows } = await pool.query('SELECT id FROM categoria WHERE nome = $1', [nome]);
    expect(rows).toHaveLength(0);
  });

  it('devolve a conexão ao pool mesmo após erro', async () => {
    // Mais iterações que o tamanho do pool: se o client não fosse liberado no
    // finally, as conexões acabariam e a query final ficaria pendurada.
    for (let i = 0; i < 15; i += 1) {
      await expect(
        transacao(async () => {
          throw new Error('falha');
        })
      ).rejects.toThrow('falha');
    }

    const { rows } = await pool.query('SELECT 1 AS ok');
    expect(rows[0].ok).toBe(1);
  });
});

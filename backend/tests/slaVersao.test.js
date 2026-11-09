const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { ipDaSuite } = require('./apoio/ip');
const { criarUsuarioELogar } = require('./apoio/contas');

/**
 * RN12: a política de prazos tem versão e data de vigência.
 *
 * Alterar o SLA apagava o valor anterior: sobrava a data da última mudança, sem
 * o que valia antes nem quem mudou.
 */
const IP = ipDaSuite(__filename);

let gestor;
let tecnico;
let original;

const versoesDe = async (prioridade) =>
  (await pool.query('SELECT * FROM sla_versao WHERE prioridade = $1 ORDER BY vigente_desde, id', [prioridade])).rows;
const alterar = (prioridade, corpo, quem = gestor) =>
  request(app).patch(`/sla/${prioridade}`).set(quem.cabecalho).send(corpo);

beforeAll(async () => {
  gestor = await criarUsuarioELogar('gestor', { ip: IP, rotulo: 'rn12' });
  tecnico = await criarUsuarioELogar('tecnico', { ip: IP, rotulo: 'rn12' });
  original = (await pool.query("SELECT prazo_horas, contagem, atualizado_em FROM sla WHERE prioridade = 'baixa'")).rows[0];
});

afterAll(async () => {
  // As outras suítes medem prazo com o SLA que encontram: devolve o valor e
  // tira as versões criadas aqui (as contas `@exemplo.com` são apagadas no fim).
  await pool.query(
    "UPDATE sla SET prazo_horas = $1, contagem = $2, atualizado_em = $3 WHERE prioridade = 'baixa'",
    [original.prazo_horas, original.contagem, original.atualizado_em]
  );
  await pool.query('DELETE FROM sla_versao WHERE alterado_por = ANY($1)', [[gestor.usuario.id]]);
  await pool.end();
});

describe('RN12: versões do SLA', () => {
  it('a migração registra, para cada prioridade, o prazo que já valia', async () => {
    const { rows } = await pool.query(
      `SELECT s.prioridade
         FROM sla s
        WHERE NOT EXISTS (SELECT 1 FROM sla_versao v WHERE v.prioridade = s.prioridade)`
    );

    expect(rows).toEqual([]);
  });

  it('alterar o prazo cria uma versão com o valor novo, a vigência e quem alterou', async () => {
    const antes = await versoesDe('baixa');
    const novo = original.prazo_horas + 7;

    const resp = await alterar('baixa', { prazo_horas: novo });
    const depois = await versoesDe('baixa');
    const versao = depois[depois.length - 1];

    expect(resp.status).toBe(200);
    expect(depois).toHaveLength(antes.length + 1);
    expect(versao).toMatchObject({ prazo_horas: novo, contagem: original.contagem, alterado_por: gestor.usuario.id });
    expect(new Date(versao.vigente_desde).getTime()).toBe(new Date(resp.body.sla.atualizado_em).getTime());
  });

  it('mudar só a contagem também é uma versão, e guarda o prazo que continuou valendo', async () => {
    const atual = (await pool.query("SELECT prazo_horas, contagem FROM sla WHERE prioridade = 'baixa'")).rows[0];
    const outra = atual.contagem === 'uteis' ? 'corridas' : 'uteis';

    await alterar('baixa', { contagem: outra });
    const depois = await versoesDe('baixa');

    expect(depois[depois.length - 1]).toMatchObject({ prazo_horas: atual.prazo_horas, contagem: outra });
  });

  it('reenviar o mesmo valor não cria versão nem mexe na data da última alteração', async () => {
    const atual = (await pool.query("SELECT prazo_horas, contagem, atualizado_em FROM sla WHERE prioridade = 'baixa'")).rows[0];
    const antes = await versoesDe('baixa');

    const resp = await alterar('baixa', { prazo_horas: atual.prazo_horas, contagem: atual.contagem });

    expect(resp.status).toBe(200);
    expect(await versoesDe('baixa')).toHaveLength(antes.length);
    expect(new Date(resp.body.sla.atualizado_em).getTime()).toBe(new Date(atual.atualizado_em).getTime());
  });

  it('alteração recusada não cria versão', async () => {
    const antes = await versoesDe('baixa');

    const resp = await alterar('baixa', { prazo_horas: 0 });

    expect(resp.status).toBe(422);
    expect(await versoesDe('baixa')).toHaveLength(antes.length);
  });

  it('o histórico vem do mais recente para o mais antigo, com o autor e o fim da vigência', async () => {
    // Uma versão de OUTRA prioridade, mais nova que todas: o fim da vigência é
    // contado dentro da mesma prioridade, e ela não pode encerrar a da baixa.
    await pool.query(
      `INSERT INTO sla_versao (prioridade, prazo_horas, contagem, vigente_desde, alterado_por)
       VALUES ('media', 41, 'uteis', now() + interval '1 minute', $1)`,
      [gestor.usuario.id]
    );

    const resp = await request(app).get('/sla/historico').set(gestor.cabecalho);
    const daBaixa = resp.body.versoes.filter((v) => v.prioridade === 'baixa');

    expect(resp.status).toBe(200);
    // A mais recente é a que vale: não tem fim. A anterior termina onde ela começa.
    expect(daBaixa[0].vigente_ate).toBeNull();
    expect(daBaixa[0].alterado_por).toBe('Teste gestor');
    expect(new Date(daBaixa[1].vigente_ate).getTime()).toBe(new Date(daBaixa[0].vigente_desde).getTime());
    expect(daBaixa.map((v) => new Date(v.vigente_desde).getTime())).toEqual(
      daBaixa.map((v) => new Date(v.vigente_desde).getTime()).sort((a, b) => b - a)
    );
  });

  it('o histórico é da gestão: técnico recebe 403', async () => {
    const resp = await request(app).get('/sla/historico').set(tecnico.cabecalho);

    expect(resp.status).toBe(403);
  });

  // O deploy leva o código; a migração 032 só vale depois de `npm run migrate`
  // na produção. Nesse intervalo a tabela não existe.
  describe('antes da migração 032 (tabela ausente)', () => {
    beforeAll(() => pool.query('ALTER TABLE sla_versao RENAME TO sla_versao_ausente'));
    afterAll(() => pool.query('ALTER TABLE sla_versao_ausente RENAME TO sla_versao'));

    it('alterar o prazo continua funcionando: o prazo é gravado, sem versão', async () => {
      const atual = (await pool.query("SELECT prazo_horas FROM sla WHERE prioridade = 'baixa'")).rows[0].prazo_horas;

      const resp = await alterar('baixa', { prazo_horas: atual + 1 });
      const depois = (await pool.query("SELECT prazo_horas FROM sla WHERE prioridade = 'baixa'")).rows[0].prazo_horas;

      expect(resp.status).toBe(200);
      expect(depois).toBe(atual + 1);
    });

    it('o histórico responde vazio, e não erro', async () => {
      const resp = await request(app).get('/sla/historico').set(gestor.cabecalho);

      expect(resp.status).toBe(200);
      expect(resp.body.versoes).toEqual([]);
    });
  });

  it('a tabela não é acessível pela API pública do Supabase (papéis anon e authenticated)', async () => {
    const { rows } = await pool.query(
      `SELECT grantee FROM information_schema.role_table_grants
        WHERE table_name = 'sla_versao' AND grantee IN ('anon', 'authenticated')`
    );

    expect(rows).toEqual([]);
  });
});

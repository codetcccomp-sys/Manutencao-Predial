const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const emailService = require('../src/services/email.service');

let solicitante;
let tecnico;
let gestor;
let chamadoId;

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_not_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Notif ${perfil}`, email, senha: 'senha123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').send({ email, senha: 'senha123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

beforeAll(async () => {
  solicitante = await criarUsuarioELogar('solicitante');
  tecnico = await criarUsuarioELogar('tecnico');
  gestor = await criarUsuarioELogar('gestor');

  const local = await pool.query("INSERT INTO local (unidade) VALUES ('Unidade Notif') RETURNING id");
  const categoria = await pool.query('SELECT id FROM categoria LIMIT 1');

  const abertura = await request(app)
    .post('/chamados')
    .set('Authorization', `Bearer ${solicitante.token}`)
    .send({
      titulo: 'Chamado com notificação',
      descricao: 'Descrição do chamado',
      categoria_id: categoria.rows[0].id,
      local_id: local.rows[0].id,
    });
  chamadoId = abertura.body.chamado.id;
});

afterAll(async () => {
  await pool.end();
});

describe('Despacho de e-mail das notificações', () => {
  it('não quebra o fluxo quando o SMTP não está configurado', async () => {
    delete process.env.SMTP_HOST;
    expect(emailService.estaConfigurado()).toBe(false);

    const triagem = await request(app)
      .patch(`/chamados/${chamadoId}/estado`)
      .set('Authorization', `Bearer ${gestor.token}`)
      .send({ estado: 'em_triagem' });

    // A mudança de estado é o pedido; o aviso é efeito colateral. Sem SMTP,
    // o pedido tem de continuar valendo.
    expect(triagem.status).toBe(200);
    expect(triagem.body.chamado.estado).toBe('em_triagem');

    const { rows } = await pool.query(
      'SELECT email_enviado_em FROM notificacao WHERE chamado_id = $1 ORDER BY id DESC LIMIT 1',
      [chamadoId]
    );
    expect(rows[0].email_enviado_em).toBeNull();
  });

  it('marca email_enviado_em quando o envio dá certo', async () => {
    const enviarOriginal = emailService.enviar;
    const chamadas = [];
    emailService.enviar = async (mensagem) => {
      chamadas.push(mensagem);
      return true;
    };

    try {
      const resp = await request(app)
        .patch(`/chamados/${chamadoId}/atribuir`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ tecnico_id: tecnico.usuario.id });
      expect(resp.status).toBe(200);

      expect(chamadas).toHaveLength(1);
      expect(chamadas[0].para).toBe(tecnico.usuario.email);
      expect(chamadas[0].assunto).toContain(resp.body.chamado.protocolo);

      const { rows } = await pool.query(
        "SELECT email_enviado_em FROM notificacao WHERE chamado_id = $1 AND tipo = 'atribuicao'",
        [chamadoId]
      );
      expect(rows[0].email_enviado_em).not.toBeNull();
    } finally {
      emailService.enviar = enviarOriginal;
    }
  });

  it('não marca como enviado quando o envio falha, e ainda assim conclui o pedido', async () => {
    const enviarOriginal = emailService.enviar;
    emailService.enviar = async () => false;

    try {
      const resp = await request(app)
        .patch(`/chamados/${chamadoId}/estado`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ estado: 'em_andamento' });

      expect(resp.status).toBe(200);

      const { rows } = await pool.query(
        'SELECT email_enviado_em FROM notificacao WHERE chamado_id = $1 ORDER BY id DESC LIMIT 1',
        [chamadoId]
      );
      expect(rows[0].email_enviado_em).toBeNull();
    } finally {
      emailService.enviar = enviarOriginal;
    }
  });

  it('uma exceção no envio não derruba a mudança de estado', async () => {
    const enviarOriginal = emailService.enviar;
    emailService.enviar = async () => {
      throw new Error('SMTP explodiu');
    };

    try {
      const resp = await request(app)
        .patch(`/chamados/${chamadoId}/estado`)
        .set('Authorization', `Bearer ${gestor.token}`)
        .send({ estado: 'concluido', servico_realizado: 'Servico executado e registrado conforme o combinado.' });

      expect(resp.status).toBe(200);
      expect(resp.body.chamado.estado).toBe('concluido');
    } finally {
      emailService.enviar = enviarOriginal;
    }
  });
});

describe('GET /notificacoes', () => {
  it('cada um vê apenas as próprias notificações', async () => {
    const doTecnico = await request(app)
      .get('/notificacoes')
      .set('Authorization', `Bearer ${tecnico.token}`);
    const doSolicitante = await request(app)
      .get('/notificacoes')
      .set('Authorization', `Bearer ${solicitante.token}`);

    expect(doTecnico.status).toBe(200);
    // O técnico só recebeu o aviso de atribuição.
    expect(doTecnico.body.notificacoes.every((n) => n.tipo === 'atribuicao')).toBe(true);
    // O solicitante recebeu as mudanças de estado, não a atribuição.
    expect(doSolicitante.body.notificacoes.some((n) => n.tipo === 'conclusao')).toBe(true);
    expect(doSolicitante.body.notificacoes.some((n) => n.tipo === 'atribuicao')).toBe(false);
  });

  it('marca como lida e filtra as não lidas', async () => {
    const antes = await request(app)
      .get('/notificacoes?nao_lidas=true')
      .set('Authorization', `Bearer ${tecnico.token}`);
    const alvo = antes.body.notificacoes[0];

    const marcada = await request(app)
      .patch(`/notificacoes/${alvo.id}/lida`)
      .set('Authorization', `Bearer ${tecnico.token}`);
    expect(marcada.status).toBe(204);

    const depois = await request(app)
      .get('/notificacoes?nao_lidas=true')
      .set('Authorization', `Bearer ${tecnico.token}`);
    expect(depois.body.notificacoes.map((n) => n.id)).not.toContain(alvo.id);
  });

  it('não deixa marcar como lida notificação de outra pessoa', async () => {
    const doSolicitante = await request(app)
      .get('/notificacoes')
      .set('Authorization', `Bearer ${solicitante.token}`);
    const alheia = doSolicitante.body.notificacoes[0];

    const resp = await request(app)
      .patch(`/notificacoes/${alheia.id}/lida`)
      .set('Authorization', `Bearer ${tecnico.token}`);

    expect(resp.status).toBe(404);

    const { rows } = await pool.query('SELECT lida FROM notificacao WHERE id = $1', [alheia.id]);
    expect(rows[0].lida).toBe(false);
  });
});

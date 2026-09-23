const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { LIMITES } = require('../src/middlewares/rateLimit');

const { ipDaSuite } = require('./apoio/ip');

const IP = ipDaSuite(__filename);
let clientes = 0;
function ipNovo() {
  clientes += 1;
  return `${IP}-c${clientes}`;
}

/**
 * O teto do pedido de recuperação de senha.
 *
 * Este era o único endpoint sem limite nenhum. O teto por conta já existia
 * (MAX_PENDENTES = 3) e não cobria o que estava exposto: a cota de envio do
 * provedor. O Gmail entrega cerca de 500 mensagens por dia, e quando essa
 * cota acaba, acaba para tudo — inclusive para o aviso de atraso do RF08, que
 * o sistema manda sozinho e ninguém está esperando na tela para perceber que
 * não chegou.
 */

const email = `limite_${Date.now()}@exemplo.com`;
let usuarioId;

beforeAll(async () => {
  await request(app)
    .post('/auth/registrar')
    .send({ nome: 'Limite Recuperacao', email, senha: 'senha123' });
  const { rows } = await pool.query('SELECT id FROM usuario WHERE email = $1', [email]);
  usuarioId = rows[0].id;
});

afterEach(async () => {
  await pool.query('DELETE FROM recuperacao_senha WHERE usuario_id = $1', [usuarioId]);
});

afterAll(async () => {
  await pool.query('DELETE FROM tentativa_recuperacao WHERE ip LIKE $1', [`${IP}%`]);
  await pool.end();
});

describe('Teto por IP', () => {
  // Os testes abaixo montam o laço a partir de `MAX_PEDIDOS_POR_IP`, o que os
  // deixa cegos para a mudança do próprio número: subir a constante para 500
  // sobe o laço junto, e todos continuam passando enquanto o teto deixa de
  // existir na prática. Foi o que aconteceu quando mutei o valor para conferir.
  //
  // Estas duas asserções são as que não se mexem com a constante.
  it('trinta pedidos do mesmo cliente numa hora não passam todos', async () => {
    const ip = ipNovo();
    const status = [];

    for (let i = 0; i < 30; i += 1) {
      const resp = await request(app)
        .post('/auth/recuperar-senha')
        .set('X-Real-IP', ip)
        .send({ email });
      status.push(resp.status);
    }

    // Trinta é um número escolhido de fora: seja qual for o teto, trinta
    // pedidos do mesmo cliente em sequência têm de esbarrar nele.
    expect(status).toContain(429);
  });

  it('o teto cabe num prédio, não numa botnet', async () => {
    // O limite existe para proteger a cota de envio. Um teto alto demais
    // protege no papel e não protege nada: com 500 por hora e por IP, um
    // cliente sozinho esgota a cota diária do Gmail antes do almoço.
    //
    // O piso tem razão simétrica: um prédio inteiro sai por um IP só, e um
    // teto apertado demais barraria gente de verdade numa segunda-feira ruim.
    expect(LIMITES.MAX_PEDIDOS_POR_IP).toBeGreaterThanOrEqual(5);
    expect(LIMITES.MAX_PEDIDOS_POR_IP).toBeLessThanOrEqual(25);
    expect(LIMITES.MAX_ENVIOS_POR_DIA).toBeLessThan(500);
  });

  it(`recusa a partir do pedido ${LIMITES.MAX_PEDIDOS_POR_IP + 1} do mesmo cliente`, async () => {
    const ip = ipNovo();

    for (let i = 0; i < LIMITES.MAX_PEDIDOS_POR_IP; i += 1) {
      const resp = await request(app)
        .post('/auth/recuperar-senha')
        .set('X-Real-IP', ip)
        .send({ email });
      expect(resp.status).toBe(200);
    }

    const excedente = await request(app)
      .post('/auth/recuperar-senha')
      .set('X-Real-IP', ip)
      .send({ email });

    expect(excedente.status).toBe(429);
    expect(excedente.body.erro.codigo).toBe('MUITOS_PEDIDOS');
  });

  it('conta o pedido por e-mail inexistente igual ao de conta real', async () => {
    // Esta é a propriedade que decidiu de onde o contador lê.
    //
    // `recuperacao_senha` já guardava o IP, e contar de lá teria evitado uma
    // tabela nova. Só que aquela tabela só ganha linha quando a conta EXISTE:
    // pedido para endereço não cadastrado não deixa rastro. Um contador assim
    // responde "esse e-mail existe?" para quem souber observar quando o 429
    // chega — reconstruindo, pela porta dos fundos, a enumeração que a
    // resposta 200 uniforme existe para impedir.
    //
    // Se alguém trocar a origem da contagem por `recuperacao_senha`, este
    // teste é o que percebe: aqui nenhum dos pedidos cria linha lá.
    const ip = ipNovo();

    for (let i = 0; i < LIMITES.MAX_PEDIDOS_POR_IP; i += 1) {
      await request(app)
        .post('/auth/recuperar-senha')
        .set('X-Real-IP', ip)
        .send({ email: `fantasma_${i}_${Date.now()}@exemplo.com` });
    }

    const excedente = await request(app)
      .post('/auth/recuperar-senha')
      .set('X-Real-IP', ip)
      .send({ email: `fantasma_final_${Date.now()}@exemplo.com` });

    expect(excedente.status).toBe(429);
  });

  it('não contamina o cliente vizinho', async () => {
    // Um prédio inteiro pode sair por um IP só, mas dois clientes distintos
    // não podem herdar o bloqueio um do outro.
    const bloqueado = ipNovo();
    for (let i = 0; i <= LIMITES.MAX_PEDIDOS_POR_IP; i += 1) {
      await request(app)
        .post('/auth/recuperar-senha')
        .set('X-Real-IP', bloqueado)
        .send({ email });
    }

    const outro = await request(app)
      .post('/auth/recuperar-senha')
      .set('X-Real-IP', ipNovo())
      .send({ email });

    expect(outro.status).toBe(200);
  });

  it('não gasta vaga do contador quando o corpo é inválido', async () => {
    // O `validate` roda antes do limitador de propósito: quem digita o e-mail
    // errado não deve caminhar para o bloqueio.
    const ip = ipNovo();

    for (let i = 0; i < LIMITES.MAX_PEDIDOS_POR_IP + 5; i += 1) {
      const resp = await request(app)
        .post('/auth/recuperar-senha')
        .set('X-Real-IP', ip)
        .send({ email: 'isto-nao-e-um-email' });
      expect(resp.status).toBe(422);
    }

    const valido = await request(app)
      .post('/auth/recuperar-senha')
      .set('X-Real-IP', ip)
      .send({ email });

    expect(valido.status).toBe(200);
  });
});

describe('Teto diário de envios', () => {
  it('recusa mesmo vindo de um cliente novo, porque a cota é do sistema', async () => {
    // O teto por IP sozinho não protege cota nenhuma: IP se troca de graça.
    // Quem protege é este, que soma todos os clientes.
    const agora = Date.now();
    try {
      await pool.query(
        `INSERT INTO recuperacao_senha (usuario_id, token_hash, expira_em, criado_em)
         SELECT $1, encode(sha256((($2::text) || i::text)::bytea), 'hex'),
                now() + interval '1 hour', now()
           FROM generate_series(1, $3) AS i`,
        [usuarioId, `cota-${agora}`, LIMITES.MAX_ENVIOS_POR_DIA]
      );

      const resp = await request(app)
        .post('/auth/recuperar-senha')
        .set('X-Real-IP', ipNovo())
        .send({ email });

      expect(resp.status).toBe(429);
      expect(resp.body.erro.codigo).toBe('MUITOS_PEDIDOS');
    } finally {
      // Sem isto, as cem linhas ficariam e a suíte seguinte que pedisse
      // recuperação de senha bateria no teto diário — uma falha que não teria
      // nada a ver com o código dela.
      await pool.query('DELETE FROM recuperacao_senha WHERE usuario_id = $1', [usuarioId]);
    }
  });

  it('não diz qual dos dois tetos estourou', async () => {
    // Dizer "a cota diária do sistema acabou" confirmaria a quem tentou que o
    // ataque funcionou, e entregaria o retorno que falta para calibrar o
    // próximo. A recusa é a mesma nos dois casos.
    const ip = ipNovo();
    for (let i = 0; i <= LIMITES.MAX_PEDIDOS_POR_IP; i += 1) {
      await request(app).post('/auth/recuperar-senha').set('X-Real-IP', ip).send({ email });
    }

    const resp = await request(app)
      .post('/auth/recuperar-senha')
      .set('X-Real-IP', ip)
      .send({ email });

    const mensagem = resp.body.erro.mensagem;
    expect(mensagem).not.toMatch(/cota|diári|sistema todo|IP|endereço de rede/i);
    // E aponta a saída que existe: administrador redefine senha.
    expect(mensagem).toMatch(/administrador/i);
  });
});

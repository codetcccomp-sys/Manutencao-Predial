const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');
const { garantirLocal } = require('./apoio/local');
const anexosService = require('../src/services/anexos.service');

const { TAMANHO_MAXIMO_BYTES } = anexosService;

const { ipDaSuite } = require('./apoio/ip');

// Ver tests/apoio/ip.js: cada suíte se apresenta ao login como um cliente
// distinto, para não dividir a cota por IP com as suítes que rodam em paralelo.
const IP = ipDaSuite(__filename);

let solicitante;
let estranho;
let gestor;
let chamadoId;
let chamadoAlheioId;

// PNG de 1x1 válido: começa com a assinatura que o serviço confere.
const PNG_VALIDO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const PDF_VALIDO = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'ascii');

async function criarUsuarioELogar(perfil) {
  const email = `${perfil}_anx_${Date.now()}_${Math.random().toString(36).slice(2)}@exemplo.com`;
  await request(app).post('/auth/registrar').send({ nome: `Anexo ${perfil}`, email, senha: 'senha-teste-123' });
  if (perfil !== 'solicitante') {
    await pool.query('UPDATE usuario SET perfil = $1 WHERE email = $2', [perfil, email]);
  }
  const login = await request(app).post('/auth/login').set('X-Real-IP', IP).send({ email, senha: 'senha-teste-123' });
  return { token: login.body.token, usuario: login.body.usuario };
}

beforeAll(async () => {
  solicitante = await criarUsuarioELogar('solicitante');
  estranho = await criarUsuarioELogar('solicitante');
  gestor = await criarUsuarioELogar('gestor');

  const localDeTeste = await garantirLocal({ unidade: 'Unidade Anexo' });
  const categoria = await pool.query('SELECT id FROM categoria LIMIT 1');

  const dados = {
    descricao: 'Descrição do chamado com anexo',
    categoria_id: categoria.rows[0].id,
    local_id: localDeTeste,
  };

  const meu = await request(app)
    .post('/chamados')
    .set('Authorization', `Bearer ${solicitante.token}`)
    .send({ titulo: 'Chamado com anexo', ...dados });
  chamadoId = meu.body.chamado.id;

  const alheio = await request(app)
    .post('/chamados')
    .set('Authorization', `Bearer ${estranho.token}`)
    .send({ titulo: 'Chamado de outro', ...dados });
  chamadoAlheioId = alheio.body.chamado.id;
});

afterAll(async () => {
  await pool.end();
});

describe('Envio de anexos', () => {
  it('aceita PNG válido e devolve os metadados sem o conteúdo', async () => {
    const resp = await request(app)
      .post(`/chamados/${chamadoId}/anexos`)
      .set('Authorization', `Bearer ${solicitante.token}`)
      .attach('arquivo', PNG_VALIDO, { filename: 'foto.png', contentType: 'image/png' });

    expect(resp.status).toBe(201);
    expect(resp.body.anexo.tipo).toBe('foto');
    expect(resp.body.anexo.mime_type).toBe('image/png');
    expect(resp.body.anexo.tamanho_bytes).toBe(PNG_VALIDO.length);
    expect(resp.body.anexo).not.toHaveProperty('conteudo');
  });

  it('aceita PDF e o classifica como documento', async () => {
    const resp = await request(app)
      .post(`/chamados/${chamadoId}/anexos`)
      .set('Authorization', `Bearer ${solicitante.token}`)
      .attach('arquivo', PDF_VALIDO, { filename: 'laudo.pdf', contentType: 'application/pdf' });

    expect(resp.status).toBe(201);
    expect(resp.body.anexo.tipo).toBe('documento');
  });

  it('recusa tipo fora da allowlist', async () => {
    const resp = await request(app)
      .post(`/chamados/${chamadoId}/anexos`)
      .set('Authorization', `Bearer ${solicitante.token}`)
      .attach('arquivo', Buffer.from('<script>alert(1)</script>'), {
        filename: 'x.html',
        contentType: 'text/html',
      });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('TIPO_NAO_ACEITO');
  });

  it('recusa arquivo cujo conteúdo não confere com o tipo declarado', async () => {
    // O cliente escolhe o Content-Type do multipart: só confiar nele deixaria
    // passar qualquer coisa rotulada como imagem.
    const resp = await request(app)
      .post(`/chamados/${chamadoId}/anexos`)
      .set('Authorization', `Bearer ${solicitante.token}`)
      .attach('arquivo', Buffer.from('<html><body>não sou um png</body></html>'), {
        filename: 'disfarcado.png',
        contentType: 'image/png',
      });

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('CONTEUDO_INCOMPATIVEL');
  });

  it('recusa arquivo acima do limite de tamanho', async () => {
    const grande = Buffer.concat([PNG_VALIDO, Buffer.alloc(TAMANHO_MAXIMO_BYTES + 1024)]);

    const resp = await request(app)
      .post(`/chamados/${chamadoId}/anexos`)
      .set('Authorization', `Bearer ${solicitante.token}`)
      .attach('arquivo', grande, { filename: 'grande.png', contentType: 'image/png' });

    expect(resp.status).toBe(413);
    expect(resp.body.erro.codigo).toBe('ARQUIVO_GRANDE');
  });

  // Envio malformado é erro de quem enviou, não do servidor: tem de voltar
  // 400 na forma de erro da API, e não um 500 com stack no log de erros —
  // era o que acontecia, porque o erro do parser não é um MulterError. A
  // segunda requisição confere que o servidor segue de pé: o multer 1.x
  // chegou a cair com corpo malformado (CVE-2025-7338).
  it.each([
    ['corpo que termina no meio', '--x\r\nContent-Disposition: form-data; name="arquivo"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nabc'],
    ['parte sem cabeçalho válido', `--x\r\nContent-Disposition: form-data; name="arquivo"; filename="a"\r\n${'X'.repeat(200)}\r\n\r\n`],
    ['corpo que não é multipart', 'isso não é multipart'],
    ['parte sem nome de campo', '--x\r\nContent-Disposition: form-data; filename="a.png"\r\n\r\nabc\r\n--x--\r\n'],
  ])('recusa envio malformado (%s) com 400, sem derrubar nada', async (_caso, corpo) => {
    const resp = await request(app)
      .post(`/chamados/${chamadoId}/anexos`)
      .set('Authorization', `Bearer ${solicitante.token}`)
      .set('Content-Type', 'multipart/form-data; boundary=x')
      .send(corpo);

    expect(resp.status).toBe(400);
    expect(resp.body.erro.codigo).toBe('ENVIO_MALFORMADO');

    const depois = await request(app)
      .get(`/chamados/${chamadoId}/anexos`)
      .set('Authorization', `Bearer ${solicitante.token}`);
    expect(depois.status).toBe(200);
  });

  // Direto no serviço: o que se prova é o que chega ao banco, e o formulário
  // multipart do teste não carrega esses bytes de forma confiável.
  it('nome de arquivo com caractere de controle é gravado sem ele, e nunca vazio', async () => {
    const arquivo = (nome) => ({ originalname: nome, mimetype: 'image/png', size: PNG_VALIDO.length, buffer: PNG_VALIDO });

    const comControle = await anexosService.anexar(chamadoId, solicitante.usuario.id, arquivo('fo\u0000to\r\n do \u007fvazamento.png'));
    const soControle = await anexosService.anexar(chamadoId, solicitante.usuario.id, arquivo('\u0000\u0001\n'));

    expect(comControle.nome_arquivo).toBe('foto do vazamento.png');
    expect(soControle.nome_arquivo).toBe('arquivo');
    await pool.query('DELETE FROM anexo WHERE id = ANY($1)', [[comControle.id, soControle.id]]);
  });

  it('recusa requisição sem arquivo', async () => {
    const resp = await request(app)
      .post(`/chamados/${chamadoId}/anexos`)
      .set('Authorization', `Bearer ${solicitante.token}`);

    expect(resp.status).toBe(422);
    expect(resp.body.erro.codigo).toBe('ARQUIVO_AUSENTE');
  });
});

describe('Leitura e download de anexos', () => {
  it('lista os anexos do chamado sem trazer bytes', async () => {
    const resp = await request(app)
      .get(`/chamados/${chamadoId}/anexos`)
      .set('Authorization', `Bearer ${solicitante.token}`);

    expect(resp.status).toBe(200);
    expect(resp.body.anexos.length).toBeGreaterThanOrEqual(2);
    expect(resp.body.anexos[0]).not.toHaveProperty('conteudo');
    expect(resp.body.anexos[0].usuario_nome).toBeDefined();
  });

  it('devolve o arquivo idêntico ao enviado, como attachment e com nosniff', async () => {
    const lista = await request(app)
      .get(`/chamados/${chamadoId}/anexos`)
      .set('Authorization', `Bearer ${solicitante.token}`);
    const png = lista.body.anexos.find((a) => a.mime_type === 'image/png');

    const resp = await request(app)
      .get(`/chamados/${chamadoId}/anexos/${png.id}/conteudo`)
      .set('Authorization', `Bearer ${solicitante.token}`)
      .buffer()
      .parse((res, callback) => {
        const pedacos = [];
        res.on('data', (c) => pedacos.push(c));
        res.on('end', () => callback(null, Buffer.concat(pedacos)));
      });

    expect(resp.status).toBe(200);
    expect(resp.headers['content-type']).toContain('image/png');
    expect(resp.headers['content-disposition']).toMatch(/^attachment;/);
    expect(resp.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(resp.body, PNG_VALIDO)).toBe(0);
  });
});

describe('Controle de acesso dos anexos', () => {
  it('estranho não lista nem anexa em chamado alheio', async () => {
    const listagem = await request(app)
      .get(`/chamados/${chamadoId}/anexos`)
      .set('Authorization', `Bearer ${estranho.token}`);
    expect(listagem.status).toBe(403);

    const envio = await request(app)
      .post(`/chamados/${chamadoId}/anexos`)
      .set('Authorization', `Bearer ${estranho.token}`)
      .attach('arquivo', PNG_VALIDO, { filename: 'intruso.png', contentType: 'image/png' });
    expect(envio.status).toBe(403);
  });

  it('não deixa baixar anexo alheio passando o id de um chamado próprio na URL', async () => {
    // O anexo pertence ao chamado do estranho; o atacante monta a URL com o
    // próprio chamado, onde tem acesso. A permissão tem de vir do registro.
    const doOutro = await request(app)
      .post(`/chamados/${chamadoAlheioId}/anexos`)
      .set('Authorization', `Bearer ${estranho.token}`)
      .attach('arquivo', PNG_VALIDO, { filename: 'privado.png', contentType: 'image/png' });
    expect(doOutro.status).toBe(201);

    const resp = await request(app)
      .get(`/chamados/${chamadoId}/anexos/${doOutro.body.anexo.id}/conteudo`)
      .set('Authorization', `Bearer ${solicitante.token}`);

    expect(resp.status).toBe(403);
  });

  it('só o autor ou a gestão removem o anexo', async () => {
    const enviado = await request(app)
      .post(`/chamados/${chamadoId}/anexos`)
      .set('Authorization', `Bearer ${solicitante.token}`)
      .attach('arquivo', PNG_VALIDO, { filename: 'remover.png', contentType: 'image/png' });

    const porEstranho = await request(app)
      .delete(`/chamados/${chamadoId}/anexos/${enviado.body.anexo.id}`)
      .set('Authorization', `Bearer ${estranho.token}`);
    expect(porEstranho.status).toBe(403);

    const peloAutor = await request(app)
      .delete(`/chamados/${chamadoId}/anexos/${enviado.body.anexo.id}`)
      .set('Authorization', `Bearer ${solicitante.token}`);
    expect(peloAutor.status).toBe(204);
  });

  it('gestor remove anexo que não enviou', async () => {
    const enviado = await request(app)
      .post(`/chamados/${chamadoId}/anexos`)
      .set('Authorization', `Bearer ${solicitante.token}`)
      .attach('arquivo', PNG_VALIDO, { filename: 'gestor-remove.png', contentType: 'image/png' });

    const resp = await request(app)
      .delete(`/chamados/${chamadoId}/anexos/${enviado.body.anexo.id}`)
      .set('Authorization', `Bearer ${gestor.token}`);

    expect(resp.status).toBe(204);
  });
});

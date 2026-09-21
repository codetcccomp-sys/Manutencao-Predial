const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/db');

afterAll(async () => {
  await pool.end();
});

/**
 * De onde o navegador pode chamar esta API.
 *
 * Este arquivo não existia, e a falta dele custou caro: o endereço
 * `manutencao-predial-frontend.vercel.app`, que a própria Vercel atribui ao
 * projeto, era recusado pela API. Quem abrisse o sistema por ele via a tela de
 * login normalmente, digitava a senha e recebia "Erro interno no servidor.".
 * As 22 suítes passavam, porque todas falam com o app direto, sem `Origin` —
 * exatamente o caso que o CORS deixa passar.
 *
 * A regra do CORS é a única do sistema que só se manifesta no navegador. Ela
 * precisa de teste justamente por isso.
 */

const ACEITOS = [
  ['o endereço curto do sistema', 'https://conserva-predial.vercel.app'],
  ['o nome que a Vercel deu ao projeto', 'https://manutencao-predial-frontend.vercel.app'],
  ['o mesmo nome com o sufixo da equipe', 'https://manutencao-predial-frontend-tec-code.vercel.app'],
  [
    'o preview de um branch',
    'https://manutencao-predial-frontend-git-claude-project-fe180c-tec-code.vercel.app',
  ],
  ['o preview de um commit', 'https://manutencao-predial-frontend-938evypnb-tec-code.vercel.app'],
  ['o Vite em desenvolvimento', 'http://localhost:5173'],
  ['o `vite preview`, que é por onde os testes de ponta a ponta rodam', 'http://localhost:4173'],
];

describe('Origens aceitas', () => {
  it.each(ACEITOS)('aceita %s', async (_, origem) => {
    const resp = await request(app).get('/health').set('Origin', origem);

    expect(resp.status).toBe(200);
    // Sem este cabeçalho o navegador descarta a resposta mesmo com 200: a
    // requisição chega ao servidor, é processada, e o JavaScript da página
    // nunca vê o resultado.
    expect(resp.headers['access-control-allow-origin']).toBe(origem);
  });

  it('aceita chamada sem Origin — é como o agendador do RF08 fala', async () => {
    // O cron não é navegador e não manda `Origin`. Se o CORS barrasse a
    // ausência do cabeçalho, o aviso de atraso pararia de funcionar, e pararia
    // em silêncio: o agendador se desliga sozinho depois de algumas falhas.
    const resp = await request(app).get('/health');

    expect(resp.status).toBe(200);
  });
});

describe('Origens recusadas', () => {
  it('recusa um site qualquer', async () => {
    const resp = await request(app)
      .post('/auth/login')
      .set('Origin', 'https://site-de-terceiro.example')
      .send({ email: 'qualquer@exemplo.com', senha: 'seja-o-que-for' });

    expect(resp.status).toBe(403);
    expect(resp.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('diz que o problema é a origem, em vez de fingir que o servidor caiu', async () => {
    const registro = jest.spyOn(console, 'error').mockImplementation(() => {});
    const resp = await request(app)
      .post('/auth/login')
      .set('Origin', 'https://endereco-novo-ainda-nao-cadastrado.vercel.app')
      .send({ email: 'qualquer@exemplo.com', senha: 'seja-o-que-for' });

    // A recusa devolvia 500 com "Erro interno no servidor.". Quem via aquilo
    // ia procurar banco caído e servidor quebrado — enquanto a API estava de
    // pé, funcionando, e apenas recusando a origem. O código diz o que
    // aconteceu.
    expect(resp.body.erro.codigo).toBe('ORIGEM_NAO_PERMITIDA');
    expect(resp.body.erro.mensagem).not.toContain('Erro interno');

    // Mas a instrução de conserto NÃO vai na resposta: o nome do arquivo e o
    // da constante são detalhe de dentro, e este endpoint é público. Quem
    // precisa da instrução opera o servidor, e essa pessoa lê o log.
    expect(resp.body.erro.mensagem).not.toContain('DOMINIOS_FIXOS');
    expect(resp.body.erro.mensagem).not.toContain('src/app.js');

    const doLog = registro.mock.calls.flat().join(' ');
    expect(doLog).toContain('endereco-novo-ainda-nao-cadastrado.vercel.app');
    expect(doLog).toContain('DOMINIOS_FIXOS');

    registro.mockRestore();
  });

  it('não deixa um domínio de terceiro passar só por terminar igual', async () => {
    // `manutencao-predial-frontend-tec-code.vercel.app.invasor.com` termina
    // com o nome certo no meio. A âncora final do padrão é o que impede isso.
    const resp = await request(app)
      .get('/health')
      .set('Origin', 'https://manutencao-predial-frontend-tec-code.vercel.app.invasor.com');

    expect(resp.status).toBe(403);
    expect(resp.headers['access-control-allow-origin']).toBeUndefined();
  });
});

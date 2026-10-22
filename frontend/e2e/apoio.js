import { request as requisicao } from '@playwright/test';

const API = process.env.E2E_API ?? 'http://localhost:3333';

/**
 * Semeadura pela própria API, não por SQL.
 *
 * Inserir direto no banco criaria estados que a aplicação nunca produz — um
 * chamado sem histórico, uma senha sem hash — e o teste passaria a verificar
 * uma realidade que não existe. Pela API, o cenário é construído pelo mesmo
 * caminho de um uso real.
 */
class Cliente {
  constructor(contexto, token, usuario, senha) {
    this.contexto = contexto;
    this.token = token;
    this.usuario = usuario;
    // A senha anda junto do cliente porque nem todos usam a mesma: o
    // administrador vem semeado com uma própria, e um `entrar` que digitasse
    // sempre a padrão falharia só nele — com cara de defeito de login.
    this.senha = senha;
  }

  cabecalhos() {
    return {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  async post(caminho, dados) {
    const r = await this.contexto.post(API + caminho, { headers: this.cabecalhos(), data: dados });
    return { status: r.status(), corpo: await r.json().catch(() => null) };
  }

  async patch(caminho, dados) {
    const r = await this.contexto.patch(API + caminho, { headers: this.cabecalhos(), data: dados });
    return { status: r.status(), corpo: await r.json().catch(() => null) };
  }

  async get(caminho) {
    const r = await this.contexto.get(API + caminho, { headers: this.cabecalhos() });
    return { status: r.status(), corpo: await r.json().catch(() => null) };
  }
}

export const SENHA = 'senha123';

// Credenciais do administrador semeado pelo backend. Não têm valor secreto:
// existem só no banco de teste, e o script que as cria recusa rodar com
// NODE_ENV=production.
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin_e2e@exemplo.com';
const ADMIN_SENHA = process.env.E2E_ADMIN_SENHA ?? 'senha_de_teste_e2e';

/**
 * Cria um cenário isolado: usuários, local e categoria próprios.
 *
 * Cada execução usa uma marca própria no e-mail e no nome do local. O banco
 * de teste acumula dados de execuções anteriores, e depender do que já está
 * lá é o que torna uma suíte verde hoje e vermelha amanhã sem ninguém ter
 * mexido em nada.
 *
 * Os perfis acima de solicitante são promovidos pela API de administração, e
 * não por UPDATE no banco: o cadastro público só cria solicitante, de
 * propósito, e o caminho de promoção precisa continuar funcionando.
 */
export async function montarCenario({ perfis = ['gestor', 'solicitante', 'tecnico'] } = {}) {
  const contexto = await requisicao.newContext();
  const marca = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const anonimo = new Cliente(contexto, null, null);

  async function logar(email, senha = SENHA) {
    const login = await anonimo.post('/auth/login', { email, senha });
    if (login.status !== 200) {
      throw new Error(`Não foi possível entrar como ${email} (${login.status}).`);
    }
    return new Cliente(contexto, login.corpo.token, login.corpo.usuario, senha);
  }

  async function registrarELogar(nome, email, senha = SENHA) {
    await anonimo.post('/auth/registrar', { nome, email, senha });
    return logar(email, senha);
  }

  // O administrador vem semeado pelo backend (database/semear-admin.js): o
  // cadastro público só cria solicitante, e essa é a única porta que a API
  // não abre. Daí em diante todos os perfis saem da rota de administração,
  // que é o caminho que precisa continuar funcionando.
  const entrada = await anonimo.post('/auth/login', {
    email: ADMIN_EMAIL,
    senha: ADMIN_SENHA,
  });

  if (entrada.status !== 200) {
    throw new Error(
      `Administrador de teste não encontrado (${entrada.status}). ` +
        'Rode: E2E_ADMIN_EMAIL=... E2E_ADMIN_SENHA=... node database/semear-admin.js no backend.'
    );
  }

  const adminLogado = new Cliente(contexto, entrada.corpo.token, entrada.corpo.usuario, ADMIN_SENHA);
  const pessoas = { administrador: adminLogado };
  for (const perfil of perfis) {
    const email = `e2e_${perfil}_${marca}@exemplo.com`;
    const nome = `E2E ${perfil}`;
    if (perfil === 'solicitante') {
      // Cadastro público: é o único caminho que cria solicitante, e é o que
      // uma pessoa de verdade percorre.
      pessoas[perfil] = await registrarELogar(nome, email);
    } else {
      // Criado pela gestão, e só logado depois: tentar registrar antes daria
      // 409 e sujaria o log com um erro que não é erro.
      await adminLogado.post('/usuarios', { nome, email, senha: SENHA, perfil });
      pessoas[perfil] = await logar(email);
    }
  }

  const gestor = pessoas.gestor ?? adminLogado;
  const local = (await gestor.post('/locais', { unidade: `Unidade E2E ${marca}`, bloco: 'A' })).corpo
    .local;
  const categorias = (await gestor.get('/categorias')).corpo.categorias;

  return {
    marca,
    contexto,
    pessoas,
    local,
    categoria: categorias[0],

    async abrirChamado({ titulo = `Chamado E2E ${marca}`, descricao, por = pessoas.solicitante } = {}) {
      const { corpo } = await por.post('/chamados', {
        titulo,
        descricao: descricao ?? 'Descrição do problema relatado durante a ronda.',
        categoria_id: categorias[0].id,
        local_id: local.id,
      });
      return corpo.chamado;
    },

    async atribuir(chamadoId, tecnico = pessoas.tecnico) {
      await gestor.patch(`/chamados/${chamadoId}/estado`, { estado: 'em_triagem' });
      await gestor.patch(`/chamados/${chamadoId}/atribuir`, { tecnico_id: tecnico.usuario.id });
    },

    async concluir(chamadoId) {
      await gestor.patch(`/chamados/${chamadoId}/estado`, { estado: 'em_andamento' });
      await gestor.patch(`/chamados/${chamadoId}/estado`, {
        estado: 'concluido',
        servico_realizado: 'Serviço executado e conferido no local pela equipe.',
        epi_confirmado: true,
      });
    },

    async encerrar() {
      await contexto.dispose();
    },
  };
}

/** Entra pela tela de login, como uma pessoa entraria. */
/**
 * Responde as três perguntas de situação do formulário de abertura (RF04). Sem elas o
 * formulário não envia: a prioridade sai delas. O padrão é a situação mais leve.
 */
export async function responderSituacao(
  page,
  { risco = 'Não', impacto = 'Só incomoda; tudo funciona', urgencia = 'Pode esperar alguns dias' } = {}
) {
  for (const nome of [risco, impacto, urgencia]) {
    await page.getByRole('radio', { name: nome, exact: true }).check();
  }
}

export async function entrar(page, cliente) {
  await page.goto('/login');
  await page.getByLabel(/e-?mail/i).fill(cliente.usuario.email);
  await page.getByLabel(/senha/i).fill(cliente.senha ?? SENHA);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL('**/');
}

/**
 * Confere que nada vaza da tela.
 *
 * O `scrollWidth` sozinho não basta: transbordo pela esquerda não gera barra
 * de rolagem, e foi assim que o painel de avisos passou meses saindo da tela
 * no celular com o texto cortado, sem nenhum sinal automático.
 */
export async function conferirQueCabeNaTela(page, expect) {
  const largura = page.viewportSize().width;

  const estouros = await page.evaluate((limite) => {
    /**
     * Uma tabela larga dentro de um contêiner com overflow-x: auto deve
     * transbordar — é assim que ela rola por dentro em vez de levar a página
     * junto. O que não pode é o transbordo escapar desse contêiner.
     */
    function dentroDeAreaQueRola(el) {
      for (let pai = el.parentElement; pai && pai !== document.body; pai = pai.parentElement) {
        const estilo = getComputedStyle(pai);
        if (['auto', 'scroll'].includes(estilo.overflowX)) return true;
      }
      return false;
    }

    const fora = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left >= -1 && r.right <= limite + 1) continue;
      if (dentroDeAreaQueRola(el)) continue;

      fora.push({
        tag: el.tagName,
        classe: String(el.className).slice(0, 60),
        esquerda: Math.round(r.left),
        direita: Math.round(r.right),
        texto: (el.textContent || '').trim().slice(0, 40),
      });
    }
    return fora;
  }, largura);

  expect(estouros, `elementos fora da tela de ${largura}px: ${JSON.stringify(estouros, null, 1)}`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(largura);
}

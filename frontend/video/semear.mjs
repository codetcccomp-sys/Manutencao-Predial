// Semente do banco DESCARTÁVEL de vídeo: pela API (como o e2e), com nomes e dados realistas.
// Nunca aponte para um backend de verdade: ele cria contas, e o admin é o do banco de vídeo.
const API = process.env.API ?? 'http://localhost:3333';
const SENHA = 'senha123';

async function chamar(token, metodo, caminho, corpo) {
  const r = await fetch(API + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${metodo} ${caminho} -> ${r.status} ${JSON.stringify(dados)}`);
  return dados;
}
const entrar = async (email, senha = SENHA) => (await chamar(null, 'POST', '/auth/login', { email, senha })).token;

const admin = await entrar('admin_video@exemplo.com', 'senha_video_local');

const PESSOAS = {
  gestor: [['Ana Ribeiro', 'ana.ribeiro@conserva.demo']],
  tecnico: [
    ['Paulo Tavares', 'paulo.tavares@conserva.demo'],
    ['Carlos Menezes', 'carlos.menezes@conserva.demo'],
    ['Rita Alencar', 'rita.alencar@conserva.demo'],
  ],
};
const SOLICITANTES = [
  ['Jorge Pacheco', 'jorge.pacheco@conserva.demo'],
  ['Marta Coelho', 'marta.coelho@conserva.demo'],
  ['Lúcia Fontes', 'lucia.fontes@conserva.demo'],
  ['Sérgio Vasques', 'sergio.vasques@conserva.demo'],
];

for (const [perfil, lista] of Object.entries(PESSOAS)) {
  for (const [nome, email] of lista) await chamar(admin, 'POST', '/usuarios', { nome, email, senha: SENHA, perfil });
}
for (const [nome, email] of SOLICITANTES) await chamar(null, 'POST', '/auth/registrar', { nome, email, senha: SENHA });

const ana = await entrar('ana.ribeiro@conserva.demo');
const tecnicos = [];
for (const [, email] of PESSOAS.tecnico) {
  const token = await entrar(email);
  tecnicos.push({ token, id: (await chamar(token, 'GET', '/usuarios/me')).usuario.id });
}
const solic = [];
for (const [, email] of SOLICITANTES) solic.push(await entrar(email));

const LOCAIS = [
  { unidade: 'Campus Central', bloco: 'Bloco A', pavimento: '1º andar', ambiente: 'Banheiro masculino' },
  { unidade: 'Campus Central', bloco: 'Bloco A', pavimento: 'Térreo', ambiente: 'Corredor principal' },
  { unidade: 'Campus Central', bloco: 'Bloco B', pavimento: '2º andar', ambiente: 'Sala 204' },
  { unidade: 'Campus Central', bloco: 'Bloco B', pavimento: 'Térreo', ambiente: 'Laboratório de informática' },
  { unidade: 'Campus Central', bloco: 'Bloco C', pavimento: 'Subsolo', ambiente: 'Casa de máquinas' },
  { unidade: 'Campus Central', bloco: 'Administrativo', pavimento: '1º andar', ambiente: 'Recepção' },
];
const locais = [];
for (const l of LOCAIS) locais.push((await chamar(ana, 'POST', '/locais', l)).local.id);
const categorias = (await chamar(ana, 'GET', '/categorias')).categorias;
const cat = (parte) => (categorias.find((c) => c.nome.toLowerCase().includes(parte)) ?? categorias[0]).id;

// [título, descrição, categoria, local, até onde vai, fatores (urg,imp,risco)]
const T = [
  ['Torneira vazando no banheiro masculino', 'A torneira da pia do meio pinga sem parar desde ontem e já molhou o piso.', 'hidr', 0, 'concluido', [2, 1, 1]],
  ['Lâmpada queimada no corredor', 'Duas lâmpadas do corredor do térreo estão queimadas e o fim do corredor fica escuro.', 'el', 1, 'concluido', [1, 2, 2]],
  ['Ar-condicionado da sala 204 não refrigera', 'O aparelho liga mas sopra ar quente. Aula marcada para a tarde.', 'clim', 2, 'concluido', [3, 2, 1]],
  ['Computadores do laboratório sem rede', 'Os 12 computadores do laboratório perderam a conexão com a rede interna.', 'inform', 3, 'concluido', [3, 3, 1]],
  ['Barulho forte na bomba da casa de máquinas', 'Ruído metálico constante vindo da bomba principal, com vibração no piso.', 'mec', 4, 'concluido', [3, 3, 3]],
  ['Porta da recepção não fecha direito', 'A porta de vidro arrasta no chão e a trava não encaixa.', 'civ', 5, 'concluido', [2, 2, 2]],
  ['Vazamento no teto do corredor', 'Mancha de umidade crescendo no teto, com gotejamento nos dias de chuva.', 'hidr', 1, 'concluido', [3, 2, 2]],
  ['Tomada com mau contato na sala 204', 'A tomada junto à lousa solta faísca ao conectar o projetor.', 'el', 2, 'concluido', [3, 2, 4]],
  ['Descarga com defeito no banheiro', 'A descarga do segundo box não aciona.', 'hidr', 0, 'concluido', [2, 1, 1]],
  ['Projetor da sala 204 sem imagem', 'O projetor liga, mas não exibe imagem nenhuma.', 'inform', 2, 'concluido', [2, 1, 1]],
  ['Piso solto na recepção', 'Três placas do piso estão soltas e já houve tropeço.', 'civ', 5, 'concluido', [3, 2, 3]],
  ['Maçaneta quebrada do laboratório', 'A maçaneta interna soltou e a porta não abre por dentro.', 'civ', 3, 'concluido', [3, 2, 3]],
  ['Gerador não parte no teste semanal', 'O gerador não deu partida no teste de segunda-feira.', 'el', 4, 'concluido', [3, 4, 4]],
  ['Torneira do bebedouro sem pressão', 'O bebedouro do térreo está com jato muito fraco.', 'hidr', 1, 'concluido', [1, 2, 1]],
  ['Ventilador do corredor fazendo barulho', 'O ventilador de teto vibra e faz estalos.', 'el', 1, 'concluido', [1, 1, 1]],
  ['Janela da sala 204 emperrada', 'Não abre nem fecha, o vidro está solto na guia.', 'civ', 2, 'concluido', [2, 1, 2]],
  ['Switch do laboratório reiniciando sozinho', 'O switch de rede reinicia a cada poucas horas e derruba as máquinas.', 'inform', 3, 'concluido', [3, 3, 2]],
  ['Lâmpadas da recepção piscando', 'A iluminação da recepção pisca em intervalos.', 'el', 5, 'concluido', [1, 2, 1]],
  ['Infiltração na laje do subsolo', 'Mancha de umidade na laje, junto ao quadro elétrico principal.', 'civ', 4, 'em_andamento', [3, 3, 4]],
  ['Pia entupida no banheiro do bloco A', 'A água da pia desce muito devagar e volta cheirando mal.', 'hidr', 0, 'em_andamento', [2, 2, 2]],
  ['Split da recepção pingando', 'O aparelho pinga água sobre o balcão de atendimento.', 'clim', 5, 'em_andamento', [2, 2, 1]],
  ['Câmera de segurança do corredor offline', 'A câmera do corredor principal parou de gravar.', 'inform', 1, 'em_andamento', [2, 3, 3]],
  ['Disjuntor desarmando na casa de máquinas', 'O disjuntor da bomba desarma toda vez que a carga aumenta.', 'el', 4, 'em_andamento', [3, 3, 4]],
  ['Porta corta-fogo do subsolo travada', 'A porta não fecha sozinha, a mola soltou.', 'civ', 4, 'em_andamento', [3, 3, 4]],
  ['Mancha de mofo na parede da sala 204', 'Mofo se espalhando na parede dos fundos.', 'civ', 2, 'atribuido', [1, 2, 2]],
  ['Fechadura da sala de reuniões emperrada', 'A chave gira mas a fechadura não destrava.', 'civ', 5, 'atribuido', [2, 1, 1]],
  ['Ar-condicionado do laboratório com ruído', 'O compressor faz um zumbido alto.', 'clim', 3, 'atribuido', [2, 2, 1]],
  ['Lâmpada de emergência apagada', 'A luminária de emergência da escada não acende no teste.', 'el', 1, 'atribuido', [3, 3, 4]],
  ['Rachadura na parede do corredor', 'Fissura vertical de um metro, apareceu depois da chuva forte.', 'civ', 1, 'atribuido', [3, 3, 3]],
  ['Torneira do banheiro sem água quente', 'O chuveiro do vestiário não aquece.', 'hidr', 0, 'em_triagem', [null]],
  ['Impressora da recepção atolando', 'A impressora atola papel a cada duas folhas.', 'inform', 5, 'em_triagem', [null]],
  ['Cadeiras quebradas na sala 204', 'Quatro cadeiras com o encosto solto.', 'civ', 2, 'em_triagem', [null]],
  ['Sinal de wi-fi fraco no bloco B', 'No segundo andar o wi-fi cai a cada poucos minutos.', 'inform', 2, 'em_triagem', [null]],
  ['Pintura descascando na recepção', 'A parede atrás do balcão está descascando.', 'civ', 5, 'cancelado', [null]],
  ['Pedido duplicado de lâmpada', 'Aberto por engano, já existe outro chamado.', 'el', 1, 'cancelado', [null]],
  ['Cortina da sala 204 caindo', 'O trilho da cortina soltou da parede.', 'civ', 2, 'cancelado', [null]],
  ['Goteira na entrada do bloco B', 'Pinga água do beiral na porta de entrada.', 'hidr', 3, 'aberto', null],
  ['Interruptor da sala 204 estalando', 'O interruptor da lousa estala ao ligar.', 'el', 2, 'aberto', null],
  ['Ralo do banheiro com mau cheiro', 'Cheiro de esgoto no banheiro masculino.', 'hidr', 0, 'aberto', null],
  ['Catraca da recepção travando', 'A catraca trava e não libera a passagem.', 'mec', 5, 'aberto', null],
];

const NOTAS = [5, 5, 4, 5, 3, 4, 5, 4, 5, 5, 4, 3, 5, 4, 5, 4, 5, 5];
const SERV = [
  'Troca do vedante e reaperto do registro; teste de vazamento sem ocorrência.',
  'Substituição das lâmpadas por LED e teste de acendimento nos dois pontos.',
  'Limpeza do filtro e recarga de gás; aparelho voltou a refrigerar normalmente.',
  'Reinício do roteador do bloco e troca do cabo de rede danificado.',
  'Troca do rolamento da bomba e alinhamento do eixo; vibração eliminada.',
];

let k = 0;
const ids = [];
for (const [titulo, descricao, c, l, ate, f] of T) {
  const s = solic[k % solic.length];
  const { chamado } = await chamar(s, 'POST', '/chamados', { titulo, descricao, categoria_id: cat(c), local_id: locais[l], prioridade: 'media' });
  ids.push({ id: chamado.id, ate });
  const t = tecnicos[k % tecnicos.length];
  k += 1;

  if (ate === 'aberto') continue;
  if (ate === 'cancelado') { await chamar(ana, 'PATCH', `/chamados/${chamado.id}/estado`, { estado: 'cancelado' }); continue; }

  await chamar(ana, 'PATCH', `/chamados/${chamado.id}/estado`, { estado: 'em_triagem' });
  if (ate === 'em_triagem') continue;

  await chamar(ana, 'PATCH', `/chamados/${chamado.id}/priorizacao`, { urgencia: f[0], impacto: f[1], risco: f[2] });
  await chamar(ana, 'PATCH', `/chamados/${chamado.id}/atribuir`, { tecnico_id: t.id });
  if (ate === 'atribuido') continue;

  await chamar(t.token, 'PATCH', `/chamados/${chamado.id}/estado`, { estado: 'em_andamento' });
  await chamar(t.token, 'PATCH', `/chamados/${chamado.id}/execucao`, { diagnostico: 'Constatado no local; material separado e serviço iniciado.', tempo_empregado_minutos: 40 + (k * 7) % 120 });
  if (ate === 'em_andamento') continue;

  await chamar(t.token, 'PATCH', `/chamados/${chamado.id}/estado`, { estado: 'concluido', servico_realizado: SERV[k % SERV.length], epi_confirmado: true });
  if (k <= NOTAS.length) await chamar(s, 'POST', `/chamados/${chamado.id}/avaliacao`, { nota: NOTAS[k - 1] });
}
// ── Manutenção preventiva (NBR 5674): equipamentos com etiqueta e planos ──────────────
// Datas no fuso da instituição, como o próprio sistema conta.
const dia = (deslocamento) =>
  new Date(Date.now() + deslocamento * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

const EQUIPAMENTOS = [
  { codigo: 'BOMBA-01', nome: 'Bomba de recalque principal', categoria_id: cat('hidr'), local_id: locais[4], fabricante: 'Schneider', modelo: 'BC-92 S 1,5 cv' },
  { codigo: 'SPLIT-204', nome: 'Ar-condicionado split da sala 204', categoria_id: cat('clim'), local_id: locais[2], fabricante: 'Midea', modelo: 'Xtreme 18.000 BTU' },
  { codigo: 'QDG-01', nome: 'Quadro elétrico geral', categoria_id: cat('el'), local_id: locais[4], fabricante: 'Cemar', modelo: 'Trifásico 225 A' },
];
const eq = {};
for (const e of EQUIPAMENTOS) eq[e.codigo] = (await chamar(ana, 'POST', '/equipamentos', e)).equipamento.id;

const PLANOS = [
  // Gerado ao vivo no vídeo, pelo botão "Gerar agora".
  { titulo: 'Inspeção da bomba de recalque', equipamento_id: eq['BOMBA-01'], repetir_a_cada: 1, unidade_repeticao: 'mes', proxima_execucao: dia(6), antecedencia_dias: 3,
    descricao: '1. Conferir funcionamento e alternância das bombas.\n2. Ouvir ruído e vibração; verificar aquecimento do motor.\n3. Procurar vazamentos em gaxetas e registros.\n4. Testar boias e automático de nível.' },
  // Já dentro da janela: a tarefa diária gera o chamado na semente.
  { titulo: 'Limpeza do filtro do split', equipamento_id: eq['SPLIT-204'], repetir_a_cada: 1, unidade_repeticao: 'mes', proxima_execucao: dia(2), antecedencia_dias: 3, tecnico_id: tecnicos[2].id,
    descricao: '1. Desligar o aparelho e o disjuntor.\n2. Retirar e lavar os filtros.\n3. Conferir dreno e bandeja.\n4. Religar e medir a temperatura na saída.' },
  { titulo: 'Inspeção e reaperto do quadro elétrico geral', equipamento_id: eq['QDG-01'], repetir_a_cada: 6, unidade_repeticao: 'mes', proxima_execucao: dia(24), antecedencia_dias: 3,
    descricao: '1. Desenergizar e bloquear.\n2. Reapertar bornes e conexões.\n3. Procurar sinais de aquecimento.\n4. Testar o botão dos DRs.' },
];
for (const p of PLANOS) await chamar(ana, 'POST', '/planos-preventivos', p);

// As duas tarefas automáticas passam uma vez, como faria o agendador: a preventiva gera
// o chamado do split, e o painel da gestão mostra as duas em dia.
const agendador = { Authorization: 'Bearer video', 'Content-Type': 'application/json' };
for (const tarefa of ['gerar-preventivas', 'notificar-atrasos']) {
  const r = await fetch(`${API}/tarefas/${tarefa}`, { method: 'POST', headers: agendador });
  if (!r.ok) throw new Error(`tarefa ${tarefa} -> ${r.status}`);
}

console.log(JSON.stringify({ chamados: ids.length, por_estado: ids.reduce((a, x) => ((a[x.ate] = (a[x.ate] ?? 0) + 1), a), {}) }));

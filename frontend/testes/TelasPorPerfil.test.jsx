import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const usuarioAtual = { valor: null };
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ usuario: usuarioAtual.valor }),
}));

import api from '../src/api/client';
import Inicio from '../src/pages/Inicio';
import CarregamentoDeTela from '../src/components/CarregamentoDeTela';
import { prazoEmPalavras } from '../src/dominio/prazo';

/**
 * Cada perfil recebe a tela que responde à SUA pergunta.
 *
 * Antes desta separação os quatro perfis caíam na mesma lista, com a mesma
 * ordem e o mesmo vocabulário. O backend já entregava dados diferentes para
 * cada um; a tela é que tratava os três como a mesma pessoa.
 *
 * O que estes testes protegem não é o arranjo visual — é que a tela certa
 * chegue a cada perfil e que ela peça ao servidor o recorte que a torna útil.
 * Uma fila de técnico sem `ordenar=prazo` continua parecendo uma fila e está
 * errada: mostra o que chegou por último em vez do que vence primeiro.
 */

const daqui = (horas) => new Date(Date.now() + horas * 3_600_000).toISOString();

const CHAMADOS = [
  {
    id: 1,
    protocolo: 'SMP-001',
    titulo: 'Torneira pingando',
    estado: 'em_andamento',
    prioridade: 'media',
    prazo_estimado: daqui(3),
    em_atraso: false,
    tecnico_id: 7,
  },
  {
    id: 2,
    protocolo: 'SMP-002',
    titulo: 'Lâmpada queimada',
    estado: 'aberto',
    prioridade: 'baixa',
    prazo_estimado: daqui(30),
    em_atraso: false,
    tecnico_id: null,
  },
  {
    id: 3,
    protocolo: 'SMP-003',
    titulo: 'Porta emperrada',
    estado: 'aguardando_material',
    prioridade: 'alta',
    prazo_estimado: daqui(10),
    em_atraso: false,
    tecnico_id: 7,
  },
  {
    id: 4,
    protocolo: 'SMP-004',
    titulo: 'Vazamento resolvido',
    estado: 'concluido',
    prioridade: 'media',
    prazo_estimado: daqui(-50),
    em_atraso: false,
  },
];

/**
 * Um servidor em miniatura: filtra pelos mesmos parâmetros que a API aceita.
 *
 * A versão anterior devolvia a lista inteira qualquer que fosse o pedido,
 * porque as telas faziam o corte no navegador. Depois que o corte passou para
 * o servidor, um duplê que ignora os parâmetros mediria a si mesmo: a tela
 * poderia parar de pedir `situacao=abertos` e continuar passando.
 */
const ENCERRADO = ['concluido', 'cancelado'];
function servidor(url, config = {}) {
  if (url === '/relatorios/resumo') {
    // Se a tela voltar a pedir o relatório inteiro para ler um número, o
    // teste que conta as chamadas percebe.
    return Promise.resolve({ data: { totais: { em_aberto: 999 } } });
  }
  const p = config.params || {};
  let lista = CHAMADOS;
  if (p.situacao === 'abertos') lista = lista.filter((c) => !ENCERRADO.includes(c.estado));
  if (p.situacao === 'encerrados') lista = lista.filter((c) => ENCERRADO.includes(c.estado));
  if (p.sem_tecnico === 'true') {
    lista = lista.filter((c) => !c.tecnico_id && !ENCERRADO.includes(c.estado));
  }
  if (p.atrasados === 'true') lista = lista.filter((c) => c.em_atraso);
  if (p.busca) lista = lista.filter((c) => c.protocolo.includes(p.busca) || c.titulo.includes(p.busca));
  const total = lista.length;
  const limite = Number(p.limite) || 20;
  return Promise.resolve({
    data: {
      chamados: lista.slice(0, limite),
      paginacao: { pagina: 1, limite, total, paginas: Math.max(1, Math.ceil(total / limite)) },
    },
  });
}

function montarComo(perfil) {
  usuarioAtual.valor = { id: 9, nome: 'Fulano', perfil };
  api.get.mockImplementation(servidor);
  // O painel da gestão carrega sob demanda; em produção o Suspense vem do
  // Layout, e aqui o mesmo envoltório faz esse papel. Os testes já esperam a
  // tela com findBy*.
  return render(
    <MemoryRouter>
      <CarregamentoDeTela>
        <Inicio />
      </CarregamentoDeTela>
    </MemoryRouter>
  );
}

const chamadasDeChamados = () => api.get.mock.calls.filter(([url]) => url === '/chamados');

beforeEach(() => {
  api.get.mockReset();
});

describe('Quem pede', () => {
  it('recebe "Meus pedidos", não a lista de operação', async () => {
    montarComo('solicitante');
    expect(await screen.findByRole('heading', { level: 1, name: 'Meus pedidos' })).toBeTruthy();
  });

  it('não ganha o seletor com os sete estados do fluxo', async () => {
    montarComo('solicitante');
    await screen.findByRole('heading', { level: 1 });

    // "Em triagem" e "Aguardando material" descrevem onde o chamado está no
    // fluxo interno, não o que houve com o pedido de quem o fez. Filtrar três
    // itens por sete categorias é trabalho sem retorno.
    expect(screen.queryByLabelText('Estado')).toBeNull();
    expect(screen.queryByText('Somente atrasados')).toBeNull();
  });

  it('diz o estado em português comum, além do badge', async () => {
    montarComo('solicitante');
    expect(
      await screen.findByText('O técnico está trabalhando neste chamado agora.')
    ).toBeTruthy();
  });

  it('mantém a busca por protocolo (RF03)', async () => {
    // A primeira versão desta tela perdeu a caixa de busca sem decisão
    // nenhuma — ela só não foi copiada junto do resto. Quem pegou foram os
    // testes de ponta a ponta, minutos depois. Este pega na hora.
    montarComo('solicitante');
    expect(await screen.findByLabelText('Buscar')).toBeTruthy();
  });

  it('buscando, procura nas duas abas e não só na aberta', async () => {
    montarComo('solicitante');
    const campo = await screen.findByLabelText('Buscar');

    const { fireEvent, waitFor } = await import('@testing-library/react');
    fireEvent.change(campo, { target: { value: 'SMP-004' } });

    // A busca vai ao servidor...
    await waitFor(
      () => {
        const ultima = chamadasDeChamados().at(-1);
        expect(ultima[1].params.busca).toBe('SMP-004');
      },
      { timeout: 2000 }
    );
    // ...e o chamado encerrado aparece mesmo com a aba "em andamento" ativa.
    // Sem isso, procurar o protocolo de um pedido já atendido devolveria
    // "nenhum chamado encontrado" para um chamado que existe.
    expect(await screen.findByText('Vazamento resolvido')).toBeTruthy();
  });

  it('resposta atrasada de uma busca antiga não sobrescreve a nova', async () => {
    // Digitar "Torneira" e logo "Porta" dispara duas consultas, e a rede não
    // garante a ordem de volta. Se a de "Torneira" chegasse por último, a
    // lista mostraria o resultado velho embaixo do texto novo.
    montarComo('solicitante');
    const campo = await screen.findByLabelText('Buscar');
    const { fireEvent, waitFor } = await import('@testing-library/react');

    const segurar = {};
    api.get.mockImplementation((url, config = {}) => {
      const termo = config.params?.busca;
      if (termo === 'Torneira' || termo === 'Porta') {
        return new Promise((resolve) => {
          segurar[termo] = () => servidor(url, config).then(resolve);
        });
      }
      return servidor(url, config);
    });

    fireEvent.change(campo, { target: { value: 'Torneira' } });
    await waitFor(() => expect(segurar.Torneira).toBeDefined(), { timeout: 2000 });
    fireEvent.change(campo, { target: { value: 'Porta' } });
    await waitFor(() => expect(segurar.Porta).toBeDefined(), { timeout: 2000 });

    // A nova volta primeiro; a velha, depois.
    segurar.Porta();
    expect(await screen.findByText('Porta emperrada')).toBeTruthy();
    segurar.Torneira();
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText('Torneira pingando')).toBeNull();
    expect(screen.getByText('Porta emperrada')).toBeTruthy();
  });

  it('separa o que corre do que já terminou, no servidor', async () => {
    montarComo('solicitante');
    await screen.findByRole('heading', { level: 1 });
    await screen.findByText('Torneira pingando');

    // O corte é pedido ao servidor. Feito no navegador sobre uma página de
    // cem, quem passasse de cem pedidos perdia os mais antigos em aberto.
    const primeira = chamadasDeChamados().find(([, c]) => c?.params?.limite !== 1);
    expect(primeira[1].params.situacao).toBe('abertos');

    // O concluído não aparece na aba de em andamento.
    expect(screen.queryByText('Vazamento resolvido')).toBeNull();
    expect(screen.getByText('Torneira pingando')).toBeTruthy();
  });
});

describe('Quem executa', () => {
  it('recebe "Minha fila"', async () => {
    montarComo('tecnico');
    expect(await screen.findByRole('heading', { level: 1, name: 'Minha fila' })).toBeTruthy();
  });

  it('pede a lista ordenada por prazo, e só o que está em aberto', async () => {
    montarComo('tecnico');
    await screen.findByRole('heading', { level: 1 });

    // Sem `ordenar` a fila chega na ordem de chegada. Sem `situacao`, os
    // encerrados — prazos mais antigos — ocupam a página primeiro, e com
    // histórico longo a fila aparece vazia com trabalho designado.
    const [, config] = chamadasDeChamados()[0];
    expect(config.params.ordenar).toBe('prazo');
    expect(config.params.situacao).toBe('abertos');
  });

  it('separa o que trava no técnico do que trava em terceiro', async () => {
    montarComo('tecnico');
    const emExecucao = await screen.findByRole('heading', { level: 2, name: /Em execução/ });
    const aFazer = screen.getByRole('heading', { level: 2, name: /A fazer/ });
    const material = screen.getByRole('heading', { level: 2, name: /Aguardando material/ });

    // Os três grupos existem e cada chamado está no seu.
    const secao = (titulo) => titulo.closest('section');
    expect(within(secao(emExecucao)).getByText('Torneira pingando')).toBeTruthy();
    expect(within(secao(aFazer)).getByText('Lâmpada queimada')).toBeTruthy();
    expect(within(secao(material)).getByText('Porta emperrada')).toBeTruthy();
  });

  it('não mostra contagem regressiva no que está aguardando material', async () => {
    montarComo('tecnico');
    const material = await screen.findByRole('heading', { level: 2, name: /Aguardando material/ });

    // Ali o prazo está suspenso. Mostrar "vence em 10 horas" seria apressar
    // quem não pode agir, sobre um relógio que não está correndo.
    const secao = material.closest('section');
    expect(within(secao).queryByText(/vence em/)).toBeNull();
    // E no grupo que pode agir, o prazo aparece.
    const aFazer = screen.getByRole('heading', { level: 2, name: /A fazer/ }).closest('section');
    expect(within(aFazer).getByText(/vence em/)).toBeTruthy();
  });
});

describe('Quem distribui', () => {
  it('recebe a lista completa com os três números no topo', async () => {
    montarComo('gestor');
    expect(await screen.findByRole('heading', { level: 1, name: 'Chamados' })).toBeTruthy();
    expect(await screen.findByText('Sem técnico')).toBeTruthy();
    expect(screen.getByText('Atrasados')).toBeTruthy();
    expect(screen.getByText('Em aberto')).toBeTruthy();
  });

  it('pergunta ao servidor quantos estão sem técnico', async () => {
    montarComo('gestor');
    await screen.findByText('Sem técnico');

    // É o recorte que a API não sabia responder até agora, e o único em que
    // ninguém está com o chamado.
    const pediuSemTecnico = chamadasDeChamados().some(
      ([, config]) => config?.params?.sem_tecnico === 'true'
    );
    expect(pediuSemTecnico).toBe(true);
  });

  it('o número de "em aberto" não é o total da lista', async () => {
    montarComo('gestor');
    // São 4 chamados, 3 em aberto. Se a tela usasse o total da listagem,
    // mostraria 4 — e a escala contra a qual os outros dois números são
    // lidos estaria errada.
    const cartao = (await screen.findByText('Em aberto')).closest('div');
    expect(within(cartao).getByText('3')).toBeTruthy();
  });

  it('conta "em aberto" com uma consulta leve, não com o relatório inteiro', async () => {
    montarComo('gestor');
    await screen.findByText('Em aberto');
    // O painel lia um número de /relatorios/resumo, que roda cinco consultas
    // de agregação e descartava quatro.
    expect(api.get.mock.calls.some(([url]) => url === '/relatorios/resumo')).toBe(false);
    const pediu = chamadasDeChamados().some(
      ([, c]) => c?.params?.situacao === 'abertos' && Number(c?.params?.limite) === 1
    );
    expect(pediu).toBe(true);
  });
});

describe('Perfil desconhecido', () => {
  it('cai na tela mais restrita, não numa tela de gestão', async () => {
    montarComo('perfil_que_ainda_nao_existe');
    // Ver de menos por engano é recuperável; ver de mais, não.
    expect(await screen.findByRole('heading', { level: 1, name: 'Meus pedidos' })).toBeTruthy();
  });
});

describe('prazoEmPalavras', () => {
  const agora = new Date('2026-09-23T12:00:00Z').getTime();

  it('conta em minutos abaixo de uma hora', () => {
    expect(prazoEmPalavras('2026-09-23T12:40:00Z', agora)).toEqual({
      vencido: false,
      texto: 'vence em 40 minutos',
    });
  });

  it('conta em horas dentro do dia', () => {
    expect(prazoEmPalavras('2026-09-23T15:00:00Z', agora).texto).toBe('vence em 3 horas');
  });

  it('conta em dias acima de 24 horas', () => {
    expect(prazoEmPalavras('2026-09-25T12:00:00Z', agora).texto).toBe('vence em 2 dias');
  });

  it('diz que venceu, e há quanto tempo', () => {
    const r = prazoEmPalavras('2026-09-22T12:00:00Z', agora);
    expect(r.vencido).toBe(true);
    expect(r.texto).toBe('venceu há 1 dia');
  });

  it('devolve null sem prazo, em vez de inventar urgência', () => {
    expect(prazoEmPalavras(null, agora)).toBeNull();
    expect(prazoEmPalavras('nao e uma data', agora)).toBeNull();
  });

  it('na fronteira, sobe de unidade em vez de escrever "60 minutos"', () => {
    // A faixa era escolhida antes de arredondar: 59 min 45 s caía nos minutos
    // e virava "60 minutos"; 23 h 40 min caía nas horas e virava "24 horas".
    expect(prazoEmPalavras('2026-09-23T12:59:45Z', agora).texto).toBe('vence em 1 hora');
    expect(prazoEmPalavras('2026-09-24T11:40:00Z', agora).texto).toBe('vence em 1 dia');
  });

  it('não escreve "1 horas"', () => {
    expect(prazoEmPalavras('2026-09-23T13:00:00Z', agora).texto).toBe('vence em 1 hora');
  });
});

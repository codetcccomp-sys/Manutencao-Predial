import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const usuarioAtual = { valor: null };
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ usuario: usuarioAtual.valor }),
}));

import api from '../src/api/client';
import Inicio from '../src/pages/Inicio';
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
  },
  {
    id: 2,
    protocolo: 'SMP-002',
    titulo: 'Lâmpada queimada',
    estado: 'atribuido',
    prioridade: 'baixa',
    prazo_estimado: daqui(30),
    em_atraso: false,
  },
  {
    id: 3,
    protocolo: 'SMP-003',
    titulo: 'Porta emperrada',
    estado: 'aguardando_material',
    prioridade: 'alta',
    prazo_estimado: daqui(10),
    em_atraso: false,
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

function montarComo(perfil) {
  usuarioAtual.valor = { id: 9, nome: 'Fulano', perfil };
  api.get.mockImplementation((url) => {
    if (url === '/relatorios/resumo') {
      return Promise.resolve({ data: { totais: { em_aberto: 12 } } });
    }
    return Promise.resolve({
      data: { chamados: CHAMADOS, paginacao: { pagina: 1, limite: 20, total: 4, paginas: 1 } },
    });
  });
  return render(
    <MemoryRouter>
      <Inicio />
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

  it('separa o que corre do que já terminou', async () => {
    montarComo('solicitante');
    await screen.findByRole('heading', { level: 1 });

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

  it('pede a lista ordenada por prazo', async () => {
    montarComo('tecnico');
    await screen.findByRole('heading', { level: 1 });

    // Sem isto a fila chega na ordem de chegada, e nenhum agrupamento no
    // navegador conserta: o que ficou fora da página não tem como ser
    // reordenado aqui.
    const [, config] = chamadasDeChamados()[0];
    expect(config.params.ordenar).toBe('prazo');
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
    // A lista devolve 4 chamados; o resumo diz 12 em aberto. Se a tela usasse
    // o total da listagem, mostraria 4 — e a escala contra a qual os outros
    // dois números são lidos estaria errada.
    expect(await screen.findByText('12')).toBeTruthy();
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

  it('não escreve "1 horas"', () => {
    expect(prazoEmPalavras('2026-09-23T13:00:00Z', agora).texto).toBe('vence em 1 hora');
  });
});

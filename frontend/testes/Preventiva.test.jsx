import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const usuarioAtual = { valor: { id: 1, nome: 'Gestora', perfil: 'gestor' } };
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ usuario: usuarioAtual.valor }),
}));

import api from '../src/api/client';
import Preventiva from '../src/pages/Preventiva';
import Equipamento from '../src/pages/Equipamento';
import NovoChamado from '../src/pages/NovoChamado';
import { aberturaDaJanela, descreverPeriodicidade, formatarDia, hojeLocal } from '../src/dominio/preventiva';

const LOCAIS = [
  { id: 1, unidade: 'Prédio A', bloco: '1', pavimento: null, setor: null, ambiente: 'Sala 204', ativo: true },
  { id: 2, unidade: 'Prédio B', bloco: null, pavimento: null, setor: null, ambiente: null, ativo: true },
];
const CATEGORIAS = [
  { id: 10, nome: 'climatização' },
  { id: 11, nome: 'hidráulica' },
];
const EQUIPAMENTO = {
  id: 7,
  codigo: 'AC-204',
  nome: 'Split 12.000 BTU',
  categoria_id: 10,
  categoria_nome: 'climatização',
  local_id: 1,
  local_rotulo: 'Prédio A / 1 / Sala 204',
  ativo: true,
};
const PLANO = {
  id: 3,
  titulo: 'Limpeza do filtro',
  equipamento_id: 7,
  equipamento_codigo: 'AC-204',
  equipamento_nome: 'Split 12.000 BTU',
  local_rotulo: 'Prédio A / 1 / Sala 204',
  categoria_nome: 'climatização',
  repetir_a_cada: 3,
  unidade_repeticao: 'mes',
  proxima_execucao: '2031-03-10',
  antecedencia_dias: 5,
  tecnico_nome: 'Paulo',
  ativo: true,
  ultimo_chamado_id: 99,
  ultimo_chamado_protocolo: 'SMP-1',
  ultimo_chamado_estado: 'concluido',
  ultimo_chamado_data_prevista: '2030-12-10',
};

function respostasPadrao(caminho) {
  if (caminho === '/planos-preventivos') return { data: { planos: [PLANO] } };
  if (caminho === '/equipamentos') return { data: { equipamentos: [EQUIPAMENTO] } };
  if (caminho === '/locais') return { data: { locais: LOCAIS } };
  if (caminho === '/categorias') return { data: { categorias: CATEGORIAS } };
  if (caminho === '/usuarios') return { data: { usuarios: [{ id: 5, nome: 'Paulo', ativo: true }] } };
  return { data: {} };
}

function abrirPreventiva() {
  api.get.mockImplementation(async (caminho) => respostasPadrao(caminho));
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });
  return render(
    <MemoryRouter>
      <Preventiva />
    </MemoryRouter>
  );
}

describe('janela de antecedência', () => {
  it('é a próxima execução menos a antecedência, atravessando mês e ano', () => {
    expect(aberturaDaJanela({ proxima_execucao: '2026-11-03', antecedencia_dias: 3 })).toBe('2026-10-31');
    expect(aberturaDaJanela({ proxima_execucao: '2027-01-02', antecedencia_dias: 5 })).toBe('2026-12-28');
    expect(aberturaDaJanela({ proxima_execucao: '2027-03-01', antecedencia_dias: 1 })).toBe('2027-02-28');
    expect(aberturaDaJanela({ proxima_execucao: '2026-11-03', antecedencia_dias: 0 })).toBe('2026-11-03');
  });
});

describe('vocabulário da preventiva', () => {
  it('descreve a periodicidade como o histórico do chamado escreve', () => {
    expect(descreverPeriodicidade(1, 'mes')).toBe('a cada mês');
    expect(descreverPeriodicidade(3, 'mes')).toBe('a cada 3 meses');
    expect(descreverPeriodicidade(2, 'semana')).toBe('a cada 2 semanas');
  });

  it('formata a data de calendário sem passar por fuso (o dia não "volta" um)', () => {
    expect(formatarDia('2031-03-10')).toBe('10/03/2031');
    expect(formatarDia(null)).toBe('');
  });
});

describe('Tela de manutenção preventiva', () => {
  it('lista o plano com periodicidade, próxima data, antecedência e responsável', async () => {
    abrirPreventiva();
    const item = (await screen.findByText('Limpeza do filtro')).closest('li');
    expect(within(item).getByText(/a cada 3 meses/i)).toBeInTheDocument();
    expect(within(item).getByText('10/03/2031')).toBeInTheDocument();
    expect(within(item).getByText(/gerada 5 dias antes/)).toBeInTheDocument();
    expect(within(item).getByText(/responsável: Paulo/)).toBeInTheDocument();
    expect(within(item).getByRole('link', { name: 'SMP-1' })).toHaveAttribute('href', '/chamados/99');
  });

  it('com equipamento escolhido, não pede local nem categoria, e manda números', async () => {
    const usuario = userEvent.setup();
    abrirPreventiva();
    await screen.findByText('Limpeza do filtro');

    await usuario.type(screen.getByLabelText('Serviço'), 'Troca do filtro');
    await usuario.type(screen.getByLabelText('Roteiro'), 'Trocar o filtro e medir a corrente.');
    // Local e categoria escolhidos ANTES do equipamento: os campos somem, mas o
    // valor ficaria no estado — e não pode ir junto, senão a API compara com o
    // local do equipamento e recusa.
    await usuario.selectOptions(screen.getByLabelText('Local'), '2');
    await usuario.selectOptions(screen.getByLabelText('Categoria'), '11');
    await usuario.selectOptions(screen.getByLabelText('Equipamento'), '7');
    expect(screen.queryByLabelText('Local')).toBeNull();

    await usuario.clear(screen.getByLabelText('Repetir a cada'));
    await usuario.type(screen.getByLabelText('Repetir a cada'), '6');
    await usuario.type(screen.getByLabelText('Próxima execução'), '2031-05-01');
    await usuario.selectOptions(screen.getByLabelText('Responsável'), '5');
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar plano' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [caminho, corpo] = api.post.mock.calls[0];
    expect(caminho).toBe('/planos-preventivos');
    expect(corpo).toMatchObject({
      titulo: 'Troca do filtro',
      equipamento_id: 7,
      repetir_a_cada: 6,
      unidade_repeticao: 'mes',
      proxima_execucao: '2031-05-01',
      antecedencia_dias: 0,
      tecnico_id: 5,
    });
    expect(corpo.local_id).toBeUndefined();
    expect(corpo.categoria_id).toBeUndefined();
  });

  it('"Gerar agora" fora da janela pergunta antes, e confirmado diz qual chamado saiu', async () => {
    const usuario = userEvent.setup();
    abrirPreventiva();
    api.post.mockResolvedValueOnce({ data: { gerado: { protocolo: 'SMP-77', dataPrevista: '2031-03-10' } } });

    await usuario.click(await screen.findByRole('button', { name: 'Gerar agora' }));

    // A execução de 10/03/2031 só entraria na janela em 05/03/2031: gerar hoje
    // é antecipar, e isso pergunta antes.
    const dialogo = await screen.findByRole('dialog', { name: 'Antecipar a preventiva?' });
    expect(dialogo).toHaveTextContent('10/03/2031');
    expect(dialogo).toHaveTextContent('05/03/2031');
    expect(api.post).not.toHaveBeenCalledWith('/planos-preventivos/3/gerar');

    await usuario.click(within(dialogo).getByRole('button', { name: 'Gerar agora' }));

    expect(api.post).toHaveBeenCalledWith('/planos-preventivos/3/gerar');
    expect(await screen.findByText('Chamado SMP-77 gerado, previsto para 10/03/2031.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('desistir da antecipação não gera nada', async () => {
    const usuario = userEvent.setup();
    abrirPreventiva();

    await usuario.click(await screen.findByRole('button', { name: 'Gerar agora' }));
    await usuario.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Voltar' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.post).not.toHaveBeenCalledWith('/planos-preventivos/3/gerar');
  });

  describe('dentro da janela de antecedência', () => {
    // A próxima execução daqui a dois dias, com cinco de antecedência: o
    // agendador já geraria hoje, então não há o que perguntar.
    const daqui = (dias) => {
      const d = new Date();
      d.setDate(d.getDate() + dias);
      return hojeLocal(d);
    };
    const abrirNaJanela = () => {
      api.get.mockImplementation(async (caminho) =>
        caminho === '/planos-preventivos'
          ? { data: { planos: [{ ...PLANO, proxima_execucao: daqui(2) }] } }
          : respostasPadrao(caminho)
      );
      api.post.mockResolvedValue({ data: {} });
      return render(
        <MemoryRouter>
          <Preventiva />
        </MemoryRouter>
      );
    };

    it('gera direto, sem perguntar', async () => {
      const usuario = userEvent.setup();
      abrirNaJanela();
      api.post.mockResolvedValueOnce({ data: { gerado: { protocolo: 'SMP-78', dataPrevista: daqui(2) } } });

      await usuario.click(await screen.findByRole('button', { name: 'Gerar agora' }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(api.post).toHaveBeenCalledWith('/planos-preventivos/3/gerar');
    });

    it('clique duplo gera uma vez só: o botão trava enquanto o pedido anda', async () => {
      const usuario = userEvent.setup();
      abrirNaJanela();
      let responder;
      api.post.mockImplementationOnce(
        () =>
          new Promise((resolver) => {
            responder = resolver;
          })
      );

      const botao = await screen.findByRole('button', { name: 'Gerar agora' });
      await usuario.dblClick(botao);
      await usuario.click(botao);

      expect(api.post.mock.calls.filter(([caminho]) => caminho === '/planos-preventivos/3/gerar')).toHaveLength(1);
      expect(botao).toBeDisabled();

      responder({ data: { gerado: { protocolo: 'SMP-79', dataPrevista: daqui(2) } } });
      expect(await screen.findByText(/Chamado SMP-79 gerado/)).toBeInTheDocument();
    });
  });

  it('cadastra equipamento e mostra o erro da API quando o código já existe', async () => {
    const usuario = userEvent.setup();
    abrirPreventiva();
    await screen.findByText('Limpeza do filtro');
    await usuario.click(screen.getByRole('button', { name: 'Equipamentos', pressed: false }));

    api.post.mockRejectedValueOnce({
      response: { data: { erro: { mensagem: 'Já existe um equipamento com este código.' } } },
    });
    await usuario.type(screen.getByLabelText('Código'), 'ac-204');
    await usuario.type(screen.getByLabelText('Nome'), 'Outro split');
    await usuario.selectOptions(screen.getByLabelText('Local'), '1');
    await usuario.selectOptions(screen.getByLabelText('Categoria'), '10');
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar equipamento' }));

    expect(await screen.findByText('Já existe um equipamento com este código.')).toBeInTheDocument();
    expect(api.post.mock.calls[0][1]).toMatchObject({ codigo: 'ac-204', local_id: 1, categoria_id: 10 });
    // O que a pessoa digitou fica, para corrigir só o código.
    expect(screen.getByLabelText('Nome')).toHaveValue('Outro split');
  });

  it('as seções são botões com estado, e não um tablist que promete setas que não existem', async () => {
    const usuario = userEvent.setup();
    abrirPreventiva();
    await screen.findByText('Limpeza do filtro');

    // Aba exige setas do teclado, tabpanel e aria-controls; nada disso existia.
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();

    const grupo = screen.getByRole('group', { name: 'Seções da manutenção preventiva' });
    const planos = within(grupo).getByRole('button', { name: 'Planos' });
    const equipamentos = within(grupo).getByRole('button', { name: 'Equipamentos' });
    expect(planos).toHaveAttribute('aria-pressed', 'true');
    expect(equipamentos).toHaveAttribute('aria-pressed', 'false');

    await usuario.click(equipamentos);

    expect(equipamentos).toHaveAttribute('aria-pressed', 'true');
    expect(planos).toHaveAttribute('aria-pressed', 'false');
  });

  it('não é tela de solicitante', () => {
    usuarioAtual.valor = { id: 2, nome: 'Jorge', perfil: 'solicitante' };
    try {
      abrirPreventiva();
      expect(screen.queryByText('Manutenção preventiva')).toBeNull();
    } finally {
      usuarioAtual.valor = { id: 1, nome: 'Gestora', perfil: 'gestor' };
    }
  });
});

function abrirFicha(equipamento) {
  api.get.mockResolvedValue({ data: { equipamento } });
  return render(
    <MemoryRouter initialEntries={['/equipamentos/7']}>
      <Routes>
        <Route path="/equipamentos/:id" element={<Equipamento />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Ficha do equipamento', () => {
  const FICHA = {
    ...EQUIPAMENTO,
    fabricante: 'Fabricante X',
    data_instalacao: '2024-05-02',
    totais: { chamados: 4, corretivos: 3, preventivos: 1, corretivos_12_meses: 3 },
    planos: [{ id: 3, titulo: 'Limpeza do filtro', repetir_a_cada: 3, unidade_repeticao: 'mes', proxima_execucao: '2031-03-10', ativo: true }],
    chamados: [
      {
        id: 50,
        protocolo: 'SMP-50',
        titulo: 'Pingando água',
        estado: 'concluido',
        origem: 'corretiva',
        data_abertura: '2026-09-01T12:00:00Z',
        data_conclusao: '2026-09-02T12:00:00Z',
        servico_realizado: 'Dreno desobstruído.',
      },
    ],
  };

  it('mostra cadastro, números e histórico, e aponta quando quebra demais', async () => {
    abrirFicha(FICHA);
    expect(await screen.findByRole('heading', { name: 'Split 12.000 BTU' })).toBeInTheDocument();
    expect(screen.getByText('02/05/2024')).toBeInTheDocument();
    expect(screen.getByText(/Três ou mais corretivos em um ano/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pingando água' })).toHaveAttribute('href', '/chamados/50');
    expect(screen.getByText('Serviço: Dreno desobstruído.')).toBeInTheDocument();
    // O atalho para abrir chamado leva o código, como o QR Code levaria.
    expect(screen.getByRole('link', { name: 'Abrir chamado para ele' })).toHaveAttribute(
      'href',
      '/chamados/novo?equipamento=AC-204'
    );
  });

  it('sem histórico na resposta (solicitante), mostra só o cadastro', async () => {
    abrirFicha(EQUIPAMENTO);
    expect(await screen.findByRole('heading', { name: 'Split 12.000 BTU' })).toBeInTheDocument();
    expect(screen.queryByText('Histórico de chamados')).toBeNull();
    expect(screen.queryByText('Em números')).toBeNull();
  });
});

/** A prioridade sai da situação informada (RF04): sem as três respostas o formulário não envia. */
async function responderSituacao(usuario) {
  for (const nome of ['Não', 'Só incomoda; tudo funciona', 'Pode esperar alguns dias']) {
    await usuario.click(screen.getByRole('radio', { name: nome }));
  }
}

function abrirNovoChamado(url = '/chamados/novo') {
  api.get.mockImplementation(async (caminho, opcoes) => {
    if (caminho === '/equipamentos/codigo/AC-204') return { data: { equipamento: EQUIPAMENTO } };
    if (caminho.startsWith('/equipamentos/codigo/')) throw { response: { status: 404 } };
    if (caminho === '/equipamentos') {
      return {
        data: { equipamentos: String(opcoes?.params?.local_id) === '1' ? [EQUIPAMENTO] : [] },
      };
    }
    return respostasPadrao(caminho);
  });
  api.post.mockResolvedValue({ data: { chamado: { id: 123 } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/chamados/novo" element={<NovoChamado />} />
        <Route path="/chamados/:id" element={<p>Chamado aberto</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Abrir chamado para um equipamento', () => {
  it('pelo endereço do QR Code, chega com equipamento, local e categoria escolhidos', async () => {
    const usuario = userEvent.setup();
    abrirNovoChamado('/chamados/novo?equipamento=AC-204');

    expect(await screen.findByText('Chamado para este equipamento')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Equipamento')).toHaveValue('7'));
    expect(screen.getByLabelText('Local')).toHaveValue('1');
    expect(screen.getByLabelText('Categoria')).toHaveValue('10');

    await usuario.type(screen.getByLabelText('Título'), 'Pingando água');
    await usuario.type(screen.getByLabelText('Descrição'), 'Escorre pela parede.');
    await responderSituacao(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Abrir chamado' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1]).toMatchObject({ equipamento_id: 7, local_id: 1, categoria_id: 10 });
    expect(await screen.findByText('Chamado aberto')).toBeInTheDocument();
  });

  it('código que não existe avisa e deixa escolher o local à mão', async () => {
    abrirNovoChamado('/chamados/novo?equipamento=NAO-EXISTE');
    expect(await screen.findByText(/não corresponde a nenhum equipamento ativo/)).toBeInTheDocument();
    expect(screen.getByLabelText('Local')).toHaveValue('');
  });

  it('trocar o local solta o equipamento escolhido', async () => {
    const usuario = userEvent.setup();
    abrirNovoChamado();

    await screen.findByRole('option', { name: 'Prédio A / 1 / Sala 204' });
    await usuario.selectOptions(screen.getByLabelText('Local'), '1');
    await usuario.selectOptions(await screen.findByLabelText('Equipamento'), '7');
    // A categoria vem do equipamento quando ainda não havia uma.
    expect(screen.getByLabelText('Categoria')).toHaveValue('10');

    await usuario.selectOptions(screen.getByLabelText('Local'), '2');
    await waitFor(() => expect(screen.queryByLabelText('Equipamento')).toBeNull());

    await usuario.type(screen.getByLabelText('Título'), 'Lâmpada queimada');
    await usuario.type(screen.getByLabelText('Descrição'), 'Corredor escuro.');
    await responderSituacao(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Abrir chamado' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1].equipamento_id).toBeUndefined();
    expect(api.post.mock.calls[0][1].local_id).toBe(2);
  });
});

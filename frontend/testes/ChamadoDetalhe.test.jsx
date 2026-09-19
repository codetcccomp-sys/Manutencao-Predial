import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-router-dom', async () => {
  const real = await vi.importActual('react-router-dom');
  return { ...real, useParams: () => ({ id: '7' }) };
});

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const usuarioAtual = { valor: null };
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ usuario: usuarioAtual.valor }),
}));

import api from '../src/api/client';
import ChamadoDetalhe from '../src/pages/ChamadoDetalhe';
import { conferirCabecalhos } from './apoio/cabecalhos';

const SOLICITANTE = { id: 10, nome: 'Maria', perfil: 'solicitante' };
const TECNICO = { id: 20, nome: 'João', perfil: 'tecnico' };
const GESTOR = { id: 30, nome: 'Ana', perfil: 'gestor' };

function chamado(extra = {}) {
  return {
    id: 7,
    protocolo: 'SMP-20260101-ABCDEF',
    titulo: 'Infiltração no auditório',
    descricao: 'Mancha de umidade crescendo na parede oeste.',
    estado: 'aberto',
    prioridade: 'baixa',
    solicitante_id: SOLICITANTE.id,
    tecnico_id: null,
    categoria_id: 1,
    local_id: 1,
    local_rotulo: 'Bloco A / Térreo / Auditório',
    categoria_nome: 'Hidráulica',
    prazo_estimado: null,
    em_atraso: false,
    total_reaberturas: 0,
    data_conclusao: null,
    historico: [],
    ...extra,
  };
}

function montar({ como, dados = chamado(), comentarios = [] } = {}) {
  usuarioAtual.valor = como;

  api.get.mockImplementation(async (caminho) => {
    if (caminho === '/chamados/7') return { data: { chamado: dados } };
    if (caminho === '/chamados/7/anexos') return { data: { anexos: [] } };
    if (caminho === '/chamados/7/comentarios') return { data: { comentarios } };
    if (caminho === '/usuarios') return { data: { usuarios: [] } };
    if (caminho === '/categorias') return { data: { categorias: [{ id: 1, nome: 'Hidráulica' }] } };
    if (caminho === '/locais') return { data: { locais: [{ id: 1, unidade: 'Bloco A' }] } };
    return { data: {} };
  });
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });

  return render(
    <MemoryRouter>
      <ChamadoDetalhe />
    </MemoryRouter>
  );
}

const corrigir = () => screen.queryByRole('button', { name: 'Corrigir' });
const campoComentario = () => screen.queryByPlaceholderText('Escreva um comentário');

describe('RN03: janela de edição do solicitante', () => {
  it('quem abriu corrige enquanto o chamado está aberto', async () => {
    montar({ como: SOLICITANTE });
    await waitFor(() => expect(corrigir()).toBeInTheDocument());
  });

  it('ainda corrige durante a triagem', async () => {
    montar({ como: SOLICITANTE, dados: chamado({ estado: 'em_triagem' }) });
    await waitFor(() => expect(corrigir()).toBeInTheDocument());
  });

  it('perde a janela depois da atribuição', async () => {
    montar({
      como: SOLICITANTE,
      dados: chamado({ estado: 'atribuido', tecnico_id: TECNICO.id }),
    });

    await waitFor(() => expect(screen.getByText('Infiltração no auditório')).toBeInTheDocument());
    expect(corrigir()).toBeNull();
  });

  it('mas o comentário continua aberto — é a outra metade da regra', async () => {
    montar({
      como: SOLICITANTE,
      dados: chamado({ estado: 'atribuido', tecnico_id: TECNICO.id }),
    });

    // A RN03 não fecha a porta, muda a porta: "alterações deverão ocorrer por
    // comentário ou ação autorizada".
    await waitFor(() => expect(campoComentario()).toBeInTheDocument());
  });

  it('a gestão edita mesmo depois da atribuição', async () => {
    montar({ como: GESTOR, dados: chamado({ estado: 'em_andamento', tecnico_id: TECNICO.id }) });
    await waitFor(() => expect(corrigir()).toBeInTheDocument());
  });

  it('ninguém edita chamado encerrado', async () => {
    montar({ como: GESTOR, dados: chamado({ estado: 'concluido' }) });

    await waitFor(() => expect(screen.getByText('Infiltração no auditório')).toBeInTheDocument());
    expect(corrigir()).toBeNull();
  });

  it('o técnico designado não edita o texto do chamado', async () => {
    montar({ como: TECNICO, dados: chamado({ estado: 'em_andamento', tecnico_id: TECNICO.id }) });

    await waitFor(() => expect(screen.getByText('Infiltração no auditório')).toBeInTheDocument());
    expect(corrigir()).toBeNull();
  });
});

describe('Quando o chamado não pode ser lido', () => {
  it('mostra o erro do chamado, não o dos anexos', async () => {
    usuarioAtual.valor = SOLICITANTE;
    api.get.mockImplementation(async (caminho) => {
      if (caminho === '/chamados/7') throw { response: { status: 403 } };
      return { data: { anexos: [], comentarios: [] } };
    });

    render(
      <MemoryRouter>
        <ChamadoDetalhe />
      </MemoryRouter>
    );

    // As três chamadas falhavam juntas e a última a responder vencia: quem
    // recebia 403 no chamado lia "não foi possível carregar os anexos" — uma
    // explicação errada para um acesso negado.
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar o chamado.')).toBeInTheDocument()
    );
    expect(screen.queryByText(/anexos|comentários/i)).toBeNull();
  });

  it('nem pede anexos e comentários de um chamado que não carregou', async () => {
    usuarioAtual.valor = SOLICITANTE;
    api.get.mockImplementation(async (caminho) => {
      if (caminho === '/chamados/7') throw { response: { status: 403 } };
      return { data: { anexos: [], comentarios: [] } };
    });

    render(
      <MemoryRouter>
        <ChamadoDetalhe />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar o chamado.')).toBeInTheDocument()
    );

    // Quem não pode ler o chamado também não pode ler o resto: duas
    // requisições condenadas a menos.
    const caminhos = api.get.mock.calls.map(([c]) => c);
    expect(caminhos).not.toContain('/chamados/7/anexos');
    expect(caminhos).not.toContain('/chamados/7/comentarios');
  });
});

describe('Comentários', () => {
  it('chamado encerrado mostra a conversa mas não o campo', async () => {
    montar({
      como: SOLICITANTE,
      dados: chamado({ estado: 'concluido' }),
      comentarios: [
        {
          id: 1,
          texto: 'Continuou pingando depois do conserto.',
          data: new Date().toISOString(),
          usuario_id: SOLICITANTE.id,
          usuario_nome: 'Maria',
          usuario_perfil: 'solicitante',
        },
      ],
    });

    await waitFor(() =>
      expect(screen.getByText('Continuou pingando depois do conserto.')).toBeInTheDocument()
    );
    expect(campoComentario()).toBeNull();
    // Fechar para escrita não é apagar — e a tela diz por quê.
    expect(screen.getByText(/não recebe novos comentários/)).toBeInTheDocument();
  });

  it('mostra quem escreveu e com que perfil', async () => {
    montar({
      como: GESTOR,
      comentarios: [
        {
          id: 1,
          texto: 'Vou verificar com a equipe.',
          data: new Date().toISOString(),
          usuario_id: TECNICO.id,
          usuario_nome: 'João',
          usuario_perfil: 'tecnico',
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('Vou verificar com a equipe.')).toBeInTheDocument());
    expect(screen.getByText('João')).toBeInTheDocument();
    expect(screen.getByText('(tecnico)')).toBeInTheDocument();
  });

  it('envia o texto sem espaços nas pontas e limpa o campo', async () => {
    const usuario = userEvent.setup();
    montar({ como: SOLICITANTE });
    await waitFor(() => expect(campoComentario()).toBeInTheDocument());

    api.post.mockResolvedValue({
      data: {
        comentario: {
          id: 9,
          texto: 'texto novo',
          data: new Date().toISOString(),
          usuario_id: SOLICITANTE.id,
          usuario_nome: 'Maria',
          usuario_perfil: 'solicitante',
        },
      },
    });

    await usuario.type(campoComentario(), '  texto novo  ');
    await usuario.click(screen.getByRole('button', { name: 'Comentar' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/chamados/7/comentarios', { texto: 'texto novo' })
    );
    await waitFor(() => expect(campoComentario()).toHaveValue(''));
  });

  it('o botão fica desabilitado enquanto não há o que enviar', async () => {
    const usuario = userEvent.setup();
    montar({ como: SOLICITANTE });
    await waitFor(() => expect(campoComentario()).toBeInTheDocument());

    const botao = screen.getByRole('button', { name: 'Comentar' });
    expect(botao).toBeDisabled();

    await usuario.type(campoComentario(), '   ');
    // Só espaço não é comentário: o servidor recusaria, e deixar clicar
    // ensinaria a pessoa a esperar um erro.
    expect(botao).toBeDisabled();
  });

  it('recusa do servidor aparece na tela', async () => {
    const usuario = userEvent.setup();
    montar({ como: SOLICITANTE });
    await waitFor(() => expect(campoComentario()).toBeInTheDocument());

    api.post.mockRejectedValue({
      response: { data: { erro: { mensagem: 'Este chamado está encerrado.' } } },
    });

    await usuario.type(campoComentario(), 'tentativa');
    await usuario.click(screen.getByRole('button', { name: 'Comentar' }));

    await waitFor(() =>
      expect(screen.getByText('Este chamado está encerrado.')).toBeInTheDocument()
    );
  });
});

describe('Rótulos com acento', () => {
  it('escreve a prioridade por extenso, acentuada', async () => {
    montar({ como: GESTOR, dados: chamado({ prioridade: 'critica' }) });

    // Aparece em mais de um lugar (o resumo e o seletor de priorização), daí
    // o getAllBy: o que este teste verifica é a grafia, não a contagem.
    await waitFor(() => expect(screen.getAllByText('Crítica').length).toBeGreaterThan(0));
    // Um `capitalize` sobre o valor cru do banco escrevia "Critica" e "Media".
    expect(screen.queryByText('Critica')).toBeNull();
    expect(screen.queryByText('Media')).toBeNull();
  });

  it('escreve o estado por extenso', async () => {
    montar({ como: GESTOR, dados: chamado({ estado: 'aguardando_material' }) });

    await waitFor(() => expect(screen.getByText('Aguardando material')).toBeInTheDocument());
    expect(screen.queryByText('aguardando_material')).toBeNull();
  });
});

describe('Onde é o problema', () => {
  it('mostra local e categoria para quem vai atender', async () => {
    montar({ como: TECNICO, dados: chamado({ tecnico_id: TECNICO.id, estado: 'atribuido' }) });

    // O técnico designado precisa saber para onde ir. Antes isso só existia no
    // relatório e na planilha; a tela mostrava estado, prioridade e prazo.
    expect(await screen.findByText('Bloco A / Térreo / Auditório')).toBeInTheDocument();
    expect(screen.getByText('Hidráulica')).toBeInTheDocument();
  });

  it('não deixa buraco quando o servidor não manda o rótulo', async () => {
    montar({ como: SOLICITANTE, dados: chamado({ local_rotulo: undefined, categoria_nome: undefined }) });

    await screen.findByRole('heading', { name: 'Infiltração no auditório' });
    expect(screen.queryByText(/^Local:/)).toBeNull();
  });
});

describe('Histórico', () => {
  const COM_HISTORICO = [
    { id: 1, estado_novo: 'em_triagem', data: '2026-01-02T10:00:00Z', observacao: null },
    {
      id: 2,
      estado_novo: 'aguardando_material',
      data: '2026-01-03T10:00:00Z',
      observacao: 'Chamado editado: titulo',
    },
  ];

  it('escreve os estados por extenso, como o resto do sistema', async () => {
    const { container } = montar({ como: GESTOR, dados: chamado({ historico: COM_HISTORICO }) });

    // Escopado ao painel: a tela tem botões de mudança de estado com os mesmos
    // nomes, e uma busca solta acharia os dois.
    await screen.findByText(/2 registros/);
    const painel = within(container.querySelector('details'));

    // O histórico mostrava a chave crua do banco — "em_triagem",
    // "aguardando_material" — enquanto todo o resto da tela já escrevia por
    // extenso. Mesmo dado, duas grafias, na mesma página.
    expect(painel.getByText('Em triagem')).toBeInTheDocument();
    expect(painel.getByText('Aguardando material')).toBeInTheDocument();
    expect(painel.queryByText('em_triagem')).toBeNull();
  });

  it('vem recolhido, dizendo quantos registros guarda', async () => {
    montar({ como: GESTOR, dados: chamado({ historico: COM_HISTORICO }) });

    // Recolhido, mas anunciando o tamanho: "Histórico" sozinho não diz se vale
    // o clique. E é registro de auditoria — fica à mão, não no caminho.
    const detalhes = await screen.findByText(/2 registros/);
    expect(detalhes.closest('details')).not.toHaveAttribute('open');
  });

  it('a contagem concorda em singular', async () => {
    montar({ como: GESTOR, dados: chamado({ historico: [COM_HISTORICO[0]] }) });
    expect(await screen.findByText(/1 registro\b/)).toBeInTheDocument();
  });
});

describe('Hierarquia de cabeçalhos', () => {
  it('o título do chamado é o h1 e os painéis ficam um nível abaixo', async () => {
    // Como gestor e com o chamado em andamento: é o recorte em que mais
    // painéis aparecem de uma vez, e portanto o que mais tem a errar.
    const { container } = montar({
      como: GESTOR,
      dados: chamado({ estado: 'em_andamento', tecnico_id: TECNICO.id }),
    });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    const niveis = conferirCabecalhos(container);

    // A regra de "não pular nível" sozinha não prende o painel: descer de h2
    // para h3 é um passo legal, e um painel afundado um nível vira subdivisão
    // do painel anterior para quem navega por cabeçalhos. Nesta tela não há
    // subdivisão nenhuma — todo painel é irmão dos outros.
    expect(
      niveis.filter((h) => h.nivel > 2),
      'nenhum painel do chamado é subdivisão de outro: todos ficam em h2'
    ).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';

vi.mock('react-router', async () => {
  const real = await vi.importActual('react-router');
  return { ...real, useParams: () => ({ id: '7' }) };
});

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const usuarioAtual = { valor: null };
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ usuario: usuarioAtual.valor }),
}));

vi.mock('../src/monitoramento', () => ({ registrarAcao: vi.fn() }));

import api from '../src/api/client';
import { registrarAcao } from '../src/monitoramento';
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

function montar({ como, dados = chamado(), comentarios = [], tecnicos = [] } = {}) {
  usuarioAtual.valor = como;

  api.get.mockImplementation(async (caminho) => {
    if (caminho === '/chamados/7') return { data: { chamado: dados } };
    if (caminho === '/chamados/7/anexos') return { data: { anexos: [] } };
    if (caminho === '/chamados/7/comentarios') return { data: { comentarios } };
    if (caminho === '/usuarios') return { data: { usuarios: tecnicos } };
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

describe('Conclusão com confirmação de EPI', () => {
  const SERVICO = 'Trocado o registro e testada a vedação.';

  async function abrirConclusao() {
    const usuario = userEvent.setup();
    montar({ como: TECNICO, dados: chamado({ estado: 'em_andamento', tecnico_id: TECNICO.id }) });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });
    await usuario.click(screen.getByRole('button', { name: 'Concluído' }));
    return usuario;
  }

  const caixaEpi = () => screen.getByRole('checkbox', { name: /EPIs exigidos para este serviço/ });

  it('pede a confirmação junto da descrição, desmarcada e com a explicação', async () => {
    await abrirConclusao();

    // Desmarcada de propósito: marcada de antemão deixaria de ser declaração.
    expect(caixaEpi()).not.toBeChecked();
    expect(caixaEpi()).toBeRequired();
    expect(caixaEpi()).toHaveAccessibleDescription(
      'Obrigatório para concluir. Fica registrado com o seu nome e a hora.'
    );
  });

  it('sem marcar a caixa, o chamado não é concluído', async () => {
    const usuario = await abrirConclusao();

    await usuario.type(screen.getByLabelText(/Descrição do serviço executado/), SERVICO);
    await usuario.click(screen.getByRole('button', { name: 'Concluir chamado' }));

    expect(api.patch).not.toHaveBeenCalled();
  });

  it('marcada, envia a confirmação junto da descrição', async () => {
    const usuario = await abrirConclusao();

    await usuario.type(screen.getByLabelText(/Descrição do serviço executado/), `  ${SERVICO}  `);
    await usuario.click(caixaEpi());
    await usuario.click(screen.getByRole('button', { name: 'Concluir chamado' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/chamados/7/estado', {
        estado: 'concluido',
        servico_realizado: SERVICO,
        epi_confirmado: true,
      })
    );
  });

  it('desistir zera a caixa: a próxima conclusão começa desmarcada', async () => {
    const usuario = await abrirConclusao();

    await usuario.click(caixaEpi());
    expect(caixaEpi()).toBeChecked();
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));

    await usuario.click(screen.getByRole('button', { name: 'Concluído' }));
    expect(caixaEpi()).not.toBeChecked();
  });

  it('a recusa do servidor aparece na tela, e a caixa segue marcada para outra tentativa', async () => {
    const usuario = await abrirConclusao();
    api.patch.mockRejectedValueOnce({
      response: { data: { erro: { mensagem: 'A conclusão exige a confirmação do uso dos EPIs exigidos para o serviço.' } } },
    });

    await usuario.type(screen.getByLabelText(/Descrição do serviço executado/), SERVICO);
    await usuario.click(caixaEpi());
    await usuario.click(screen.getByRole('button', { name: 'Concluir chamado' }));

    expect(await screen.findByText(/exige a confirmação do uso dos EPIs/)).toBeInTheDocument();
    expect(caixaEpi()).toBeChecked();
  });

  it('o registro do atendimento diz quando o uso de EPI foi confirmado', async () => {
    montar({
      como: SOLICITANTE,
      dados: chamado({
        estado: 'concluido',
        servico_realizado: SERVICO,
        data_conclusao: '2026-10-11T15:30:00Z',
        epi_confirmado_em: '2026-10-11T15:30:00Z',
      }),
    });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    expect(screen.getByText(/Uso de EPI confirmado em/)).toBeInTheDocument();
  });

  it('chamado concluído antes da regra não inventa uma confirmação', async () => {
    montar({
      como: SOLICITANTE,
      dados: chamado({
        estado: 'concluido',
        servico_realizado: SERVICO,
        data_conclusao: '2026-07-10T15:30:00Z',
        epi_confirmado_em: null,
      }),
    });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    expect(screen.getByText(SERVICO)).toBeInTheDocument();
    expect(screen.queryByText(/Uso de EPI confirmado/)).toBeNull();
  });
});

describe('Confirmação antes do que não tem volta', () => {
  it('cancelar o chamado pergunta antes, e o botão sozinho não cancela nada', async () => {
    const usuario = userEvent.setup();
    montar({ como: GESTOR, dados: chamado({ estado: 'em_andamento', tecnico_id: TECNICO.id }) });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    await usuario.click(screen.getByRole('button', { name: 'Cancelado' }));

    // §2.4: cancelado não tem estado seguinte. O clique abre a pergunta; quem
    // muda o chamado é a resposta.
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Cancelar este chamado?');

    await usuario.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(api.patch).not.toHaveBeenCalled();

    await usuario.click(screen.getByRole('button', { name: 'Cancelado' }));
    await usuario.click(screen.getByRole('button', { name: 'Cancelar o chamado' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/chamados/7/estado', { estado: 'cancelado' })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('o técnico designado não vê o cancelar: é decisão da gestão (RN05)', async () => {
    montar({ como: TECNICO, dados: chamado({ estado: 'em_andamento', tecnico_id: TECNICO.id }) });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    // Os passos do próprio trabalho continuam ali; só o cancelar sai.
    expect(screen.getByRole('button', { name: 'Aguardando material' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Concluído' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelado' })).toBeNull();
  });

  it('retomar do aguardando material segue num clique só', async () => {
    const usuario = userEvent.setup();
    montar({ como: GESTOR, dados: chamado({ estado: 'aguardando_material', tecnico_id: TECNICO.id }) });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    // Perguntar em tudo treina a pessoa a responder "sim" sem ler — e aí a
    // pergunta que importa também passa batida. Pedir material pede o motivo
    // (RN08, abaixo); voltar para "em andamento" desfaz a espera e não pede nada.
    await usuario.click(screen.getByRole('button', { name: 'Em andamento' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/chamados/7/estado', {
        estado: 'em_andamento',
      })
    );
  });

  it('remover um anexo pergunta antes, e diz qual arquivo some', async () => {
    const usuario = userEvent.setup();
    api.get.mockImplementation(async (caminho) => {
      if (caminho === '/chamados/7') return { data: { chamado: chamado() } };
      if (caminho === '/chamados/7/anexos')
        return {
          data: {
            anexos: [
              {
                id: 3,
                nome_arquivo: 'foto-da-infiltracao.jpg',
                tamanho_bytes: 2048,
                usuario_id: GESTOR.id,
                usuario_nome: 'Gestor',
                data_upload: '2025-01-01T12:00:00Z',
              },
            ],
          },
        };
      if (caminho === '/chamados/7/comentarios') return { data: { comentarios: [] } };
      return { data: { usuarios: [], categorias: [], locais: [] } };
    });

    render(
      <MemoryRouter>
        <ChamadoDetalhe />
      </MemoryRouter>
    );
    await screen.findByText('foto-da-infiltracao.jpg');

    await usuario.click(screen.getByRole('button', { name: 'Remover' }));

    // O nome do arquivo na pergunta é o que evita apagar o anexo errado numa
    // lista de vários.
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      /"foto-da-infiltracao\.jpg" será apagado/
    );

    await usuario.click(screen.getAllByRole('button', { name: 'Remover' })[1]);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/chamados/7/anexos/3'));
  });
});

describe('Limite de anexos', () => {
  function abrirComAnexos(quantidade, limite = 3) {
    api.get.mockImplementation(async (caminho) => {
      if (caminho === '/chamados/7') return { data: { chamado: chamado() } };
      if (caminho === '/chamados/7/anexos')
        return {
          data: {
            limite,
            anexos: Array.from({ length: quantidade }, (_, i) => ({
              id: i + 1,
              nome_arquivo: `foto-${i + 1}.jpg`,
              tamanho_bytes: 1024,
              usuario_id: GESTOR.id,
              usuario_nome: 'Gestor',
              data_upload: '2025-01-01T12:00:00Z',
            })),
          },
        };
      if (caminho === '/chamados/7/comentarios') return { data: { comentarios: [] } };
      return { data: { usuarios: [], categorias: [], locais: [] } };
    });
    return render(
      <MemoryRouter>
        <ChamadoDetalhe />
      </MemoryRouter>
    );
  }

  it('mostra quantos anexos o chamado tem e deixa enviar enquanto há vaga', async () => {
    abrirComAnexos(2);
    await screen.findByText('foto-2.jpg');

    expect(screen.getByText('2 de 3')).toBeInTheDocument();
    expect(screen.getByLabelText(/Adicionar anexo/)).toBeEnabled();
  });

  it('no limite, desliga o envio e diz por quê', async () => {
    abrirComAnexos(3);
    await screen.findByText('foto-3.jpg');

    expect(screen.getByText('3 de 3')).toBeInTheDocument();
    const envio = screen.getByLabelText(/já tem 3 anexos, que é o limite/);
    expect(envio).toBeDisabled();
  });
});

describe('Crítico sem atendimento', () => {
  const parado = (extra = {}) =>
    chamado({
      prioridade: 'critica',
      sem_atendimento_critico: true,
      data_abertura: new Date(Date.now() - 23 * 60_000).toISOString(),
      ...extra,
    });

  it('a gestão vê o aviso, com o tempo e o que fazer', async () => {
    montar({ como: GESTOR, dados: parado() });

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Chamado crítico sem atendimento há 23 min.');
    expect(aviso).toHaveTextContent('Faça a triagem ou atribua um técnico.');
  });

  it.each([
    ['quem abriu', SOLICITANTE],
    ['o técnico', TECNICO],
  ])('%s não vê o aviso, que é para quem pode agir', async (_quem, pessoa) => {
    montar({ como: pessoa, dados: parado({ tecnico_id: TECNICO.id }) });
    await screen.findByRole('heading', { name: 'Infiltração no auditório' });

    expect(screen.queryByText(/Chamado crítico sem atendimento/)).not.toBeInTheDocument();
  });

  it('sem o alerta do servidor, nem a gestão vê o aviso', async () => {
    montar({ como: GESTOR, dados: parado({ sem_atendimento_critico: false }) });
    await screen.findByRole('heading', { name: 'Infiltração no auditório' });

    expect(screen.queryByText(/Chamado crítico sem atendimento/)).not.toBeInTheDocument();
  });
});

describe('Campos de escolha com nome acessível', () => {
  // Um <select> sem rótulo é lido como "caixa de combinação" e nada mais: o texto
  // da primeira opção não é o nome do campo. O axe do e2e acusou os dois (WCAG 4.1.2).
  it('o select de técnico da atribuição se chama "Técnico responsável"', async () => {
    montar({
      como: GESTOR,
      dados: chamado({ estado: 'em_triagem' }),
      tecnicos: [{ id: 21, nome: 'Paulo', email: 'paulo@exemplo.com', perfil: 'tecnico' }],
    });

    expect(await screen.findByRole('combobox', { name: 'Técnico responsável' })).toBeInTheDocument();
  });

  it('o select da nota de avaliação se chama "Nota do atendimento"', async () => {
    montar({ como: SOLICITANTE, dados: chamado({ estado: 'concluido', solicitante_id: SOLICITANTE.id }) });

    expect(await screen.findByRole('combobox', { name: 'Nota do atendimento' })).toBeInTheDocument();
  });
});

describe('RN08: a espera por material pede o motivo', () => {
  const emAndamento = () => chamado({ estado: 'em_andamento', tecnico_id: TECNICO.id });

  it('o botão abre o campo e não envia nada ainda', async () => {
    const usuario = userEvent.setup();
    montar({ como: TECNICO, dados: emAndamento() });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    await usuario.click(screen.getByRole('button', { name: 'Aguardando material' }));

    expect(screen.getByLabelText(/Motivo da espera por material/)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('envia o estado com o motivo escrito', async () => {
    const usuario = userEvent.setup();
    montar({ como: TECNICO, dados: emAndamento() });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    await usuario.click(screen.getByRole('button', { name: 'Aguardando material' }));
    await usuario.type(screen.getByLabelText(/Motivo da espera por material/), '  Falta a vedação do registro.  ');
    await usuario.click(screen.getByRole('button', { name: 'Registrar a espera' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/chamados/7/estado', {
        estado: 'aguardando_material',
        observacao: 'Falta a vedação do registro.',
      })
    );
  });

  it('desistir fecha o campo sem enviar', async () => {
    const usuario = userEvent.setup();
    montar({ como: TECNICO, dados: emAndamento() });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    await usuario.click(screen.getByRole('button', { name: 'Aguardando material' }));
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByLabelText(/Motivo da espera por material/)).toBeNull();
    expect(api.patch).not.toHaveBeenCalled();
  });
});

describe('RN06: chamado atribuído só à equipe', () => {
  const daEquipe = (extra) => chamado({ estado: 'atribuido', tecnico_id: null, equipe_id: 3, ...extra });

  it('o técnico da equipe vê o botão para iniciar, e iniciar é o único passo', async () => {
    const usuario = userEvent.setup();
    montar({ como: TECNICO, dados: daEquipe({ pode_assumir: true }) });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    expect(screen.getByRole('heading', { name: 'Mudar estado' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelado' })).toBeNull();
    await usuario.click(screen.getByRole('button', { name: 'Em andamento' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/chamados/7/estado', { estado: 'em_andamento' }));
  });

  it('sem o aval do servidor (pode_assumir), a tela não oferece o botão', async () => {
    montar({ como: TECNICO, dados: daEquipe({ pode_assumir: false }) });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    expect(screen.queryByRole('heading', { name: 'Mudar estado' })).toBeNull();
  });
});

describe('RN05 e RN09: reabertura', () => {
  const concluidoHa = (horas) =>
    chamado({
      estado: 'concluido',
      tecnico_id: TECNICO.id,
      data_conclusao: new Date(Date.now() - horas * 3_600_000).toISOString(),
    });

  it('dentro de 48 horas o solicitante reabre', async () => {
    montar({ como: SOLICITANTE, dados: concluidoHa(2) });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    expect(screen.getByRole('heading', { name: 'Reabrir chamado' })).toBeInTheDocument();
  });

  it('depois de 48 horas o solicitante não vê o formulário', async () => {
    montar({ como: SOLICITANTE, dados: concluidoHa(60) });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    expect(screen.queryByRole('heading', { name: 'Reabrir chamado' })).toBeNull();
  });

  it('depois de 48 horas a gestão ainda reabre, e a tela diz por quê', async () => {
    montar({ como: GESTOR, dados: concluidoHa(60) });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    expect(screen.getByRole('heading', { name: 'Reabrir chamado' })).toBeInTheDocument();
    expect(screen.getByText(/A janela de 48 horas do solicitante já passou/)).toBeInTheDocument();
  });
});


describe('Confirmação do que deu certo', () => {
  it('mudar o estado diz qual é o novo estado, e some quando outra ação começa', async () => {
    const usuario = userEvent.setup();
    montar({ como: TECNICO, dados: chamado({ estado: 'atribuido', tecnico_id: TECNICO.id }) });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    await usuario.click(screen.getByRole('button', { name: 'Em andamento' }));

    const aviso = await screen.findByRole('status');
    expect(aviso).toHaveTextContent('Estado atualizado para “Em andamento”.');
    expect(registrarAcao).toHaveBeenCalledWith('estado_alterado');

    // Uma ação nova apaga o resultado da anterior: não ficam duas histórias na tela.
    api.post.mockRejectedValueOnce({ response: { data: { erro: { mensagem: 'Texto recusado.' } } } });
    await usuario.type(screen.getByPlaceholderText('Escreva um comentário'), 'Chego em dez minutos.');
    await usuario.click(screen.getByRole('button', { name: 'Comentar' }));
    expect(await screen.findByText('Texto recusado.')).toBeInTheDocument();
    expect(screen.queryByText('Estado atualizado para “Em andamento”.')).toBeNull();
  });

  it('comentar confirma o envio', async () => {
    const usuario = userEvent.setup();
    montar({ como: SOLICITANTE });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });
    api.post.mockResolvedValueOnce({ data: { comentario: { id: 9, texto: 'Obrigada!', data: new Date().toISOString(), usuario_id: SOLICITANTE.id, usuario_nome: 'Maria', usuario_perfil: 'solicitante' } } });

    await usuario.type(screen.getByPlaceholderText('Escreva um comentário'), 'Obrigada!');
    await usuario.click(screen.getByRole('button', { name: 'Comentar' }));

    expect(await screen.findByText('Comentário enviado.')).toBeInTheDocument();
    expect(registrarAcao).toHaveBeenCalledWith('comentario_enviado');
  });

  it('o aviso que veio da abertura do chamado aparece uma vez e sai do histórico', async () => {
    usuarioAtual.valor = SOLICITANTE;
    api.get.mockImplementation(async (caminho) => {
      if (caminho === '/chamados/7') return { data: { chamado: chamado() } };
      if (caminho === '/chamados/7/comentarios') return { data: { comentarios: [] } };
      return { data: { anexos: [] } };
    });
    // Mostra o estado de navegação que ficou no histórico: se o aviso continuasse nele,
    // recarregar a página o repetiria.
    function Sonda() {
      return <output data-testid="estado-do-historico">{JSON.stringify(useLocation().state)}</output>;
    }
    render(
      <MemoryRouter initialEntries={[{ pathname: '/chamados/7', state: { aviso: 'Chamado aberto. O protocolo é SMP-1.' } }]}>
        <Sonda />
        <ChamadoDetalhe />
      </MemoryRouter>
    );

    expect(await screen.findByText('Chamado aberto. O protocolo é SMP-1.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('estado-do-historico')).toHaveTextContent('null'));
    // E a tela segue mostrando o que já tinha lido.
    expect(screen.getByText('Chamado aberto. O protocolo é SMP-1.')).toBeInTheDocument();
  });

  it('há um caminho de volta para a lista', async () => {
    montar({ como: GESTOR });
    await screen.findByRole('heading', { level: 1, name: 'Infiltração no auditório' });

    expect(screen.getByRole('link', { name: /Voltar à lista de chamados/ })).toHaveAttribute('href', '/');
  });
});

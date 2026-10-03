import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const usuarioAtual = { valor: { id: 1, nome: 'Ana', perfil: 'administrador' } };
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ usuario: usuarioAtual.valor }),
}));

import api from '../src/api/client';
import Usuarios from '../src/pages/Usuarios';

const PESSOAS = [
  { id: 1, nome: 'Ana', email: 'ana@exemplo.com', perfil: 'administrador', ativo: true },
  { id: 2, nome: 'Bruno', email: 'bruno@exemplo.com', perfil: 'tecnico', ativo: true },
  { id: 3, nome: 'Célia', email: 'celia@exemplo.com', perfil: 'gestor', ativo: true },
];

function montar() {
  api.get.mockResolvedValue({ data: { usuarios: PESSOAS } });
  api.patch.mockResolvedValue({ data: {} });
  return render(
    <MemoryRouter>
      <Usuarios />
    </MemoryRouter>
  );
}

/**
 * O seletor de perfil e a tabela que o desenha duas vezes.
 *
 * `Tabela` renderiza a MESMA coluna em duas formas — linha de tabela para o
 * monitor, bloco para o celular — e esconde uma das duas por CSS. As duas
 * ficam no documento: é assim de propósito, e um teste de ponta a ponta
 * afirma isso.
 *
 * A consequência passa despercebida: qualquer `id` dentro de uma coluna
 * aparece duas vezes. Era o caso aqui, com `<label htmlFor="perfil-2">` e
 * `<select id="perfil-2">`. O `htmlFor` casa sempre com a PRIMEIRA ocorrência
 * — a escondida —, então no celular o seletor visível ficava sem nome
 * acessível nenhum: um leitor de tela anunciava "caixa de seleção" e mais
 * nada, numa tela onde há uma por pessoa.
 */
describe('Seletor de perfil na tabela de usuários', () => {
  it('cada seletor se identifica pela pessoa, nas duas formas da tabela', async () => {
    montar();
    // findAllBy, e não findBy: a Tabela desenha cada linha duas vezes.
    await screen.findAllByText('Bruno');

    // Duas formas na árvore: a de tabela e a de blocos. Ambas precisam ter
    // nome, porque qual delas está visível depende da largura da tela.
    const seletores = screen.getAllByRole('combobox', { name: 'Perfil de Bruno' });
    expect(seletores).toHaveLength(2);
    for (const s of seletores) expect(s).toHaveValue('tecnico');
  });

  it('não deixa id repetido no documento', async () => {
    const { container } = montar();
    // findAllBy, e não findBy: a Tabela desenha cada linha duas vezes.
    await screen.findAllByText('Bruno');

    // Guarda geral: `id` repetido quebra `htmlFor`, `aria-labelledby` e
    // `aria-describedby` em silêncio — todos resolvem para a primeira
    // ocorrência. Numa tabela que desenha tudo duas vezes, é fácil reintroduzir.
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
    const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i);

    expect(repetidos, `ids repetidos: ${[...new Set(repetidos)].join(', ')}`).toEqual([]);
  });

  it('o seletor da própria conta fica travado', async () => {
    montar();
    await screen.findAllByText(/Ana/);

    // Rebaixar a si mesmo é o caminho mais curto para ficar sem administrador.
    // O servidor recusa; a tela não deve nem oferecer.
    for (const s of screen.getAllByRole('combobox', { name: 'Perfil de Ana' })) {
      expect(s).toBeDisabled();
    }
  });
});

/**
 * Anonimização pela tela (LGPD, docs/lgpd.md §5).
 *
 * A rota existia e a tela não sabia dela. Pior: a conta anonimizada aparecia
 * como um "Desligado" qualquer, com o botão "Reativar" — que falhava sempre,
 * porque conta anonimizada não volta.
 */
describe('Anonimização na tela de usuários', () => {
  const ANONIMA = {
    id: 4,
    nome: 'Usuário removido',
    email: 'removido-4@anonimizado.invalid',
    perfil: 'solicitante',
    ativo: false,
    anonimizado_em: '2026-09-23T10:00:00Z',
  };

  function montarCom(pessoas) {
    api.get.mockResolvedValue({ data: { usuarios: pessoas } });
    api.post.mockResolvedValue({ data: {} });
    return render(
      <MemoryRouter>
        <Usuarios />
      </MemoryRouter>
    );
  }

  it('conta anonimizada não oferece "Reativar" nem troca de perfil', async () => {
    montarCom([...PESSOAS, ANONIMA]);
    const linhas = await screen.findAllByText('Anonimizado');
    expect(linhas.length).toBeGreaterThan(0);

    // Duas formas da tabela, nenhuma com o botão que falha sempre.
    expect(screen.queryAllByRole('button', { name: 'Reativar' })).toHaveLength(0);
    for (const s of screen.getAllByRole('combobox', { name: 'Perfil de Usuário removido' })) {
      expect(s).toBeDisabled();
    }
  });

  it('recusa do servidor ao desligar técnico com chamado aparece na tela, com o motivo', async () => {
    const { fireEvent } = await import('@testing-library/react');
    montarCom(PESSOAS);
    api.patch.mockRejectedValueOnce({
      response: {
        data: {
          erro: {
            codigo: 'CHAMADOS_EM_ABERTO',
            mensagem:
              'Esta pessoa tem 2 chamados em aberto. Reatribua antes de desativar, para nenhum ficar parado sem responsável.',
          },
        },
      },
    });
    await screen.findAllByText('Bruno');

    // Bruno é o segundo da lista; os "Desligar" vêm em ordem, um por forma da tabela.
    fireEvent.click(screen.getAllByRole('button', { name: 'Desligar' })[1]);

    // A mensagem do servidor, e não um "não foi possível" genérico: quem lê
    // precisa saber o que fazer — reatribuir —, não só que falhou.
    expect(await screen.findByText(/Reatribua antes de desativar/)).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith('/usuarios/2', { ativo: false });
  });

  it('anonimizar pede confirmação antes e só então chama a API', async () => {
    const { fireEvent } = await import('@testing-library/react');
    montarCom(PESSOAS);
    await screen.findAllByText('Bruno');

    // Um botão por forma da tabela; qualquer um serve.
    const botoes = screen.getAllByRole('button', { name: 'Anonimizar' });
    fireEvent.click(botoes[0]);

    // Nada foi enviado só por clicar: a ação não tem volta.
    expect(api.post).not.toHaveBeenCalled();
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo.textContent).toMatch(/Não dá para desfazer/);

    // O "Anonimizar" de DENTRO do diálogo é o que confirma; os da tabela só
    // abrem a pergunta.
    const { within } = await import('@testing-library/react');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Anonimizar' }));

    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0][0]).toMatch(/^\/usuarios\/\d+\/anonimizar$/);
  });

  it('ninguém recebe o botão de anonimizar a si mesmo', async () => {
    montarCom(PESSOAS);
    await screen.findAllByText('Bruno');
    // Ana (id 1) é quem está logada. São três pessoas e duas formas da
    // tabela: a própria conta fica sem o botão, então sobram quatro.
    expect(screen.getAllByRole('button', { name: 'Anonimizar' })).toHaveLength(4);
  });
});

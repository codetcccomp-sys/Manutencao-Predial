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

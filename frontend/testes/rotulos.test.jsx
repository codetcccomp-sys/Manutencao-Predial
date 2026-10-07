import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { computeAccessibleName } from 'dom-accessibility-api';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn(), patch: vi.fn() },
}));

vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    usuario: { id: 1, nome: 'Gestor', perfil: 'gestor' },
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

import api from '../src/api/client';
import Login from '../src/pages/Login';
import Cadastro from '../src/pages/Cadastro';
import RecuperarSenha from '../src/pages/RecuperarSenha';
import RedefinirSenha from '../src/pages/RedefinirSenha';
import NovoChamado from '../src/pages/NovoChamado';

/**
 * Todo campo precisa de nome acessível.
 *
 * Um `<label>` que não aponta para o campo é decorativo: quem enxerga lê o
 * texto ao lado e não percebe nada, quem usa leitor de tela ouve "caixa de
 * edição" sem saber do quê. A RNF02 pede rótulos coerentes, e esta é a parte
 * da regra que não dá para conferir olhando a tela.
 *
 * O teste foi escrito antes da correção: na primeira execução ele apontou os
 * campos do login, do cadastro e da abertura de chamado.
 */
function camposSemNome(container) {
  const controles = container.querySelectorAll('input, select, textarea');
  const semNome = [];

  for (const controle of controles) {
    if (controle.type === 'hidden' || controle.type === 'submit') continue;
    const nome = computeAccessibleName(controle).trim();
    if (!nome) {
      semNome.push(
        `${controle.tagName.toLowerCase()}${controle.type ? `[type=${controle.type}]` : ''}` +
          `${controle.id ? `#${controle.id}` : ''}`
      );
    }
  }

  return semNome;
}

const TELAS = [
  ['Login', Login, '/login'],
  ['Cadastro', Cadastro, '/cadastro'],
  ['Recuperar senha', RecuperarSenha, '/recuperar-senha'],
  // Sem token na URL a tela mostra uma explicação em vez do formulário — é o
  // comportamento certo, e o teste precisa entrar pelo caminho que tem campos.
  ['Redefinir senha', RedefinirSenha, '/redefinir-senha?token=abc123'],
  ['Novo chamado', NovoChamado, '/chamados/novo'],
];

describe('Rótulos acessíveis (RNF02)', () => {
  for (const [nome, Tela, rota] of TELAS) {
    it(`${nome}: todo campo tem nome acessível`, async () => {
      api.get.mockResolvedValue({
        data: { categorias: [{ id: 1, nome: 'Elétrica' }], locais: [{ id: 1, unidade: 'Bloco A' }] },
      });

      const { container } = render(
        <MemoryRouter initialEntries={[rota]}>
          <Tela />
        </MemoryRouter>
      );

      await waitFor(() => expect(container.querySelector('input, select, textarea')).toBeTruthy());

      const semNome = camposSemNome(container);
      expect(semNome, `campos sem rótulo associado em ${nome}: ${semNome.join(', ')}`).toEqual([]);
    });
  }

  it('o campo de e-mail do login é alcançável pelo rótulo', async () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    // getByLabelText é como um leitor de tela encontra o campo. Se isto falha,
    // o rótulo está apenas desenhado ao lado.
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'password');
  });
});

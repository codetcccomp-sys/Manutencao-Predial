import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

import api from '../src/api/client';
import CatalogoDeMateriais from '../src/components/CatalogoDeMateriais';

/** Catálogo de onde o técnico escolhe o material que lança no chamado (RF07). */
beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.get.mockResolvedValue({ data: { materiais: [{ id: 3, nome: 'Fita isolante', unidade_medida: 'rolo' }] } });
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });
});

describe('Catálogo de materiais', () => {
  it('cadastra nome e unidade, confirma e limpa o formulário', async () => {
    const user = userEvent.setup();
    render(<CatalogoDeMateriais />);

    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Cabo flexível');
    await user.type(screen.getByRole('textbox', { name: /Unidade de medida/ }), 'm');
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    expect(api.post).toHaveBeenCalledWith('/materiais', { nome: 'Cabo flexível', unidade_medida: 'm' });
    expect(await screen.findByText('Material cadastrado.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Nome' })).toHaveValue('');
  });

  it('corrige o nome de um material cadastrado; sem mudança, não há o que salvar', async () => {
    const user = userEvent.setup();
    render(<CatalogoDeMateriais />);

    const salvar = await screen.findByRole('button', { name: 'Salvar Fita isolante' });
    expect(salvar).toBeDisabled();

    const nome = screen.getByRole('textbox', { name: 'Nome de Fita isolante' });
    await user.clear(nome);
    await user.type(nome, 'Fita isolante 19 mm');
    await user.click(salvar);

    expect(api.patch).toHaveBeenCalledWith('/materiais/3', { nome: 'Fita isolante 19 mm' });
  });

  it('a recusa do servidor (nome repetido) aparece na tela', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue({ response: { data: { erro: { mensagem: 'Já existe um material com este nome.' } } } });
    render(<CatalogoDeMateriais />);

    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'fita isolante');
    await user.type(screen.getByRole('textbox', { name: /Unidade de medida/ }), 'rolo');
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe um material com este nome.');
  });
});

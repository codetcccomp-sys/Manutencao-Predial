import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: { notificacoes: [] } }), post: vi.fn() },
}));

const usuarioAtual = { valor: { id: 1, nome: 'Ana', perfil: 'gestor' } };
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ usuario: usuarioAtual.valor, logout: vi.fn() }),
}));

import Marca from '../src/components/ui/Marca';
import Layout from '../src/components/Layout';

const montar = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('Marca', () => {
  it('o nome é texto de verdade, não um pedaço da imagem', () => {
    const { container } = montar(<Marca />);

    // Se o nome fosse parte do PNG, ele não seria encontrado pelo Ctrl+F, não
    // acompanharia o tamanho de fonte do navegador e precisaria de duas
    // versões — uma clara e uma escura.
    expect(screen.getByText('Conserva')).toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('src', '/marca.png');
  });

  it('o símbolo é decorativo: quem lê a tela não ouve o nome duas vezes', () => {
    const { container } = montar(<Marca />);
    const img = container.querySelector('img');

    // Com `alt` preenchido, o leitor de tela anunciaria "Conserva Predial,
    // link, Conserva Predial" — a imagem repete o que o texto ao lado diz.
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('width');
    expect(img).toHaveAttribute('height');
  });

  it('o descritor só aparece quando pedido', () => {
    const { rerender } = montar(<Marca />);
    expect(screen.queryByText('Sistema de manutenção')).toBeNull();

    rerender(
      <MemoryRouter>
        <Marca comDescritor />
      </MemoryRouter>
    );
    expect(screen.getByText('Sistema de manutenção')).toBeInTheDocument();
  });

  it('no cabeçalho, o perfil aparece escrito, com acento, e não como chave', () => {
    usuarioAtual.valor = { id: 2, nome: 'Paulo', perfil: 'tecnico' };
    montar(<Layout />);
    expect(screen.getByText('(Técnico)')).toBeInTheDocument();
    expect(screen.queryByText('(tecnico)')).toBeNull();
    usuarioAtual.valor = { id: 1, nome: 'Ana', perfil: 'gestor' };
  });

  it('no cabeçalho, o link de volta ao início se chama pelo nome do sistema', () => {
    montar(<Layout />);

    // A marca virou o conteúdo do link. Sem texto dentro dele, o link ficaria
    // sem nome acessível nenhum — "link", e só.
    const inicio = screen.getByRole('link', { name: 'Conserva Predial' });
    expect(inicio).toHaveAttribute('href', '/');
  });
});

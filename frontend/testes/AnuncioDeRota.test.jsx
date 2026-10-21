import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router';

import AnuncioDeRota from '../src/components/AnuncioDeRota';
import { NOME_DO_SISTEMA, tituloDaRota } from '../src/dominio/titulosDeRota';

/**
 * Título e foco na troca de tela (WCAG 2.4.2 e 2.4.3).
 *
 * Numa SPA o navegador não faz sozinho o que faz numa página nova: o título da
 * aba ficava igual em todas as telas e, quando o link clicado sumia, o foco caía
 * no `body`. Estes testes seguram as duas pontas: cada rota do `App.jsx` tem o
 * seu título, e a troca de caminho leva o foco ao `h1`.
 */

describe('título de cada rota', () => {
  it('toda rota do App.jsx tem título próprio, e as desconhecidas ficam com o nome do sistema', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
    const rotas = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
    expect(rotas.length).toBeGreaterThan(10);

    for (const rota of rotas) {
      const concreta = rota.replace(':id', '7');
      const titulo = tituloDaRota(concreta);
      expect(titulo, `rota ${rota}`).not.toBe(NOME_DO_SISTEMA);
      expect(titulo.endsWith(` — ${NOME_DO_SISTEMA}`), `rota ${rota}`).toBe(true);
    }
    expect(tituloDaRota('/nao-existe')).toBe(NOME_DO_SISTEMA);
  });

  it('"Novo chamado" não é confundido com um chamado de id "novo"', () => {
    expect(tituloDaRota('/chamados/novo')).toBe(`Novo chamado — ${NOME_DO_SISTEMA}`);
    expect(tituloDaRota('/chamados/12')).toBe(`Chamado — ${NOME_DO_SISTEMA}`);
  });
});

function Tela({ nome, comTitulo = true }) {
  return (
    <main>
      {comTitulo && <h1>{nome}</h1>}
      <Link to="/outra">Ir para outra</Link>
      <Link to="/outra?aba=2">Mesma tela, outra aba</Link>
      <input aria-label="Campo da tela" />
    </main>
  );
}

const abrir = (inicial = '/primeira') =>
  render(
    <MemoryRouter initialEntries={[inicial]}>
      <AnuncioDeRota />
      <Routes>
        <Route path="/primeira" element={<Tela nome="Primeira" />} />
        <Route path="/outra" element={<Tela nome="Outra" />} />
        <Route path="/sem-titulo" element={<Tela nome="Sem título" comTitulo={false} />} />
      </Routes>
    </MemoryRouter>
  );

describe('título da aba ao trocar de tela', () => {
  it('acompanha a rota na carga e depois de navegar', async () => {
    const usuario = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/relatorios']}>
        <AnuncioDeRota />
        <Routes>
          <Route path="*" element={<Link to="/conta">Minha conta</Link>} />
        </Routes>
      </MemoryRouter>
    );
    expect(document.title).toBe(`Relatórios — ${NOME_DO_SISTEMA}`);

    await usuario.click(screen.getByRole('link', { name: 'Minha conta' }));

    expect(document.title).toBe(`Minha conta — ${NOME_DO_SISTEMA}`);
  });
});

describe('foco ao trocar de tela', () => {
  it('na primeira carga, atualiza o título mas não mexe no foco', () => {
    abrir('/primeira');
    // Rota sem título próprio no mapa: o ponto é que o efeito rodou e o foco ficou onde estava.
    expect(document.title).toBe(NOME_DO_SISTEMA);
    expect(document.activeElement).toBe(document.body);
  });

  it('ao trocar de caminho, leva o foco ao h1 da tela nova', async () => {
    const usuario = userEvent.setup();
    abrir('/primeira');

    await usuario.click(screen.getByRole('link', { name: 'Ir para outra' }));

    const titulo = screen.getByRole('heading', { level: 1, name: 'Outra' });
    expect(document.activeElement).toBe(titulo);
    // Focável só por código: não entra na ordem do Tab, e não ganha anel.
    expect(titulo).toHaveAttribute('tabindex', '-1');
    expect(titulo.className).toContain('outline-none');
  });

  it('trocar só a query (?aba=) na mesma tela não tira o foco de onde a pessoa estava', async () => {
    const usuario = userEvent.setup();
    abrir('/outra');
    screen.getByLabelText('Campo da tela').focus();

    await usuario.click(screen.getByRole('link', { name: 'Mesma tela, outra aba' }));

    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('tela sem h1 (ainda carregando) leva o foco ao main', async () => {
    const usuario = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/primeira']}>
        <AnuncioDeRota />
        <Routes>
          <Route path="/primeira" element={<Tela nome="Primeira" />} />
          <Route path="/outra" element={<Tela nome="Outra" comTitulo={false} />} />
        </Routes>
      </MemoryRouter>
    );

    await usuario.click(screen.getByRole('link', { name: 'Ir para outra' }));

    expect(document.activeElement?.tagName).toBe('MAIN');
  });
});

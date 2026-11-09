import fs from 'fs';
import path from 'path';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../src/monitoramento', () => ({ registrarTela: vi.fn() }));

import AnuncioDeRota from '../src/components/AnuncioDeRota';
import { registrarTela } from '../src/monitoramento';
import { NOME_DO_SISTEMA, descricaoDaRota, tituloDaRota } from '../src/dominio/titulosDeRota';

/**
 * Título e foco na troca de tela (WCAG 2.4.2 e 2.4.3).
 *
 * Numa SPA o navegador não faz sozinho o que faz numa página nova: o título da
 * aba ficava igual em todas as telas e, quando o link clicado sumia, o foco caía
 * no `body`. Estes testes seguram as duas pontas: cada rota do `App.jsx` tem o
 * seu título, e a troca de caminho leva o foco ao `h1`.
 */

describe('título de cada rota', () => {
  it('toda rota do App.jsx tem título próprio, e o endereço que não existe vira "Página não encontrada"', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
    const rotas = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
    expect(rotas.length).toBeGreaterThan(10);

    const naoEncontrada = `Página não encontrada — ${NOME_DO_SISTEMA}`;
    for (const rota of rotas) {
      const concreta = rota.replace(':id', '7');
      const titulo = tituloDaRota(concreta);
      expect(titulo, `rota ${rota}`).not.toBe(NOME_DO_SISTEMA);
      expect(titulo.endsWith(` — ${NOME_DO_SISTEMA}`), `rota ${rota}`).toBe(true);
      // Desde que existe a página 404, rota fora do mapa ganha o título dela, que
      // passa nas duas conferências acima: uma tela nova sem título apareceria na
      // aba como "Página não encontrada" e este teste continuaria verde.
      if (rota !== '*') expect(titulo, `rota ${rota} sem título no mapa`).not.toBe(naoEncontrada);
    }
    expect(tituloDaRota('/nao-existe')).toBe(naoEncontrada);
  });

  it('toda rota do App.jsx tem descrição própria, e as telas internas só dizem que são restritas', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
    const rotas = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((r) => r !== '*');

    const daNaoEncontrada = descricaoDaRota('/nao-existe');
    for (const rota of rotas) {
      const descricao = descricaoDaRota(rota.replace(':id', '7'));
      // Rota fora do mapa herdaria a descrição da página 404.
      expect([rota, descricao === daNaoEncontrada]).toEqual([rota, false]);
      expect(descricao.length, `rota ${rota}`).toBeGreaterThan(30);
      // Cabe na linha de resultado de um buscador e de uma prévia de link.
      expect(descricao.length, `rota ${rota}`).toBeLessThanOrEqual(160);
    }
    for (const interna of ['/', '/chamados/novo', '/chamados/12', '/relatorios', '/usuarios', '/cadastros', '/conta']) {
      expect(descricaoDaRota(interna), interna).toMatch(/restrita/i);
    }
    expect(descricaoDaRota('/termos')).not.toMatch(/restrita/i);
    expect(descricaoDaRota('/nao-existe')).toMatch(/não existe/);
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

describe('descrição da página', () => {
  it('troca o texto da meta description com a rota', async () => {
    const usuario = userEvent.setup();
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    meta.setAttribute('content', 'texto do index.html');
    document.head.appendChild(meta);
    try {
      render(
        <MemoryRouter initialEntries={['/login']}>
          <AnuncioDeRota />
          <Routes>
            <Route path="*" element={<Link to="/privacidade">Privacidade</Link>} />
          </Routes>
        </MemoryRouter>
      );
      expect(meta.getAttribute('content')).toBe(descricaoDaRota('/login'));

      await usuario.click(screen.getByRole('link', { name: 'Privacidade' }));

      expect(meta.getAttribute('content')).toBe(descricaoDaRota('/privacidade'));
      expect(meta.getAttribute('content')).not.toBe(descricaoDaRota('/login'));
    } finally {
      meta.remove();
    }
  });
});

describe('foco ao trocar de tela', () => {
  it('na primeira carga, atualiza o título mas não mexe no foco', () => {
    abrir('/primeira');
    // Rota fora do mapa: o ponto é que o efeito rodou e o foco ficou onde estava.
    expect(document.title).toBe(`Página não encontrada — ${NOME_DO_SISTEMA}`);
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

  it('se o h1 chega depois (tela sob demanda), o foco passa a ele', async () => {
    const usuario = userEvent.setup();
    function Atrasada() {
      const [pronta, setPronta] = useState(false);
      useEffect(() => {
        const id = setTimeout(() => setPronta(true), 20);
        return () => clearTimeout(id);
      }, []);
      return <main>{pronta && <h1>Chegou</h1>}</main>;
    }
    render(
      <MemoryRouter initialEntries={['/primeira']}>
        <AnuncioDeRota />
        <Routes>
          <Route path="/primeira" element={<Tela nome="Primeira" />} />
          <Route path="/outra" element={<Atrasada />} />
        </Routes>
      </MemoryRouter>
    );

    await usuario.click(screen.getByRole('link', { name: 'Ir para outra' }));
    expect(document.activeElement?.tagName).toBe('MAIN');

    expect(await screen.findByRole('heading', { level: 1, name: 'Chegou' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })));
  });

  it('se a pessoa já mexeu o foco quando o h1 chega, o foco não é roubado', async () => {
    const usuario = userEvent.setup();
    function Atrasada() {
      const [pronta, setPronta] = useState(false);
      useEffect(() => {
        const id = setTimeout(() => setPronta(true), 60);
        return () => clearTimeout(id);
      }, []);
      return (
        <main>
          <input aria-label="Campo" />
          {pronta && <h1>Chegou</h1>}
        </main>
      );
    }
    render(
      <MemoryRouter initialEntries={['/primeira']}>
        <AnuncioDeRota />
        <Routes>
          <Route path="/primeira" element={<Tela nome="Primeira" />} />
          <Route path="/outra" element={<Atrasada />} />
        </Routes>
      </MemoryRouter>
    );

    await usuario.click(screen.getByRole('link', { name: 'Ir para outra' }));
    await act(async () => screen.getByLabelText('Campo').focus());

    expect(await screen.findByRole('heading', { level: 1, name: 'Chegou' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText('Campo'));
  });
});

describe('contagem de uso da tela', () => {
  it('registra a abertura pelo MODELO da rota, nunca pelo caminho com o identificador', async () => {
    const usuario = userEvent.setup();
    registrarTela.mockClear();
    render(
      <MemoryRouter initialEntries={['/chamados/4821']}>
        <AnuncioDeRota />
        <Routes>
          <Route path="*" element={<Link to="/equipamentos/17">Equipamento</Link>} />
        </Routes>
      </MemoryRouter>
    );
    await usuario.click(screen.getByRole('link', { name: 'Equipamento' }));

    expect(registrarTela.mock.calls.map(([tela]) => tela)).toEqual(['/chamados/:id', '/equipamentos/:id']);
  });

  it('um endereço que não existe vira "outra", sem repetir o que foi digitado', () => {
    registrarTela.mockClear();
    render(
      <MemoryRouter initialEntries={['/segredo/maria@exemplo.com']}>
        <AnuncioDeRota />
      </MemoryRouter>
    );

    expect(registrarTela).toHaveBeenCalledWith('outra');
    expect(JSON.stringify(registrarTela.mock.calls)).not.toContain('maria');
  });
});

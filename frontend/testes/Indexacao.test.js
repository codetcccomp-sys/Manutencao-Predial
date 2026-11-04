import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import producao from '../vercel.json';
import demonstracao from '../../demo/frontend/vercel.json';

/**
 * O que os buscadores veem: `noindex` em toda parte e um robots.txt que os afasta das telas internas.
 *
 * Isto orienta robôs que respeitam o padrão e NÃO é controle de acesso: quem
 * controla é o login (as telas internas não mostram dado sem sessão, e a API
 * recusa sem ela). Os testes seguram três coisas que se perdem sem ninguém notar:
 *
 * - o `noindex` valer no HTML e no cabeçalho, nos dois sites (produção e demonstração);
 * - o robots.txt cobrir TODA rota atrás do login, inclusive as que forem criadas depois;
 * - as telas públicas ficarem rastreáveis, porque um robô barrado pelo robots.txt nunca
 *   chega a ler o `noindex` da página e ela pode entrar no índice só pelo endereço.
 */

const raiz = path.join(__dirname, '..');
const ler = (relativo) => fs.readFileSync(path.join(raiz, relativo), 'utf8');

const app = ler('src/App.jsx');
const robots = ler('public/robots.txt');

// As rotas do App.jsx, separadas pelo que está dentro e fora da rota protegida.
const [fora, dentro] = (() => {
  const inicio = app.indexOf('<RotaProtegida>');
  const fim = app.indexOf('</RotaProtegida>');
  const grupoAte = app.indexOf('</Route>', fim);
  const rotas = (trecho) => [...trecho.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
  return [
    rotas(app.slice(0, inicio)).concat(rotas(app.slice(grupoAte))).filter((r) => r !== '*'),
    rotas(app.slice(inicio, grupoAte)),
  ];
})();

const regrasDisallow = robots
  .split('\n')
  .filter((linha) => /^Disallow:/i.test(linha))
  .map((linha) => linha.replace(/^Disallow:\s*/i, '').trim());

const barrada = (caminho) => regrasDisallow.some((regra) => regra && caminho.startsWith(regra));

describe('noindex', () => {
  it('o index.html pede para não indexar e traz a descrição', () => {
    const html = ler('index.html');

    expect(html).toMatch(/<meta\s+name="robots"\s+content="noindex, nofollow"\s*\/>/);
    expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]{30,160}"/s);
  });

  it('o cabeçalho X-Robots-Tag vale em todas as rotas, na produção e na demonstração', () => {
    for (const config of [producao, demonstracao]) {
      const regra = config.headers.find((h) => h.source === '/(.*)');
      expect(regra.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
    }
  });
});

describe('robots.txt', () => {
  it('há rotas internas e públicas para conferir (a régua do teste)', () => {
    expect(dentro.length).toBeGreaterThan(6);
    expect(fora).toEqual(expect.arrayContaining(['/login', '/cadastro', '/privacidade', '/termos', '/cookies', '/suporte']));
  });

  it('afasta os robôs de toda rota atrás do login, e da API', () => {
    for (const rota of dentro) {
      if (rota === '/') continue; // o início é o único endereço sem prefixo próprio: cai no login
      expect(barrada(rota.replace(':id', '7')), `rota interna ${rota}`).toBe(true);
    }
    expect(barrada('/api/chamados')).toBe(true);
  });

  it('deixa rastreáveis as telas públicas, para o robô ler o noindex delas', () => {
    for (const rota of fora) {
      expect(barrada(rota), `rota pública ${rota}`).toBe(false);
    }
    // Barrar tudo esconderia o noindex das telas públicas.
    expect(regrasDisallow).not.toContain('/');
  });

  it('diz que orienta robôs e não substitui a autenticação', () => {
    expect(robots).toMatch(/não protege nada/);
    expect(robots).toMatch(/login/);
    expect(robots).toMatch(/User-agent: \*/);
  });
});

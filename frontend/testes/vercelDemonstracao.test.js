import { describe, expect, it } from 'vitest';
import producao from '../vercel.json';
import demonstracao from '../../demo/frontend/vercel.json';

/**
 * O site da demonstração publicada (demo/frontend/vercel.json).
 *
 * É um segundo projeto da Vercel que serve a MESMA build do frontend, mas com
 * o `/api` reescrito para a API da demonstração. Duas coisas não podem se
 * separar sem ninguém notar:
 *
 * - o destino: um `/api` apontando para a produção faria quem experimenta a
 *   demonstração gravar chamado e conta de teste no banco real. E um apontando
 *   para um endereço que não é nosso mandaria a senha de quem entra a um
 *   terceiro; por isso o endereço aqui é o exato, conferido na Vercel;
 * - a política de segurança: a CSP e os cabeçalhos são copiados da produção, e
 *   uma cópia que diverge em silêncio é uma demonstração mais frouxa que o
 *   sistema que ela mostra.
 */

const API_DA_DEMONSTRACAO = 'https://conserva-predial-demo-api.vercel.app';
const reescritaDaApi = (config) => config.rewrites.find((r) => r.source === '/api/:path*');

describe('demo/frontend/vercel.json', () => {
  it('manda /api para a API da demonstração, e só para ela', () => {
    expect(reescritaDaApi(demonstracao).destination).toBe(`${API_DA_DEMONSTRACAO}/:path*`);
  });

  it('em lugar nenhum cita a produção', () => {
    const texto = JSON.stringify(demonstracao);
    expect(texto).not.toMatch(/manutencao-predial/);
    expect(texto).not.toMatch(/\/\/conserva-predial\.vercel\.app/);
    expect(reescritaDaApi(producao).destination).toMatch(/manutencao-predial-backend/); // a régua do teste
  });

  it('os cabeçalhos de segurança são idênticos aos da produção', () => {
    expect(demonstracao.headers).toEqual(producao.headers);
  });

  it('as rotas do aplicativo caem no index.html, como na produção', () => {
    expect(demonstracao.rewrites.at(-1)).toEqual(producao.rewrites.at(-1));
    expect(demonstracao.rewrites).toHaveLength(producao.rewrites.length);
  });
});

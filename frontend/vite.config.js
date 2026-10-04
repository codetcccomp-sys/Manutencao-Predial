import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Os cabeçalhos de segurança têm uma fonte só: o vercel.json, que é o que a
// produção aplica. O `preview` (e, por ele, o e2e) serve os mesmos, para a
// política ser testada exatamente como vai ao ar — uma CSP escrita em dois
// lugares divergiria em silêncio, e a que fosse testada não seria a da produção.
// O `dev` fica sem eles de propósito: o HMR do Vite injeta script inline.
const cabecalhosDeSeguranca = Object.fromEntries(
  JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'))
    .headers.flatMap((regra) => regra.headers)
    .map(({ key, value }) => [key, value])
);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3333',
        changeOrigin: true,
        rewrite: (caminho) => caminho.replace(/^\/api/, ''),
      },
    },
  },
  // O preview serve a build para os testes de ponta a ponta. Ele precisa do
  // mesmo proxy do dev: sem isso as telas chamariam /api num servidor que não
  // existe, e a suíte falharia por configuração, não por código.
  preview: {
    port: 4173,
    headers: cabecalhosDeSeguranca,
    proxy: {
      '/api': {
        target: 'http://localhost:3333',
        changeOrigin: true,
        rewrite: (caminho) => caminho.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './testes/preparo.js',
    // Os testes de ponta a ponta são do Playwright e precisam de servidor e
    // banco; o Vitest cuida só do que roda sem nada em pé.
    include: ['testes/**/*.test.jsx', 'testes/**/*.test.js'],
    css: false,
  },
});

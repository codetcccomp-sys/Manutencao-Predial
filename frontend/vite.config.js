import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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

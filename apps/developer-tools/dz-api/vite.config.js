import { defineConfig } from 'vite';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  plugins: [puterLocalhost('api-client')],
  base: './',
  build: {
    target: 'es2022',
    cssTarget: 'safari15',
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5297,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
  },
});

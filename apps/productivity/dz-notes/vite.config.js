import { defineConfig } from 'vite';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  plugins: [puterLocalhost('notes')],
  base: './',
  build: {
    target: 'es2022',
    cssTarget: 'safari15',
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5231,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
  },
});

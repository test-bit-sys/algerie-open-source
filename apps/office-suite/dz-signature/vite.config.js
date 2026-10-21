import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  plugins: [puterLocalhost('signatures')],
  base: './',
  build: {
    target: 'es2022',
    cssTarget: 'safari15',
    rollupOptions: {
      input: {
        // The app itself, and the standalone page external signers land on.
        main: resolve(import.meta.dirname, 'index.html'),
        sign: resolve(import.meta.dirname, 'sign.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/main.js', 'src/sign-main.js', 'src/views/**', 'src/ui/shell.js'],
    },
  },
});

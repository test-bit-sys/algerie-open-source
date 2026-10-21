import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { publicContentPlugin } from './site/plugin.js';
import { SITE_URL } from './site/content.js';
import { escapeHTML } from './site/render.js';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  appType: 'mpa',
  plugins: [puterLocalhost('inventory'), {
    name: 'static-public-landing',
    transformIndexHtml(html) {
      return html.replace('<!-- public-metadata -->', () => SITE_URL
        ? `<link rel="canonical" href="${escapeHTML(SITE_URL)}/" /><meta property="og:url" content="${escapeHTML(SITE_URL)}/" /><meta property="og:image" content="${escapeHTML(SITE_URL)}/icon-512.png" /><meta name="twitter:image" content="${escapeHTML(SITE_URL)}/icon-512.png" />`
        : '').replace('<!-- public-landing -->', () =>
        `<div id="landing-top" class="landing">${readFileSync(new URL('./src/views/landing.html', import.meta.url), 'utf8')}</div>`);
    },
  }, publicContentPlugin()],
  base: './',
  build: {
    target: 'es2022',
    cssTarget: 'safari15',
  },
  server: {
    port: 5174,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});

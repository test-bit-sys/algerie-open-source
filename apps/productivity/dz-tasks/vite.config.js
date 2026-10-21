import { defineConfig } from 'vite';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';
import puterLocalhost from '../../dev/puter-localhost.mjs';

/**
 * Writes sw.js from sw.template.js with a precache list of everything the
 * build produced. The version derives from the emitted content, so a new
 * deploy installs a new worker and drops the old cache; an identical
 * rebuild keeps users' caches warm.
 *
 * Runs at closeBundle — after Vite has written index.html and copied
 * public/ — and hashes the finished output directory. Hashing the Rollup
 * bundle alone would miss both, and an HTML- or icon-only deploy would
 * ship a byte-identical sw.js: no update, users pinned to the cached
 * shell forever.
 */
function serviceWorker() {
  let outDir = '';
  return {
    name: 'tasks-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => path.relative(outDir, path.join(e.parentPath ?? e.path, e.name)).split(path.sep).join('/'))
        .filter((rel) => rel !== 'sw.js' && !rel.split('/').some((p) => p.startsWith('.')))
        .sort();
      // Every byte of every file, plus its path: a deploy that edits one
      // byte in place (index.html, an icon) must still version the worker —
      // sampling would let a same-length edit ship a byte-identical sw.js
      // and pin users to the stale cached shell.
      const hash = createHash('sha256');
      for (const rel of files) {
        hash.update(rel);
        hash.update(readFileSync(path.join(outDir, rel)));
      }
      const version = hash.digest('hex').slice(0, 12);
      // './' serves index.html to every (hash-routed) navigation; listing
      // index.html again would just precache the same bytes twice.
      const assets = ['./', ...files.filter((f) => f !== 'index.html').map((f) => `./${f}`)];
      const template = readFileSync(fileURLToPath(new URL('./sw.template.js', import.meta.url)), 'utf8');
      writeFileSync(path.join(outDir, 'sw.js'), template
        .replaceAll('__VERSION__', version)
        .replaceAll('__ASSETS__', JSON.stringify(assets)));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [puterLocalhost('tasks'), serviceWorker()],
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

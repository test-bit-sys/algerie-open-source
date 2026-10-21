import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';

// The build id is a hash of the bundled worker, so any change to code the
// worker imports updates every owner's deployed worker automatically. The
// build time is filled in after hashing so it never changes the hash.
// Same scheme as the Whiteboard app's worker build.
const PLACEHOLDER = '__WIKI_WORKER_BUILD__';
const TIME_PLACEHOLDER = '__WIKI_WORKER_BUILT_AT__';
const builtAt = Date.now();

export default defineConfig({
  publicDir: false,
  plugins: [
    {
      name: 'wiki-worker-metadata',
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== 'chunk' || !output.isEntry) continue;
          const build = createHash('sha256').update(output.code).digest('hex').slice(0, 16);
          const code = output.code.replaceAll(PLACEHOLDER, build).replace(new RegExp(`["'\`]${TIME_PLACEHOLDER}["'\`]`, 'g'), String(builtAt));
          if (code.includes(TIME_PLACEHOLDER)) this.error('The worker build time could not be filled in.');
          output.code = `/* wiki-worker build=${build} at=${builtAt} */\n${code}`;
        }
      },
    },
  ],
  define: {
    __WORKER_BUILD__: JSON.stringify(PLACEHOLDER),
    __WORKER_BUILT_AT__: JSON.stringify(TIME_PLACEHOLDER),
  },
  build: {
    target: 'es2022',
    outDir: 'public/worker',
    emptyOutDir: true,
    lib: {
      entry: 'worker/index.js',
      name: 'WikiWorker',
      formats: ['iife'],
      fileName: () => 'wiki-worker.js',
    },
  },
});

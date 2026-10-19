/**
 * DZ-Dama (داما) — Standalone Local Server
 * Zero-dependency, offline-first, hardened shared static server.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from '../../../tools/static-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3013;

startStaticServer({
  name: 'DZ-Dama — Algerian Trilingual Checkers (Port 3013)',
  port: PORT,
  allowedRoots: [__dirname],
  mapUrl(pathname) {
    if (pathname === '/' || pathname === '') {
      return path.join(__dirname, 'index.html');
    }
    return path.join(__dirname, pathname);
  }
});

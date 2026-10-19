/**
 * DZ-Chess (شطرنج) — Standalone Local Server
 * Zero-dependency, offline-first, hardened shared static server.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from '../../../tools/static-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3012;

startStaticServer({
  name: 'DZ-Chess — Algerian Trilingual Chess Suite (Port 3012)',
  port: PORT,
  allowedRoots: [__dirname],
  mapUrl(pathname) {
    if (pathname === '/' || pathname === '') {
      return path.join(__dirname, 'index.html');
    }
    return path.join(__dirname, pathname);
  }
});

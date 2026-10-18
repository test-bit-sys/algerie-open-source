/**
 * DZ-DevTools Pro — Standalone Local Server
 * Zero-dependency, offline-first native server following HeyPuter/everything architecture.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from '../../../tools/static-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3009;

startStaticServer({
  name: 'DZ-DevTools Pro (Algerian Developer Suite & Wilayas Studio)',
  port: PORT,
  allowedRoots: [__dirname],
  mapUrl(pathname) {
    if (pathname === '/' || pathname === '') {
      return path.join(__dirname, 'index.html');
    }
    return path.join(__dirname, pathname);
  }
});

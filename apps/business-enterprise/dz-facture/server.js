/**
 * DZ-Facture & POS — Standalone Local Server
 * Serves this single application from its own directory.
 * All low-level serving logic lives in `<root>/tools/static-server.js`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from '../../../tools/static-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

startStaticServer({
  name: 'DZ-Facture & POS (Algerian Invoicing & POS Suite)',
  port: process.env.PORT || 3000,
  allowedRoots: [__dirname],
  mapUrl(pathname) {
    if (pathname === '/' || pathname === '') {
      return path.join(__dirname, 'index.html');
    }
    if (pathname === '/favicon.ico') {
      return path.join(__dirname, 'assets', 'logo.svg');
    }
    return path.join(__dirname, pathname);
  }
});

/**
 * DZ-PDF (Adobe Acrobat Alternative) — Standalone Local Server
 * Zero-dependency, offline-first native server following HeyPuter/everything architecture.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from '../../../tools/static-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3004;

startStaticServer({
  name: 'DZ-PDF Suite (Open Source Adobe Acrobat Alternative)',
  port: PORT,
  allowedRoots: [__dirname],
  mapUrl(pathname) {
    if (pathname === '/' || pathname === '') {
      return path.join(__dirname, 'index.html');
    }
    return path.join(__dirname, pathname);
  }
});

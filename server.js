/**
 * DZ Open Suite — Root Workspace Server
 * Serves the flagship application (DZ-Facture & POS) at `/`
 * and the shared workspace assets at `/assets/`.
 * All low-level serving logic lives in `tools/static-server.js`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './tools/static-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default flagship application served at root
const APP_DIR = path.join(__dirname, 'apps', 'business-enterprise', 'dz-facture');
// Shared workspace assets (banner, logos) exposed at /assets/*
const ROOT_ASSETS = path.join(__dirname, 'assets');

startStaticServer({
  name: 'DZ Open Source Suite — Flagship Application Server',
  port: process.env.PORT || 3000,
  allowedRoots: [APP_DIR, ROOT_ASSETS],
  mapUrl(pathname) {
    if (pathname === '/' || pathname === '') {
      return path.join(APP_DIR, 'index.html');
    }
    // Route favicon.ico to the shared SVG logo
    if (pathname === '/favicon.ico') {
      return path.join(ROOT_ASSETS, 'logo.svg');
    }
    // Workspace-level assets (banner, shared logos, …)
    if (pathname.startsWith('/assets/')) {
      return path.join(ROOT_ASSETS, pathname);
    }
    // Everything else is served from the flagship app directory
    return path.join(APP_DIR, pathname);
  }
});

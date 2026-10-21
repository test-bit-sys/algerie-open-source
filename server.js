/**
 * DZ Open Suite — Root Workspace Server
 * Serves the flagship application (DZ-Facture & POS) at `/`
 * and the shared workspace assets at `/assets/`.
 * All low-level serving logic lives in `tools/static-server.js`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './tools/static-server.js';

import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default flagship application served at root
const APP_DIR = path.join(__dirname, 'apps', 'business-enterprise', 'dz-facture');
// All applications under apps/
const APPS_DIR = path.join(__dirname, 'apps');
// Shared workspace assets (banner, logos) exposed at /assets/*
const ROOT_ASSETS = path.join(__dirname, 'assets');
// Sovereign shared packages runtime
const PACKAGES_DIR = path.join(__dirname, 'packages');

startStaticServer({
  name: 'DZ Open Source Suite — Flagship & Ecosystem Server',
  port: process.env.PORT || 3000,
  allowedRoots: [__dirname, APP_DIR, ROOT_ASSETS, APPS_DIR, PACKAGES_DIR],
  mapUrl(pathname) {
    if (pathname === '/' || pathname === '' || pathname === '/index.html') {
      return path.join(__dirname, 'index.html');
    }
    // Route favicon.ico to the shared suite logo
    if (pathname === '/favicon.ico') {
      return path.join(ROOT_ASSETS, 'logo.jpg');
    }
    // Workspace-level assets (banner, shared logos, …)
    if (pathname.startsWith('/assets/')) {
      return path.join(ROOT_ASSETS, pathname.slice('/assets/'.length));
    }
    // Route shared sovereign packages runtime (dz-runtime, etc.)
    if (pathname.startsWith('/packages/')) {
      return path.join(PACKAGES_DIR, pathname.slice('/packages/'.length));
    }
    // Route to any application in apps/ (e.g. /apps/productivity/dz-disk-tree/)
    if (pathname.startsWith('/apps/')) {
      const rel = pathname.slice('/apps/'.length);
      const target = path.join(APPS_DIR, rel);
      try {
        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
          if (!pathname.endsWith('/')) {
            return { redirect: pathname + '/' };
          }
          return path.join(target, 'index.html');
        }
      } catch {}
      return target;
    }
    // Everything else is served from the flagship app directory
    return path.join(APP_DIR, pathname);
  }
});

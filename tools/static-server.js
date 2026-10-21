/**
 * DZ Open Suite — Shared Zero-Dependency Static File Server
 * ---------------------------------------------------------
 * A hardened local development server used by the root workspace and every
 * application in `apps/`. It enforces:
 *
 *   1. Strict path containment (blocks `../` path-traversal attacks).
 *   2. GET/HEAD-only handling (405 for everything else).
 *   3. Safe URL decoding (rejects malformed percent-encoding with 400).
 *   4. Hardened response headers (`X-Content-Type-Options`, `Cache-Control`).
 *   5. Stream error handling so broken transfers never crash the process.
 *
 * Usage:
 *   import { startStaticServer } from '<root>/tools/static-server.js';
 *   startStaticServer({ name, port, allowedRoots, mapUrl });
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGES_ROOT = path.resolve(__dirname, '../packages');

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm'
};

/**
 * Returns true only when `childPath` resolves strictly INSIDE `rootPath`.
 * Uses path.relative() — immune to prefix tricks like `root-evil` siblings
 * that defeat naive `startsWith()` checks.
 */
export function isPathWithin(childPath, rootPath) {
  const child = path.resolve(childPath);
  const root = path.resolve(rootPath);
  const rel = path.relative(root, child);
  return rel !== '' && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel);
}

function sendText(res, status, message, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...extraHeaders });
  res.end(message);
}

/**
 * Creates the http.Server. Options:
 *   - mapUrl(pathname) → absolute file path to serve (may point to a missing file → 404)
 *   - allowedRoots:    array of absolute directory paths; every served file MUST
 *                      resolve inside one of them, otherwise the request is rejected with 403.
 */
export function createStaticServer({ mapUrl, allowedRoots = [] }) {
  const roots = [...allowedRoots.map((r) => path.resolve(r)), PACKAGES_ROOT];

  return http.createServer((req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, '405 Method Not Allowed', { Allow: 'GET, HEAD' });
        return;
      }

      let pathname;
      try {
        pathname = decodeURIComponent(req.url.split('?')[0]);
      } catch {
        sendText(res, 400, '400 Bad Request (malformed URL encoding)');
        return;
      }

      let filePath = null;
      if (pathname.startsWith('/packages/')) {
        filePath = path.join(PACKAGES_ROOT, pathname.slice('/packages/'.length));
      } else {
        try {
          filePath = mapUrl(pathname);
        } catch {
          filePath = null;
        }
      }

      if (filePath && typeof filePath === 'object' && filePath.redirect) {
        res.writeHead(301, { Location: filePath.redirect });
        res.end();
        return;
      }

      if (typeof filePath !== 'string' || !roots.some((root) => isPathWithin(filePath, root))) {
        sendText(res, 403, '403 Forbidden');
        return;
      }

      fs.stat(filePath, (statErr, stats) => {
        if (statErr || !stats.isFile()) {
          sendText(res, 404, `404 Not Found — DZ Open Suite (${pathname})`);
          return;
        }

        const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stats.size,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        });

        if (req.method === 'HEAD') {
          res.end();
          return;
        }

        const stream = fs.createReadStream(filePath);
        stream.on('error', () => {
          if (!res.headersSent) sendText(res, 500, '500 Internal Server Error');
          else res.destroy();
        });
        stream.pipe(res);
      });
    } catch {
      if (!res.headersSent) sendText(res, 500, '500 Internal Server Error');
      else res.destroy();
    }
  });
}

/**
 * Creates the server, prints a friendly banner, and handles port conflicts.
 * Returns the underlying http.Server (e.g. for graceful shutdown in tests).
 */
export function startStaticServer({ name = 'DZ Open Suite', port, mapUrl, allowedRoots }) {
  const portNumber = Number(port ?? process.env.PORT) || 3000;
  const server = createStaticServer({ mapUrl, allowedRoots });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`\n[ERROR] Port ${portNumber} is already in use.`);
      console.error(`        Stop the other server first, or run with a different port:`);
      console.error(`        PORT=${portNumber + 1} npm start\n`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  });

  server.listen(portNumber, () => {
    console.log(`\n======================================================`);
    console.log(`DZ Open Suite - ${name}`);
    console.log(`[INFO] Server running at: http://localhost:${portNumber}`);
    console.log(`[SYS] Offline-first | Trilingual (AR/FR/EN) | Zero dependencies`);
    console.log(`======================================================\n`);
  });

  return server;
}

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

// Default flagship application served at root
const APP_DIR = path.join(__dirname, 'apps', 'business-enterprise', 'dz-facture');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURI(req.url.split('?')[0]);
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  // Route favicon.ico to custom 4K SVG logo
  if (reqPath === '/favicon.ico') {
    reqPath = '/assets/logo.svg';
  }

  // Check if requesting an app asset or root asset (like /assets/...)
  let filePath;
  if (reqPath.startsWith('/assets/')) {
    filePath = path.join(__dirname, reqPath);
  } else {
    filePath = path.join(APP_DIR, reqPath);
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found - DZ Open Suite');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\nDZ Open Source Suite - Flagship Application Server`);
  console.log(`[INFO] Serving DZ-Facture & POS at: http://localhost:${PORT}`);
  console.log(`[PATH] Source: apps/business-enterprise/dz-facture/`);
  console.log(`[READY] Open http://localhost:${PORT} in your browser to start testing.\n`);
});

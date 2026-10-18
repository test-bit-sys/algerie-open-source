import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

// Default flagship application served at root
const APP_DIR = path.join(__dirname, 'apps', 'business-enterprise', 'dz-facture');
const DISK_TREE_DIR = path.join(__dirname, 'apps', 'productivity', 'dz-disk-tree');

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

function getSystemDrives() {
  const isWindows = process.platform === 'win32';
  const drives = [];

  if (isWindows) {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    for (const letter of letters) {
      const root = `${letter}:\\`;
      try {
        fs.accessSync(root, fs.constants.R_OK);
        let spaceInfo = { total: 0, free: 0, used: 0, bsize: 4096 };
        try {
          if (fs.statfsSync) {
            const s = fs.statfsSync(root);
            spaceInfo.bsize = s.bsize;
            spaceInfo.total = s.blocks * s.bsize;
            spaceInfo.free = s.bfree * s.bsize;
            spaceInfo.used = spaceInfo.total - spaceInfo.free;
          }
        } catch {}

        drives.push({
          letter: `${letter}:`,
          path: root,
          name: `Local Disk (${letter}:)`,
          ...spaceInfo
        });
      } catch {}
    }
  } else {
    let spaceInfo = { total: 0, free: 0, used: 0, bsize: 4096 };
    try {
      if (fs.statfsSync) {
        const s = fs.statfsSync('/');
        spaceInfo.bsize = s.bsize;
        spaceInfo.total = s.blocks * s.bsize;
        spaceInfo.free = s.bfree * s.bsize;
        spaceInfo.used = spaceInfo.total - spaceInfo.free;
      }
    } catch {}

    drives.push({
      letter: '/',
      path: '/',
      name: 'Root Filesystem',
      ...spaceInfo
    });
  }

  return drives;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  let reqPath = decodeURI(parsedUrl.pathname);

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API for DZ-DiskTree
  if (reqPath === '/api/drives' && req.method === 'GET') {
    const drives = getSystemDrives();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, drives }));
    return;
  }

  if (reqPath === '/api/scan' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let scanner = null;
      const onClose = () => {
        if (scanner) scanner.cancel();
      };
      req.on('close', onClose);

      try {
        const { DiskScanner } = await import('./apps/productivity/dz-disk-tree/src/scanner.js');
        const payload = JSON.parse(body || '{}');
        const targetPath = payload.path || process.cwd();

        scanner = new DiskScanner({ maxTopFiles: payload.maxTopFiles || 500 });
        const result = await scanner.scanPath(targetPath);

        if (!res.headersSent && !res.destroyed) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, ...result }));
        }
      } catch (err) {
        if (!res.headersSent && !res.destroyed) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      } finally {
        req.off('close', onClose);
      }
    });
    return;
  }

  if (reqPath === '/api/export-csv' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { rows, type } = JSON.parse(body || '{}');
        let csvContent = '\uFEFF';
        if (type === 'extensions') {
          csvContent += 'Extension,Category,File Count,Total Size (Bytes),Allocated Size (Bytes)\n';
          for (const r of rows) {
            csvContent += `"${r.extension}","${r.category}",${r.count},${r.size},${r.allocatedSize}\n`;
          }
        } else {
          csvContent += 'File Name,Extension,Size (Bytes),Allocated (Bytes),Path,Last Modified\n';
          for (const r of rows) {
            csvContent += `"${r.name}","${r.extension || ''}",${r.size},${r.allocatedSize},"${r.path}","${r.modified || ''}"\n`;
          }
        }
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="dz-disktree-export-${Date.now()}.csv"`
        });
        res.end(csvContent);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // Route favicon.ico to official DZ logo
  if (reqPath === '/favicon.ico') {
    reqPath = '/assets/logo.jpg';
  }

  // Routing paths
  let filePath;
  if (reqPath.startsWith('/assets/')) {
    filePath = path.join(__dirname, reqPath);
  } else if (reqPath === '/disk-tree' || reqPath === '/disk-tree/' || reqPath.startsWith('/disk-tree/')) {
    let sub = reqPath.replace(/^\/disk-tree/, '');
    if (sub === '' || sub === '/') sub = '/index.html';
    filePath = path.join(DISK_TREE_DIR, sub);
  } else {
    if (reqPath === '/' || reqPath === '') {
      reqPath = '/index.html';
    }
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

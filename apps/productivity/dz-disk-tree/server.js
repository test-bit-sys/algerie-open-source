import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DiskScanner } from './src/scanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3001;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
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
    // Linux / macOS root
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

let activeScanner = null;

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURI(parsedUrl.pathname);

  // Set CORS headers for local inter-app communication
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: Get available drives
  if (pathname === '/api/drives' && req.method === 'GET') {
    const drives = getSystemDrives();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, drives }));
    return;
  }

  // API: Run Disk Scan
  if (pathname === '/api/scan' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const targetPath = payload.path || process.cwd();

        if (activeScanner) {
          activeScanner.cancel();
        }

        activeScanner = new DiskScanner({
          maxTopFiles: payload.maxTopFiles || 500
        });

        console.log(`[DZ-DiskTree] Starting scan on: ${targetPath}`);
        const result = await activeScanner.scanPath(targetPath);
        console.log(`[DZ-DiskTree] Scan completed in ${result.stats.durationMs}ms: ${result.stats.totalFiles} files, ${result.stats.totalFolders} folders`);

        if (!res.headersSent && !res.destroyed) {
          activeScanner = null;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, ...result }));
        }
      } catch (err) {
        console.error(`[DZ-DiskTree] Scan error:`, err);
        if (!res.headersSent && !res.destroyed) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      }
    });
    return;
  }

  // API: Cancel active scan
  if (pathname === '/api/cancel' && req.method === 'POST') {
    if (activeScanner) {
      activeScanner.cancel();
      activeScanner = null;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Scan cancelled' }));
    return;
  }

  // API: Export CSV
  if (pathname === '/api/export-csv' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { rows, type } = JSON.parse(body || '{}');
        let csvContent = '\uFEFF'; // BOM for UTF-8 Excel compatibility

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

  // Static File Serving
  let reqFile = pathname;
  if (reqFile === '/' || reqFile === '') {
    reqFile = '/index.html';
  }

  if (reqFile === '/favicon.ico' || reqFile === '/assets/logo.jpg') {
    // Route to global asset logo
    const rootLogo = path.join(__dirname, '..', '..', '..', 'assets', 'logo.jpg');
    if (fs.existsSync(rootLogo)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      fs.createReadStream(rootLogo).pipe(res);
      return;
    }
  }

  let filePath = path.join(__dirname, reqFile);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found - DZ-DiskTree');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`DZ-DiskTree — High-Performance Disk Space Analyzer`);
  console.log(`[INFO] Server running at: http://localhost:${PORT}`);
  console.log(`[SYS] Squarified Treemap | Offline-First | Trilingual (AR/FR/EN)`);
  console.log(`======================================================\n`);
});

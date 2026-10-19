import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec, execFile } from 'child_process';
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

        let name = letter === 'C' ? 'System Disk (C:)' : `Local Disk (${letter}:)`;
        drives.push({
          letter: `${letter}:`,
          path: root,
          name: name,
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

function getQuickFolders() {
  const home = os.homedir();
  const folders = [
    { id: 'desktop', name: 'سطح المكتب (Desktop)', path: path.join(home, 'Desktop'), icon: 'desktop' },
    { id: 'downloads', name: 'التنزيلات (Downloads)', path: path.join(home, 'Downloads'), icon: 'download' },
    { id: 'documents', name: 'المستندات (Documents)', path: path.join(home, 'Documents'), icon: 'document' },
    { id: 'pictures', name: 'الصور (Pictures)', path: path.join(home, 'Pictures'), icon: 'image' },
    { id: 'videos', name: 'الفيديوهات (Videos)', path: path.join(home, 'Videos'), icon: 'video' },
    { id: 'userhome', name: 'مجلد المستخدم (User Profile)', path: home, icon: 'user' },
    { id: 'temp', name: 'ملفات النظام المؤقتة (Temp)', path: os.tmpdir(), icon: 'trash' },
    { id: 'project', name: 'مجلد المشروع (DZ Open Suite)', path: path.resolve(__dirname, '..', '..', '..'), icon: 'folder' }
  ];

  if (process.platform === 'win32') {
    const winTemp = 'C:\\Windows\\Temp';
    if (fs.existsSync(winTemp)) {
      folders.push({ id: 'wintemp', name: 'مؤقت ويندوز (Windows Temp)', path: winTemp, icon: 'system' });
    }
  }

  return folders.filter(f => {
    try {
      return fs.existsSync(f.path);
    } catch {
      return false;
    }
  });
}

function openExplorer(targetPath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(targetPath)) return resolve(false);
    try {
      const isDir = fs.statSync(targetPath).isDirectory();
      if (process.platform === 'win32') {
        if (isDir) {
          execFile('explorer.exe', [targetPath], () => resolve(true));
        } else {
          execFile('explorer.exe', [`/select,${targetPath}`], () => resolve(true));
        }
      } else {
        const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
        execFile(cmd, [isDir ? targetPath : path.dirname(targetPath)], () => resolve(true));
      }
    } catch {
      resolve(false);
    }
  });
}

function openFile(targetPath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(targetPath)) return resolve(false);
    try {
      if (process.platform === 'win32') {
        exec(`start "" "${targetPath.replace(/"/g, '""')}"`, { shell: 'cmd.exe' }, () => resolve(true));
      } else {
        const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
        execFile(cmd, [targetPath], () => resolve(true));
      }
    } catch {
      resolve(false);
    }
  });
}

function openTerminal(targetPath) {
  return new Promise((resolve) => {
    let dir = targetPath;
    try {
      if (fs.existsSync(targetPath) && !fs.statSync(targetPath).isDirectory()) {
        dir = path.dirname(targetPath);
      }
    } catch {}

    if (process.platform === 'win32') {
      exec(`start cmd.exe /k "cd /d "${dir}" & title DZ-DiskTree Terminal"`, { shell: 'cmd.exe' }, () => resolve(true));
    } else {
      resolve(false);
    }
  });
}

function deleteItem(targetPath, permanent = false) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(targetPath)) {
      return reject(new Error('Target file or folder does not exist'));
    }

    if (permanent) {
      fs.rm(targetPath, { recursive: true, force: true }, (err) => {
        if (err) return reject(err);
        resolve({ ok: true, permanent: true });
      });
      return;
    }

    if (process.platform === 'win32') {
      const isDir = fs.statSync(targetPath).isDirectory();
      const method = isDir ? 'DeleteDirectory' : 'DeleteFile';
      const psCmd = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${method}('${targetPath.replace(/'/g, "''")}', 'OnlyErrorDialogs', 'SendToRecycleBin')`;
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], (err) => {
        if (err) {
          // Fallback to permanent
          fs.rm(targetPath, { recursive: true, force: true }, (err2) => {
            if (err2) return reject(err2);
            resolve({ ok: true, permanent: true, fallback: true });
          });
        } else {
          resolve({ ok: true, recycled: true });
        }
      });
    } else {
      fs.rm(targetPath, { recursive: true, force: true }, (err) => {
        if (err) return reject(err);
        resolve({ ok: true, permanent: true });
      });
    }
  });
}

function browseFolderNative() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve({ ok: false, message: 'Platform not supported' });
    }
    const psScript = `
[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'DZ-DiskTree — اختر القرص أو المجلد المراد فحصه وتحليل مساحته'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
`.trim();

    execFile('powershell', ['-NoProfile', '-Command', psScript], (err, stdout) => {
      const selected = stdout ? stdout.trim() : '';
      if (selected) {
        resolve({ ok: true, path: selected });
      } else {
        resolve({ ok: false, cancelled: true });
      }
    });
  });
}

// Active Scan state & SSE progress clients
let activeScanner = null;
const sseClients = new Set();

function broadcastProgress(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURI(parsedUrl.pathname);

  // Set CORS headers
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

  // API: Get quick folders shortcuts
  if (pathname === '/api/quick-folders' && req.method === 'GET') {
    const folders = getQuickFolders();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, folders }));
    return;
  }

  // API: Native Windows Folder Browser Dialog
  if (pathname === '/api/browse-folder' && req.method === 'GET') {
    const result = await browseFolderNative();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // API: Live Scan Progress Stream (SSE)
  if (pathname === '/api/scan-stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('retry: 1000\n\n');
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // API: Open in Windows Explorer
  if (pathname === '/api/open-explorer' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { path: targetPath } = JSON.parse(body || '{}');
        await openExplorer(targetPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // API: Open File with associated application
  if (pathname === '/api/open-file' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { path: targetPath } = JSON.parse(body || '{}');
        await openFile(targetPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // API: Open Terminal in directory
  if (pathname === '/api/open-terminal' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { path: targetPath } = JSON.parse(body || '{}');
        await openTerminal(targetPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // API: Delete File or Folder (Recycle Bin / Permanent)
  if (pathname === '/api/delete-file' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { path: targetPath, permanent } = JSON.parse(body || '{}');
        const result = await deleteItem(targetPath, permanent);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // API: Clean Delete Batch (for PC Cleaner)
  if (pathname === '/api/clean-batch' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { filePaths } = JSON.parse(body || '{}');
        let cleanedCount = 0;
        let cleanedBytes = 0;
        for (const fPath of filePaths || []) {
          try {
            if (fs.existsSync(fPath)) {
              const sz = fs.statSync(fPath).size;
              await deleteItem(fPath, false);
              cleanedCount++;
              cleanedBytes += sz;
            }
          } catch {}
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, cleanedCount, cleanedBytes }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
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
          maxTopFiles: payload.maxTopFiles || 500,
          onProgress: (pData) => {
            broadcastProgress(pData);
          }
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
          activeScanner = null;
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
    broadcastProgress({ status: 'cancelled' });
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
  console.log(`DZ-DiskTree — High-Performance PC Disk Space Analyzer`);
  console.log(`[INFO] Server running at: http://localhost:${PORT}`);
  console.log(`[SYS] Native Windows I/O | Explorer Integration | Trilingual (AR/FR/EN)`);
  console.log(`======================================================\n`);
});

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import zlib from 'zlib';
import { exec, execFile } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3002;

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
        let spaceInfo = { total: 0, free: 0, used: 0 };
        try {
          if (fs.statfsSync) {
            const s = fs.statfsSync(root);
            spaceInfo.total = s.blocks * s.bsize;
            spaceInfo.free = s.bfree * s.bsize;
            spaceInfo.used = spaceInfo.total - spaceInfo.free;
          }
        } catch {}

        drives.push({
          letter: `${letter}:`,
          path: root,
          name: letter === 'C' ? 'System Disk (C:)' : `Local Disk (${letter}:)`,
          ...spaceInfo
        });
      } catch {}
    }
  } else {
    drives.push({
      letter: '/',
      path: '/',
      name: 'Root Filesystem',
      total: 0,
      free: 0,
      used: 0
    });
  }

  return drives;
}

function getQuickFolders() {
  const home = os.homedir();
  const folders = [
    { id: 'desktop', name: 'سطح المكتب (Desktop)', path: path.join(home, 'Desktop') },
    { id: 'downloads', name: 'التنزيلات (Downloads)', path: path.join(home, 'Downloads') },
    { id: 'documents', name: 'المستندات (Documents)', path: path.join(home, 'Documents') },
    { id: 'pictures', name: 'الصور (Pictures)', path: path.join(home, 'Pictures') },
    { id: 'videos', name: 'الفيديوهات (Videos)', path: path.join(home, 'Videos') },
    { id: 'project', name: 'مجلد المشروع (DZ Open Suite)', path: path.resolve(__dirname, '..', '..', '..') }
  ];

  return folders.filter(f => {
    try {
      return fs.existsSync(f.path);
    } catch {
      return false;
    }
  });
}

function listDirectory(dirPath) {
  return new Promise((resolve, reject) => {
    let resolved = dirPath || os.homedir();
    if (!fs.existsSync(resolved)) {
      resolved = os.homedir();
    }

    fs.readdir(resolved, { withFileTypes: true }, (err, entries) => {
      if (err) return reject(err);

      const items = [];
      for (const entry of entries) {
        const fullPath = path.join(resolved, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          const isDir = entry.isDirectory();
          const ext = isDir ? '' : path.extname(entry.name).toLowerCase();
          const isArchive = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tgz', '.iso'].includes(ext);

          items.push({
            name: entry.name,
            path: fullPath,
            isDirectory: isDir,
            isArchive: isArchive,
            size: isDir ? 0 : stat.size,
            modified: stat.mtime,
            extension: ext
          });
        } catch {
          // Locked or system item
        }
      }

      // Sort: folders first, then files
      items.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });

      resolve({
        currentPath: resolved,
        parentPath: path.dirname(resolved) !== resolved ? path.dirname(resolved) : null,
        items
      });
    });
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
$dialog.Description = 'DZ-Archive — اختر مجلد الوجهة للاستخراج أو الإضافة'
$dialog.ShowNewFolderButton = $true
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

function browseArchiveNative() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve({ ok: false, message: 'Platform not supported' });
    }
    const psScript = `
[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'DZ-Archive — اختر ملف أرشيف مضغوط لفتحه'
$dialog.Filter = 'All Supported Archives (*.zip;*.rar;*.7z;*.tar;*.gz)|*.zip;*.rar;*.7z;*.tar;*.gz;*.tgz|ZIP Archives (*.zip)|*.zip|TAR Archives (*.tar;*.gz)|*.tar;*.gz|All Files (*.*)|*.*'
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.FileName)
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

function extractArchiveToFolder(archivePath, destinationFolder) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(archivePath)) {
      return reject(new Error('Archive file does not exist'));
    }

    if (!fs.existsSync(destinationFolder)) {
      fs.mkdirSync(destinationFolder, { recursive: true });
    }

    const ext = path.extname(archivePath).toLowerCase();

    // If on Windows and tar or zip:
    if (ext === '.tar' || ext === '.gz' || ext === '.tgz') {
      // Use built-in tar.exe
      execFile('tar', ['-xf', archivePath, '-C', destinationFolder], (err) => {
        if (err) return reject(err);
        resolve({ ok: true, extractedTo: destinationFolder });
      });
      return;
    }

    if (ext === '.zip') {
      // Use PowerShell Expand-Archive on Windows
      if (process.platform === 'win32') {
        const psCmd = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destinationFolder.replace(/'/g, "''")}' -Force`;
        execFile('powershell', ['-NoProfile', '-Command', psCmd], (err) => {
          if (err) return reject(err);
          resolve({ ok: true, extractedTo: destinationFolder });
        });
      } else {
        execFile('tar', ['-xf', archivePath, '-C', destinationFolder], (err) => {
          if (err) return reject(err);
          resolve({ ok: true, extractedTo: destinationFolder });
        });
      }
      return;
    }

    // Default fallback to tar.exe which handles zip/tar/7z via libarchive
    execFile('tar', ['-xf', archivePath, '-C', destinationFolder], (err) => {
      if (err) return reject(err);
      resolve({ ok: true, extractedTo: destinationFolder });
    });
  });
}

function compressFilesToArchive(sourcePaths, outputArchivePath, format = 'zip') {
  return new Promise((resolve, reject) => {
    if (!sourcePaths || sourcePaths.length === 0) {
      return reject(new Error('No files or folders selected to compress'));
    }

    const outDir = path.dirname(outputArchivePath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    if (format === 'tar') {
      const args = ['-cf', outputArchivePath, ...sourcePaths];
      execFile('tar', args, (err) => {
        if (err) return reject(err);
        resolve({ ok: true, archivePath: outputArchivePath });
      });
      return;
    }

    // ZIP format
    if (process.platform === 'win32') {
      const pathsJoined = sourcePaths.map(p => `'${p.replace(/'/g, "''")}'`).join(',');
      const psCmd = `Compress-Archive -LiteralPath @(${pathsJoined}) -DestinationPath '${outputArchivePath.replace(/'/g, "''")}' -Force`;
      execFile('powershell', ['-NoProfile', '-Command', psCmd], (err) => {
        if (err) {
          // Fallback to tar -a -cf
          execFile('tar', ['-a', '-cf', outputArchivePath, ...sourcePaths], (err2) => {
            if (err2) return reject(err2);
            resolve({ ok: true, archivePath: outputArchivePath });
          });
        } else {
          resolve({ ok: true, archivePath: outputArchivePath });
        }
      });
    } else {
      execFile('tar', ['-a', '-cf', outputArchivePath, ...sourcePaths], (err) => {
        if (err) return reject(err);
        resolve({ ok: true, archivePath: outputArchivePath });
      });
    }
  });
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

  // API: Get drives
  if (pathname === '/api/fs/drives' && req.method === 'GET') {
    const drives = getSystemDrives();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, drives }));
    return;
  }

  // API: Get quick folders
  if (pathname === '/api/fs/quick-folders' && req.method === 'GET') {
    const folders = getQuickFolders();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, folders }));
    return;
  }

  // API: List real files & folders on disk
  if (pathname === '/api/fs/list' && req.method === 'GET') {
    const targetPath = parsedUrl.searchParams.get('path');
    try {
      const data = await listDirectory(targetPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...data }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // API: Browse folder (native dialog)
  if (pathname === '/api/fs/browse-folder' && req.method === 'GET') {
    const result = await browseFolderNative();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // API: Browse archive (native dialog)
  if (pathname === '/api/fs/browse-archive' && req.method === 'GET') {
    const result = await browseArchiveNative();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // API: Reveal in Windows Explorer
  if (pathname === '/api/fs/reveal' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { path: targetPath } = JSON.parse(body || '{}');
        if (fs.existsSync(targetPath)) {
          const isDir = fs.statSync(targetPath).isDirectory();
          if (process.platform === 'win32') {
            if (isDir) {
              execFile('explorer.exe', [targetPath], () => {});
            } else {
              execFile('explorer.exe', [`/select,${targetPath}`], () => {});
            }
          } else {
            const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
            execFile(cmd, [isDir ? targetPath : path.dirname(targetPath)], () => {});
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // API: Open file with default application
  if (pathname === '/api/fs/open' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { path: targetPath } = JSON.parse(body || '{}');
        if (fs.existsSync(targetPath)) {
          if (process.platform === 'win32') {
            exec(`start "" "${targetPath.replace(/"/g, '""')}"`, { shell: 'cmd.exe' }, () => {});
          } else {
            const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
            execFile(cmd, [targetPath], () => {});
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // API: Extract archive directly to a PC folder
  if (pathname === '/api/archive/extract-to-folder' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { archivePath, destinationFolder } = JSON.parse(body || '{}');
        const result = await extractArchiveToFolder(archivePath, destinationFolder);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // API: Compress real PC files into an archive on disk
  if (pathname === '/api/archive/compress-files' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { sourcePaths, outputArchivePath, format } = JSON.parse(body || '{}');
        const result = await compressFilesToArchive(sourcePaths, outputArchivePath, format);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // API: Read binary archive from disk for in-memory inspection
  if (pathname === '/api/archive/read-file' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { path: targetPath } = JSON.parse(body || '{}');
        if (!fs.existsSync(targetPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'File not found' }));
          return;
        }

        const stat = fs.statSync(targetPath);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size,
          'X-File-Name': encodeURIComponent(path.basename(targetPath))
        });
        fs.createReadStream(targetPath).pipe(res);
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
      res.end('404 Not Found - DZ-Archive');
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
  console.log(`DZ-Archive — High-Performance PC Compression Studio`);
  console.log(`[INFO] Server running at: http://localhost:${PORT}`);
  console.log(`[SYS] Native Windows I/O | WinRAR 1:1 Engine | Trilingual (AR/FR/EN)`);
  console.log(`======================================================\n`);
});

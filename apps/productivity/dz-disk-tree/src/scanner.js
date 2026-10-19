/**
 * DZ-DiskTree — High-Performance File System Scanner & Aggregator
 * Crawls directory trees asynchronously with parallel worker pool,
 * aggregates extension statistics, tracks top largest files, and computes
 * logical vs allocated cluster storage.
 */

import fs from 'fs';
import path from 'path';

export class DiskScanner {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 32;
    this.clusterSize = options.clusterSize || 4096; // Standard NTFS cluster size
    this.maxTopFiles = options.maxTopFiles || 500;
    this.onProgress = options.onProgress || null;

    this.reset();
  }

  reset() {
    this.stats = {
      totalFiles: 0,
      totalFolders: 0,
      totalSize: 0,
      totalAllocated: 0,
      startTime: 0,
      endTime: 0,
      durationMs: 0
    };
    this.extensions = new Map(); // ext -> { ext, count, size, allocatedSize, category }
    this.topFiles = []; // Sorted list of largest files (descending)
    this.sizeMap = new Map(); // size -> Array<fileNode> (for duplicate detection)
    this.isCancelled = false;
    this.lastProgressTime = 0;
  }

  cancel() {
    this.isCancelled = true;
  }

  static getExtensionCategory(ext) {
    const clean = (ext || '').toLowerCase().replace(/^\./, '');
    const categories = {
      video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', '3gp', 'ts', 'vob'],
      audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus', 'mid', 'alac'],
      image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'ico', 'psd', 'ai', 'raw', 'cr2', 'nef'],
      archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'dmg', 'tgz', 'cab', 'vhd', 'vhdx'],
      document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'txt', 'rtf', 'md', 'csv', 'epub'],
      code: ['js', 'mjs', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'scss', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'php', 'rb', 'sh', 'bat', 'cmd', 'ps1', 'yaml', 'yml', 'xml', 'sql'],
      executable: ['exe', 'msi', 'dll', 'sys', 'bin', 'app', 'apk', 'so', 'dylib', 'com', 'scr'],
      database: ['db', 'sqlite', 'sqlite3', 'mdb', 'accdb', 'ldf', 'mdf', 'ibd', 'myd', 'myi'],
      system: ['tmp', 'log', 'bak', 'swp', 'dat', 'ini', 'cfg', 'reg', 'dmp', 'cur']
    };

    for (const [category, exts] of Object.entries(categories)) {
      if (exts.includes(clean)) return category;
    }
    return 'other';
  }

  async scanPath(targetPath) {
    this.reset();
    this.stats.startTime = Date.now();
    this.lastProgressTime = this.stats.startTime;

    const rootStat = await fs.promises.stat(targetPath).catch(() => null);
    if (!rootStat) {
      throw new Error(`Target path does not exist or cannot be accessed: ${targetPath}`);
    }

    const rootNode = {
      name: path.basename(targetPath) || targetPath,
      path: targetPath,
      isDirectory: true,
      size: 0,
      allocatedSize: 0,
      filesCount: 0,
      foldersCount: 0,
      children: [],
      modified: rootStat.mtime
    };

    await this.crawlDirectory(rootNode, 0);

    this.stats.endTime = Date.now();
    this.stats.durationMs = Math.max(1, this.stats.endTime - this.stats.startTime);

    return {
      tree: rootNode,
      stats: this.stats,
      extensions: Array.from(this.extensions.values()).sort((a, b) => b.size - a.size),
      topFiles: this.topFiles,
      duplicates: this.computeDuplicates(),
      cleanSuggestions: this.computeCleanSuggestions()
    };
  }

  async crawlDirectory(dirNode, depth) {
    if (this.isCancelled) return;

    let entries = [];
    try {
      entries = await fs.promises.readdir(dirNode.path, { withFileTypes: true });
    } catch {
      // Access denied or system volume
      return;
    }

    this.stats.totalFolders++;
    this.emitProgress(dirNode.path);

    const subDirs = [];
    const fileEntries = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullSubPath = path.join(dirNode.path, entry.name);
        const childDir = {
          name: entry.name,
          path: fullSubPath,
          isDirectory: true,
          size: 0,
          allocatedSize: 0,
          filesCount: 0,
          foldersCount: 0,
          children: [],
          modified: null
        };
        dirNode.children.push(childDir);
        subDirs.push(childDir);
      } else if (entry.isFile()) {
        fileEntries.push(entry);
      }
    }

    // Parallel batch stat for files (chunks of 40 for optimal I/O)
    const BATCH_SIZE = 40;
    for (let i = 0; i < fileEntries.length; i += BATCH_SIZE) {
      if (this.isCancelled) return;
      const batch = fileEntries.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (entry) => {
        const fullPath = path.join(dirNode.path, entry.name);
        try {
          const fileStat = await fs.promises.stat(fullPath);
          const size = fileStat.size;
          const allocated = Math.ceil(size / this.clusterSize) * this.clusterSize;
          const ext = path.extname(entry.name).toLowerCase() || '.none';

          const fileNode = {
            name: entry.name,
            path: fullPath,
            isDirectory: false,
            extension: ext,
            size: size,
            allocatedSize: allocated,
            modified: fileStat.mtime
          };

          dirNode.children.push(fileNode);
          dirNode.size += size;
          dirNode.allocatedSize += allocated;
          dirNode.filesCount++;

          this.stats.totalFiles++;
          this.stats.totalSize += size;
          this.stats.totalAllocated += allocated;

          // Extension Stats
          let extRecord = this.extensions.get(ext);
          if (!extRecord) {
            extRecord = {
              extension: ext,
              category: DiskScanner.getExtensionCategory(ext),
              count: 0,
              size: 0,
              allocatedSize: 0
            };
            this.extensions.set(ext, extRecord);
          }
          extRecord.count++;
          extRecord.size += size;
          extRecord.allocatedSize += allocated;

          // Top files (O(log N) binary insert)
          this.recordTopFile(fileNode);

          // Duplicate candidate map (files > 100 KB)
          if (size >= 102400) {
            let list = this.sizeMap.get(size);
            if (!list) {
              list = [];
              this.sizeMap.set(size, list);
            }
            list.push({ name: entry.name, path: fullPath, size, modified: fileStat.mtime });
          }
        } catch {
          // File was removed or locked
        }
      }));

      if (this.stats.totalFiles % 200 === 0) {
        this.emitProgress(dirNode.path);
      }
    }

    // Crawl subdirectories
    for (const subDir of subDirs) {
      if (this.isCancelled) return;
      await this.crawlDirectory(subDir, depth + 1);
      dirNode.size += subDir.size;
      dirNode.allocatedSize += subDir.allocatedSize;
      dirNode.filesCount += subDir.filesCount;
      dirNode.foldersCount += (subDir.foldersCount + 1);
    }
  }

  emitProgress(currentPath) {
    if (!this.onProgress) return;
    const now = Date.now();
    if (now - this.lastProgressTime < 80) return; // Limit updates to ~12 updates/sec max
    this.lastProgressTime = now;

    const elapsedSec = (now - this.stats.startTime) / 1000;
    const filesPerSec = elapsedSec > 0 ? Math.round(this.stats.totalFiles / elapsedSec) : 0;

    this.onProgress({
      files: this.stats.totalFiles,
      folders: this.stats.totalFolders,
      size: this.stats.totalSize,
      allocatedSize: this.stats.totalAllocated,
      currentPath: currentPath,
      speed: filesPerSec,
      elapsed: elapsedSec
    });
  }

  recordTopFile(file) {
    if (this.topFiles.length < this.maxTopFiles) {
      this.binaryInsert(file);
    } else if (file.size > this.topFiles[this.topFiles.length - 1].size) {
      this.topFiles.pop();
      this.binaryInsert(file);
    }
  }

  binaryInsert(file) {
    let low = 0;
    let high = this.topFiles.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.topFiles[mid].size < file.size) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    this.topFiles.splice(low, 0, file);
  }

  computeDuplicates() {
    const duplicateGroups = [];
    let wastedSpace = 0;

    for (const [size, files] of this.sizeMap.entries()) {
      if (files.length > 1) {
        // Potential duplicates
        const wasted = size * (files.length - 1);
        wastedSpace += wasted;
        duplicateGroups.push({
          size,
          wasted,
          count: files.length,
          files: files
        });
      }
    }

    duplicateGroups.sort((a, b) => b.wasted - a.wasted);
    return {
      groups: duplicateGroups.slice(0, 100), // Top 100 duplicate clusters
      totalWasted: wastedSpace,
      totalDuplicateFiles: duplicateGroups.reduce((acc, g) => acc + g.count, 0)
    };
  }

  computeCleanSuggestions() {
    const tempExtensions = new Set(['.tmp', '.temp', '.log', '.bak', '.dmp', '.old', '.chk']);
    const installerExtensions = new Set(['.iso', '.msi']);
    
    let tempSize = 0;
    const tempFiles = [];

    let installerSize = 0;
    const installerFiles = [];

    let devCacheSize = 0;
    const devCacheFolders = [];

    for (const file of this.topFiles) {
      const ext = file.extension.toLowerCase();
      const lowerPath = file.path.toLowerCase();

      if (tempExtensions.has(ext) || lowerPath.includes('\\temp\\') || lowerPath.includes('/temp/')) {
        tempSize += file.size;
        tempFiles.push(file);
      } else if (installerExtensions.has(ext) || (ext === '.exe' && file.size > 104857600 && lowerPath.includes('download'))) {
        installerSize += file.size;
        installerFiles.push(file);
      }
    }

    return {
      categories: [
        {
          id: 'temp',
          name: 'الملفات المؤقتة وسجلات النظام (Temp & Logs)',
          nameFr: 'Fichiers temporaires et journaux',
          nameEn: 'Temporary Files & Logs',
          size: tempSize,
          count: tempFiles.length,
          files: tempFiles.slice(0, 50),
          recommended: true
        },
        {
          id: 'installers',
          name: 'حزم التثبيت وملفات ISO القديمة في التنزيلات',
          nameFr: 'Installateurs volumineux et ISO',
          nameEn: 'Large Installers & ISO Images',
          size: installerSize,
          count: installerFiles.length,
          files: installerFiles.slice(0, 50),
          recommended: false
        }
      ],
      totalReclaimable: tempSize + installerSize
    };
  }
}

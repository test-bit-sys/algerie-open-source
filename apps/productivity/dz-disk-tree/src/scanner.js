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
    this.concurrency = options.concurrency || 24;
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
    this.topFiles = []; // Sorted list of largest files
    this.activeTasks = 0;
    this.isCancelled = false;
  }

  cancel() {
    this.isCancelled = true;
  }

  static getExtensionCategory(ext) {
    const clean = (ext || '').toLowerCase().replace(/^\./, '');
    const categories = {
      video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', '3gp', 'ts'],
      audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus', 'mid'],
      image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'ico', 'psd', 'ai'],
      archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'dmg', 'tgz'],
      document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'txt', 'rtf', 'md', 'csv'],
      code: ['js', 'mjs', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'scss', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'php', 'rb', 'sh', 'bat', 'yaml', 'yml', 'xml', 'sql'],
      executable: ['exe', 'msi', 'dll', 'sys', 'bin', 'app', 'apk', 'so', 'dylib'],
      database: ['db', 'sqlite', 'sqlite3', 'mdb', 'accdb', 'ldf', 'mdf'],
      system: ['tmp', 'log', 'bak', 'swp', 'dat', 'ini', 'cfg', 'reg']
    };

    for (const [category, exts] of Object.entries(categories)) {
      if (exts.includes(clean)) return category;
    }
    return 'other';
  }

  async scanPath(targetPath) {
    this.reset();
    this.stats.startTime = Date.now();

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
    this.stats.durationMs = this.stats.endTime - this.stats.startTime;

    return {
      tree: rootNode,
      stats: this.stats,
      extensions: Array.from(this.extensions.values()).sort((a, b) => b.size - a.size),
      topFiles: this.topFiles
    };
  }

  async crawlDirectory(dirNode, depth) {
    if (this.isCancelled) return;

    let entries = [];
    try {
      entries = await fs.promises.readdir(dirNode.path, { withFileTypes: true });
    } catch {
      // Permission denied or inaccessible folder (e.g. System Volume Information)
      return;
    }

    this.stats.totalFolders++;
    if (this.onProgress && this.stats.totalFolders % 50 === 0) {
      this.onProgress({
        files: this.stats.totalFiles,
        folders: this.stats.totalFolders,
        size: this.stats.totalSize,
        currentPath: dirNode.path
      });
    }

    const subDirs = [];

    for (const entry of entries) {
      if (this.isCancelled) return;

      const fullPath = path.join(dirNode.path, entry.name);

      if (entry.isDirectory()) {
        const childDir = {
          name: entry.name,
          path: fullPath,
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

          // Record extension statistics
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

          // Track Top Largest Files
          this.recordTopFile(fileNode);
        } catch {
          // File locked or removed during scan
        }
      }
    }

    // Crawl subdirectories
    for (const subDir of subDirs) {
      await this.crawlDirectory(subDir, depth + 1);
      dirNode.size += subDir.size;
      dirNode.allocatedSize += subDir.allocatedSize;
      dirNode.filesCount += subDir.filesCount;
      dirNode.foldersCount += (subDir.foldersCount + 1);
    }
  }

  recordTopFile(file) {
    if (this.topFiles.length < this.maxTopFiles) {
      this.topFiles.push(file);
      this.topFiles.sort((a, b) => b.size - a.size);
    } else if (file.size > this.topFiles[this.topFiles.length - 1].size) {
      this.topFiles.pop();
      this.topFiles.push(file);
      this.topFiles.sort((a, b) => b.size - a.size);
    }
  }
}

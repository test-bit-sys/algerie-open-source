/**
 * DZ-DiskTree — Scanner & Treemap Engine Unit Tests
 * 100% Offline-First, Zero-Dependency Test Suite (node:test)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DiskScanner } from '../src/scanner.js';
import { SquarifiedTreemap } from '../src/treemap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('DZ-DiskTree Scanner & Treemap Tests', () => {

  test('Extension classification maps file types to correct categories', () => {
    assert.strictEqual(DiskScanner.getExtensionCategory('.mp4'), 'video');
    assert.strictEqual(DiskScanner.getExtensionCategory('mkv'), 'video');
    assert.strictEqual(DiskScanner.getExtensionCategory('.mp3'), 'audio');
    assert.strictEqual(DiskScanner.getExtensionCategory('.png'), 'image');
    assert.strictEqual(DiskScanner.getExtensionCategory('zip'), 'archive');
    assert.strictEqual(DiskScanner.getExtensionCategory('.pdf'), 'document');
    assert.strictEqual(DiskScanner.getExtensionCategory('.js'), 'code');
    assert.strictEqual(DiskScanner.getExtensionCategory('.rs'), 'code');
    assert.strictEqual(DiskScanner.getExtensionCategory('.exe'), 'executable');
    assert.strictEqual(DiskScanner.getExtensionCategory('sqlite'), 'database');
    assert.strictEqual(DiskScanner.getExtensionCategory('unknownxyz'), 'other');
  });

  test('formatBytes converts raw byte numbers into human-readable strings', () => {
    assert.strictEqual(SquarifiedTreemap.formatBytes(0), '0 B');
    assert.strictEqual(SquarifiedTreemap.formatBytes(1024), '1 KB');
    assert.strictEqual(SquarifiedTreemap.formatBytes(1048576), '1 MB');
    assert.strictEqual(SquarifiedTreemap.formatBytes(1073741824), '1 GB');
  });

  test('DiskScanner crawls a local directory and aggregates statistics', async () => {
    const scanner = new DiskScanner();
    const targetDir = path.resolve(__dirname, '..', 'src');

    const { tree } = await scanner.scanPath(targetDir);

    assert.ok(tree);
    assert.strictEqual(tree.isDirectory, true);
    assert.ok(tree.children.length >= 3);
    assert.ok(scanner.stats.totalFiles >= 3);
    assert.ok(scanner.stats.totalSize > 0);
    assert.ok(scanner.extensions.has('.js') || scanner.extensions.has('.css'));
    assert.ok(scanner.topFiles.length > 0);
  });
});

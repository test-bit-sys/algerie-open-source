/**
 * DZ Open Suite unit tests — Shared static server path-containment guard.
 * Proves the server is immune to `../` path-traversal attacks.
 * Run: npm test (from the repository root)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPathWithin, MIME_TYPES } from '../../../../tools/static-server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('files inside the root are allowed', () => {
  assert.equal(isPathWithin(path.join(root, 'index.html'), root), true);
  assert.equal(isPathWithin(path.join(root, 'src', 'modules', 'db.js'), root), true);
});

test('`../` traversal above the root is rejected', () => {
  const escaped = path.resolve(root, '..', '..', 'package.json');
  assert.equal(isPathWithin(escaped, root), false);
});

test('sibling directories with a shared prefix are rejected', () => {
  // Naive startsWith() checks accept `dz-facture-evil` when the root is
  // `dz-facture` — path.relative() based containment must not.
  const evil = path.resolve(path.dirname(root), `${path.basename(root)}-evil`, 'x.js');
  assert.equal(isPathWithin(evil, root), false);
});

test('the root directory itself is not a servable file', () => {
  assert.equal(isPathWithin(root, root), false);
});

test('MIME table covers every asset type served by the app', () => {
  assert.equal(MIME_TYPES['.html'], 'text/html; charset=utf-8');
  assert.equal(MIME_TYPES['.js'], 'text/javascript; charset=utf-8');
  assert.equal(MIME_TYPES['.css'], 'text/css; charset=utf-8');
  assert.equal(MIME_TYPES['.json'], 'application/json; charset=utf-8');
  assert.equal(MIME_TYPES['.svg'], 'image/svg+xml');
  assert.equal(MIME_TYPES['.jpg'], 'image/jpeg');
  assert.equal(MIME_TYPES['.woff2'], 'font/woff2');
});

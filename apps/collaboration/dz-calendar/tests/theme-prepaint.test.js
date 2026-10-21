/**
 * The inline theme pre-paint in index.html: an explicit-theme user must not
 * watch every boot screen render in the OS theme while the SDK, session, and
 * calendar load — the last-synced theme is read synchronously from the
 * offline snapshot before anything else runs. The snippet must never throw
 * (it runs before any error handling exists) and must leave the "system"
 * setting alone.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HTML = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../index.html'),
  'utf8',
);

// The inline script that mentions the snapshot key is the pre-paint.
const SNIPPET = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .find((s) => s.includes('cal:snapshot'));

function run() {
  new Function(SNIPPET)();
}

function seed(settings) {
  localStorage.setItem('cal:snapshot', JSON.stringify({ userId: 'u', ts: 1, entries: { 'cal:settings': settings } }));
}

describe('index.html theme pre-paint', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('exists in index.html', () => {
    expect(SNIPPET).toBeTruthy();
  });

  it('applies an explicit theme from the snapshot (object and string forms)', () => {
    seed({ theme: 'dark' });
    run();
    expect(document.documentElement.dataset.theme).toBe('dark');

    delete document.documentElement.dataset.theme;
    seed(JSON.stringify({ theme: 'light' })); // snapshot values may be JSON strings
    run();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('leaves the OS ("system") theme alone', () => {
    seed({ theme: 'system' });
    run();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('never throws on a missing, corrupt, or foreign snapshot', () => {
    expect(() => run()).not.toThrow(); // nothing stored
    localStorage.setItem('cal:snapshot', '{not json');
    expect(() => run()).not.toThrow();
    localStorage.setItem('cal:snapshot', JSON.stringify({ entries: { 'cal:settings': 42 } }));
    expect(() => run()).not.toThrow();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

import { it, expect } from 'vitest';
import { parseBulk, toBulk } from '../src/ui/kv-table.js';

const row = (id, key, value, extra = {}) => ({ id, key, value, enabled: true, description: '', ...extra });

it('keeps form-data file rows in place and never matches them to text lines', () => {
  const previous = [row('a', 'name', 'x'), row('f1', 'avatar', '', { kind: 'file' }), row('b', 'age', '3')];
  const out = parseBulk('name:x\navatar:typed\nage:3', previous);
  expect(out.map((r) => [r.id === 'f1' ? 'f1' : r.key, r.kind || 'text'])).toEqual([['name', 'text'], ['f1', 'file'], ['avatar', 'text'], ['age', 'text']]);
  expect(new Set(out.map((r) => r.id)).size).toBe(out.length);
  expect(toBulk(previous)).toBe('name: x\nage: 3');
});

it('keeps a secret variable secret when bulk edit renames its key', () => {
  const previous = [row('a', 'host', 'x'), row('s', 'token', 'abc', { secret: true, description: 'API token' })];
  const out = parseBulk('host:x\ntoken2:abc', previous);
  expect(out[1]).toMatchObject({ id: 's', key: 'token2', secret: true, description: 'API token' });
  // A key that still exists elsewhere is matched by key, not by line.
  const swapped = parseBulk('token:abc\nhost:x', previous);
  expect(swapped.map((r) => r.id)).toEqual(['s', 'a']);
});

it('round-trips values that start with a space', () => {
  const rows = [row('a', 'k', ' padded'), row('b', 'j', 'x')];
  expect(parseBulk(toBulk(rows), rows).map((r) => r.value)).toEqual([' padded', 'x']);
  expect(parseBulk('k:v').map((r) => r.value)).toEqual(['v']);
});

it('adds a row from the blank row only once an IME composition ends', async () => {
  const { createKvTable } = await import('../src/ui/kv-table.js');
  let rows = [];
  const table = createKvTable({ onChange: (r) => (rows = r) });
  document.body.append(table.el);
  const ghost = table.el.querySelector('tr.ghost [data-field="key"] input');
  ghost.focus();
  for (const v of ['n', 'に', '日本']) {
    ghost.value = v;
    ghost.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  }
  expect(rows).toEqual([]);
  expect(ghost.isConnected).toBe(true);
  ghost.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本' }));
  // Some browsers send the final input after compositionend.
  ghost.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect(rows.map((r) => r.key)).toEqual(['日本']);
  expect(document.activeElement.value).toBe('日本');
  table.el.remove();
});

it('keeps focus in the table after deleting a row from its context menu', async () => {
  const { createKvTable } = await import('../src/ui/kv-table.js');
  const table = createKvTable({ rows: [row('a', 'a', '1'), row('b', 'b', '2'), row('c', 'c', '3')] });
  document.body.append(table.el);
  const tr = table.el.querySelector('tr[data-id="b"]');
  tr.querySelector('[data-field="key"] input').focus();
  tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  [...document.querySelectorAll('.menu [role="menuitem"]')].find((b) => b.textContent === 'Delete').click();
  expect(table.getRows().map((r) => r.key)).toEqual(['a', 'c']);
  expect(document.activeElement).toBe(table.el.querySelector('tr[data-id="c"] [data-field="key"] input'));
  table.el.remove();
});

it('keeps keys that contain a colon when bulk edit changes another line', () => {
  const previous = [row('a', 'filter:name', 'bob'), row('b', 'x', '1')];
  const out = parseBulk(toBulk(previous).replace('x: 1', 'x: 2'), previous);
  expect(out.map((r) => [r.id, r.key, r.value])).toEqual([['a', 'filter:name', 'bob'], ['b', 'x', '2']]);
  // Editing that row's value, or typing a new one in the format bulk edit writes, keeps the colon in the key.
  expect(parseBulk('filter:name: bobby\nsort:by: date', previous).map((r) => [r.key, r.value])).toEqual([['filter:name', 'bobby'], ['sort:by', 'date']]);
  // Without a space, the first colon still splits.
  expect(parseBulk('k:v:w').map((r) => [r.key, r.value])).toEqual([['k', 'v:w']]);
});

it('names the row controls after the key as it is edited', async () => {
  const { createKvTable } = await import('../src/ui/kv-table.js');
  const table = createKvTable({ rows: [row('a', 'a', '1')], secret: true });
  document.body.append(table.el);
  const tr = table.el.querySelector('tr[data-id="a"]');
  const key = tr.querySelector('[data-field="key"] input');
  key.value = 'token';
  key.dispatchEvent(new InputEvent('input', { bubbles: true }));
  const labels = () => [...tr.querySelectorAll('input[type=checkbox], button')].map((b) => b.getAttribute('aria-label'));
  expect(labels()).toEqual(['Enable token', 'Hide value of token', 'Delete token']);
  key.value = '';
  key.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect(labels()).toEqual(['Enable row 1', 'Hide value of row 1', 'Delete row 1']);
  table.el.remove();
});

it('keeps focus on the same control when a row action rebuilds the table', async () => {
  const { createKvTable } = await import('../src/ui/kv-table.js');
  const table = createKvTable({ rows: [row('a', 'a', '1'), row('b', 'b', '2', { kind: 'text' })], secret: true, files: true, onPickFile: async () => ({ name: 'f.txt' }) });
  document.body.append(table.el);
  const cell = (sel) => table.el.querySelector(`tr[data-id="b"] ${sel}`);
  cell('.kv-secret-col button').focus();
  cell('.kv-secret-col button').click();
  expect(document.activeElement).toBe(cell('.kv-secret-col button'));
  expect(document.activeElement.getAttribute('aria-pressed')).toBe('true');
  const select = cell('select');
  select.focus();
  select.value = 'file';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(document.activeElement).toBe(cell('select'));
  cell('.kv-file button').focus();
  cell('.kv-file button').click();
  await new Promise((r) => setTimeout(r));
  expect(cell('.kv-file-name').textContent).toBe('f.txt');
  expect(document.activeElement).toBe(cell('.kv-file button'));
  cell('[data-field="key"] input').focus();
  cell('[data-field="key"] input').closest('tr').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  [...document.querySelectorAll('.menu [role="menuitem"]')].find((b) => b.textContent === 'Move up').click();
  expect(table.getRows().map((r) => r.id)).toEqual(['b', 'a']);
  expect(document.activeElement).toBe(cell('[data-field="key"] input'));
  table.el.remove();
});

it('splits a pasted line at its first colon when what comes before ": " cannot be a key', () => {
  expect(parseBulk('X-Data:{"a": 1}\nfilter:name: bob\nAccept: a: b').map((r) => [r.key, r.value])).toEqual([
    ['X-Data', '{"a": 1}'],
    ['filter:name', 'bob'],
    ['Accept', 'a: b'],
  ]);
});

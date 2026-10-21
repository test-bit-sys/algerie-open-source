import { describe, it, expect } from 'vitest';
import { buildSharePayload, parseSharePayload, shareLink, parseShareHash } from '../src/lib/share.js';

const LIST = { id: 'l1', name: 'Household', icon: 'house', slot: 3 };
const TASKS = [
  {
    id: 't1', title: 'Water the plants', notes: 'Not the cactus', due: '2026-08-04',
    dueTime: null, priority: 2, repeat: { freq: 'daily', interval: 3, mode: 'due' },
    done: false, completedAt: null, subtasks: [{ id: 's1', title: 'Kitchen', done: true }],
    listId: 'l1', order: 1, createdAt: 1, updatedAt: 2,
  },
];

describe('share payload round-trip', () => {
  it('serializes and parses back the public fields', () => {
    const payload = buildSharePayload(LIST, TASKS, { owner: 'alice', updatedAt: 123 });
    const parsed = parseSharePayload(JSON.stringify(payload));
    expect(parsed.name).toBe('Household');
    expect(parsed.owner).toBe('alice');
    expect(parsed.updatedAt).toBe(123);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].title).toBe('Water the plants');
    expect(parsed.tasks[0].repeat).toEqual({ freq: 'daily', interval: 3, mode: 'due' });
    expect(parsed.tasks[0].subtasks[0]).toEqual({ id: 's1', title: 'Kitchen', done: true });
  });

  it('strips private/internal fields from the snapshot', () => {
    const payload = buildSharePayload(LIST, TASKS, { updatedAt: 1 });
    expect(payload.tasks[0].listId).toBeUndefined();
    expect(payload.tasks[0].createdAt).toBeUndefined();
    expect(payload.tasks[0].updatedAt).toBeUndefined();
    // The manual (drag) order is content — the viewer sorts by it.
    expect(payload.tasks[0].order).toBe(1);
    expect(parseSharePayload(JSON.stringify(payload)).tasks[0].order).toBe(1);
    // Legacy snapshots without one parse to a stable default.
    const legacy = JSON.parse(JSON.stringify(payload));
    delete legacy.tasks[0].order;
    expect(parseSharePayload(JSON.stringify(legacy)).tasks[0].order).toBe(0);
  });

  it('clamps a hostile slot to the real range', () => {
    const base = { kind: 'tasks.shared-list', v: 1, tasks: [] };
    expect(parseSharePayload(JSON.stringify({ ...base, slot: 9999 })).slot).toBe(8);
    expect(parseSharePayload(JSON.stringify({ ...base, slot: -3 })).slot).toBe(1);
    expect(parseSharePayload(JSON.stringify({ ...base, slot: 'junk' })).slot).toBe(1);
    expect(parseSharePayload(JSON.stringify({ ...base, slot: 4.7 })).slot).toBe(4);
  });

  it('scrubs fields the viewer would crash rendering', () => {
    const base = { kind: 'tasks.shared-list', v: 1 };
    const parsed = parseSharePayload(JSON.stringify({
      ...base,
      updatedAt: 1e21, // Invalid Date territory
      tasks: [
        { title: 'x', due: 'garbage', dueTime: '2pm' },
        { title: 'y', due: '2026-08-05', dueTime: 'zz', completedAt: 1e21, tags: [null, 42, 'ok'] },
        null, // a non-object entry must not take the parser down
        { title: 'z', due: 42 },
      ],
    }));
    expect(parsed.updatedAt).toBeNull();
    expect(parsed.tasks).toHaveLength(3);
    expect(parsed.tasks[0].due).toBeNull();
    expect(parsed.tasks[0].dueTime).toBeNull();
    expect(parsed.tasks[1].due).toBe('2026-08-05');
    expect(parsed.tasks[1].dueTime).toBeNull();
    expect(parsed.tasks[1].completedAt).toBeNull();
    expect(parsed.tasks[1].tags).toEqual(['42', 'ok']);
    expect(parsed.tasks[2].due).toBeNull();
  });

  it('rejects foreign or newer documents', () => {
    expect(() => parseSharePayload('{"kind":"other"}')).toThrow(/not a shared/i);
    expect(() => parseSharePayload(JSON.stringify({ kind: 'tasks.shared-list', v: 99, tasks: [] })))
      .toThrow(/newer app/i);
    expect(() => parseSharePayload('{}')).toThrow();
    expect(() => parseSharePayload('not json')).toThrow();
  });
});

describe('share links', () => {
  it('packs the read URL into the app hash and back', () => {
    const url = 'https://api.puter.example/read?path=%2Fshares%2Fl1.json&x=1';
    const link = shareLink(url, 'https://tasks.example/');
    expect(link.startsWith('https://tasks.example/#/shared?u=')).toBe(true);
    const hash = link.slice(link.indexOf('#'));
    expect(parseShareHash(hash)).toBe(url);
  });

  it('rejects junk and non-http URLs', () => {
    expect(parseShareHash('#/shared')).toBeNull();
    expect(parseShareHash('#/shared?u=notaurl')).toBeNull();
    expect(parseShareHash(`#/shared?u=${encodeURIComponent('javascript:alert(1)')}`)).toBeNull();
    expect(parseShareHash('')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { puterBackend, isMissing, localKv } from '../src/data/backend.js';

function fakeFs() {
  const files = new Map();
  const calls = [];
  const missing = () => Object.assign(new Error('Item does not exist'), { code: 'subject_does_not_exist' });
  return {
    files,
    calls,
    fs: {
      async write(path, data, opts) {
        calls.push(['write', path, opts]);
        files.set(path, { data, modified: 1700000000 + files.size, size: data.size });
        return { path, modified: files.get(path).modified, size: data.size };
      },
      async read(path) {
        if (!files.has(path)) throw missing();
        return files.get(path).data;
      },
      async stat(path) {
        if (!files.has(path)) throw missing();
        return { modified: files.get(path).modified, size: files.get(path).size };
      },
      async delete(path) {
        if (!files.has(path)) throw missing();
        files.delete(path);
      },
      async readdir(path) {
        const prefix = `${path}/`;
        if (![...files.keys()].some((k) => k.startsWith(prefix))) throw missing();
        return [...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ name: k.slice(prefix.length), is_dir: false, modified: files.get(k).modified }));
      },
    },
  };
}

describe('Puter storage adapter', () => {
  it('writes files under wiki/ in the app folder, replacing and creating folders', async () => {
    const f = fakeFs();
    const b = puterBackend({ fs: f.fs });
    const res = await b.write('pages/a.ywk', new Uint8Array([1, 2, 3]));
    expect(f.calls[0]).toEqual(['write', 'wiki/pages/a.ywk', { overwrite: true, dedupeName: false, createMissingParents: true }]);
    // Puter reports seconds; the adapter uses milliseconds.
    expect(res.modified).toBe(1700000000 * 1000);
    expect(res.size).toBe(3);
    const read = await b.read('pages/a.ywk');
    expect([...read.bytes]).toEqual([1, 2, 3]);
    expect((await b.stat('pages/a.ywk')).modified).toBe(1700000000 * 1000);
  });

  it('treats missing files as empty, not as errors', async () => {
    const b = puterBackend({ fs: fakeFs().fs });
    expect(await b.read('nope')).toBe(null);
    expect(await b.stat('nope')).toBe(null);
    expect(await b.list('nothing')).toEqual([]);
    await expect(b.remove('nope')).resolves.toBeUndefined();
  });

  it('passes other errors on', async () => {
    const f = fakeFs();
    f.fs.read = async () => {
      throw Object.assign(new Error('Too many requests'), { code: 'too_many_requests' });
    };
    await expect(puterBackend({ fs: f.fs }).read('x')).rejects.toThrow(/Too many/);
  });

  it('lists folders', async () => {
    const f = fakeFs();
    const b = puterBackend({ fs: f.fs });
    await b.write('history/p1/1.ywk', new Uint8Array([1]));
    await b.write('history/p1/2.ywk', new Uint8Array([2]));
    expect((await b.list('history/p1')).map((x) => x.name).sort()).toEqual(['1.ywk', '2.ywk']);
  });

  it('recognizes Puter missing-file errors', () => {
    expect(isMissing({ code: 'subject_does_not_exist' })).toBe(true);
    expect(isMissing({ status: 404 })).toBe(true);
    expect(isMissing(new Error('Item does not exist'))).toBe(true);
    expect(isMissing({ code: 'too_many_requests' })).toBe(false);
  });

  it('keeps sandbox settings in localStorage', async () => {
    const kv = localKv('test:');
    await kv.set('a', { b: 1 });
    expect(await kv.get('a')).toEqual({ b: 1 });
    expect(await kv.get('missing')).toBe(null);
  });
});

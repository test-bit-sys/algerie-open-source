import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker({ offline = false } = {}) {
  const shell = new Response('app shell');
  const article = new Response('saved article');
  const entries = new Map([['./', shell], ['https://inventory.example/docs/getting-started/', article]]);
  const cache = {
    match: vi.fn(async key => entries.get(typeof key === 'string' ? key : key.url)),
    put: vi.fn(async (key, response) => entries.set(typeof key === 'string' ? key : key.url, response)),
  };
  const fetch = vi.fn(async () => { if (offline) throw new Error('offline'); return new Response('fresh page'); });
  const sandbox = { URL, Response, setTimeout: () => 0, fetch, caches: { open: async () => cache }, self: { location: new URL('https://inventory.example/sw.js'), addEventListener() {} } };
  runInNewContext(source, sandbox);
  const navigate = url => sandbox.networkFirst({ request: { url }, waitUntil() {} });
  return { navigate, cache, shell, article };
}
describe('offline public page navigation', () => {
  it('returns the saved article rather than the app shell', async () => {
    const w = worker({ offline: true });
    expect(await w.navigate('https://inventory.example/docs/getting-started/')).toBe(w.article);
  });
  it('does not turn an uncached article into the application', async () => {
    const w = worker({ offline: true });
    expect((await w.navigate('https://inventory.example/docs/stocktakes/')).type).toBe('error');
    expect(await w.navigate('https://inventory.example/')).toBe(w.shell);
  });
  it('caches public documents separately without overwriting the app shell', async () => {
    const w = worker();
    await w.navigate('https://inventory.example/docs/stocktakes/');
    expect(w.cache.put.mock.calls[0][0].url).toBe('https://inventory.example/docs/stocktakes/');
    expect(await w.cache.match('./')).toBe(w.shell);
  });
});

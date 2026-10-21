import { describe, it, expect, beforeEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createStore } from '../src/js/store.js';
import {
  createRsvpLinks,
  computeExpiresAt,
  workerNameCandidates,
  RSVP_WORKER_VERSION,
} from '../src/js/rsvp-links.js';
import { makeKv, makeFakePuter, bridgeFetch } from './helpers/worker-harness.js';

// The module (and the worker it deploys) use WebCrypto; jsdom doesn't ship it.
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const HOUR = 3_600_000;
const HOST = { email: 'host@example.com' };

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

async function settle(rsvp) {
  // Let the debounced (0ms) schedule fire, then drain the network chain —
  // twice, since a pass can queue follow-up work.
  for (let i = 0; i < 3; i++) {
    await tick();
    await rsvp.whenIdle();
  }
}

function makeWorld({ user = HOST, moduleOpts = {} } = {}) {
  const kv = makeKv();
  const store = createStore(kv);
  const fakePuter = makeFakePuter();
  const rsvp = createRsvpLinks({
    kv,
    store,
    user,
    getPuter: () => fakePuter,
    fetchFn: bridgeFetch(fakePuter),
    blocked: () => false,
    requestUser: async () => user,
    syncDelayMs: 0,
    ...moduleOpts,
  });
  return { kv, store, fakePuter, rsvp };
}

async function hostEvent(store, overrides = {}) {
  const start = Date.now() + 24 * HOUR;
  return store.saveEvent({
    title: 'Dinner',
    start,
    end: start + 2 * HOUR,
    organizer: { email: HOST.email },
    guests: [
      { email: HOST.email, status: 'accepted' },
      { email: 'ada@example.com', status: 'needs-action' },
    ],
    ...overrides,
  });
}

describe('rsvp-links: deploy + link issuing', () => {
  let world;
  beforeEach(async () => {
    world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
  });

  it('deploys the worker on first hosted event and issues links for guests only', async () => {
    expect(world.fakePuter.workers.create).not.toHaveBeenCalled();
    const ev = await hostEvent(world.store);
    await settle(world.rsvp);

    expect(world.fakePuter.workers.create).toHaveBeenCalledTimes(1);
    const links = world.rsvp.linksFor(ev.id);
    expect(Object.keys(links)).toEqual(['ada@example.com']); // never the host
    expect(links['ada@example.com']).toMatch(/^https:\/\/cal-rsvp-[0-9a-f]{10}\.puter\.work\/rsvp\/[0-9a-f]{40}$/);

    // The deployed source carries only the secret's hash, never the secret.
    const cfg = world.kv.map.get('cal:rsvp:cfg');
    expect(cfg.secret).toMatch(/^[0-9a-f]{64}$/);
    for (const content of world.fakePuter.files.values()) {
      expect(content).not.toContain(cfg.secret);
    }
  });

  it('does not deploy anything for guestless events, tasks, or invites to me', async () => {
    const start = Date.now() + HOUR;
    await world.store.saveEvent({ title: 'Solo', start, end: start + HOUR });
    await world.store.saveEvent({
      title: 'Their party',
      start,
      end: start + HOUR,
      organizer: { email: 'someone-else@example.com' },
      guests: [{ email: HOST.email, status: 'needs-action' }, { email: 'x@example.com', status: 'needs-action' }],
    });
    await settle(world.rsvp);
    expect(world.fakePuter.workers.create).not.toHaveBeenCalled();
  });

  it('upgrades an outdated worker in place — same URL, links survive, API appears', async () => {
    const ev = await hostEvent(world.store);
    await settle(world.rsvp);
    const link = world.rsvp.linksFor(ev.id)['ada@example.com'];

    // Pretend the deployment is from an older app version.
    const cfg = world.kv.map.get('cal:rsvp:cfg');
    world.kv.map.set('cal:rsvp:cfg', { ...cfg, version: '0' });

    const writesBefore = world.fakePuter.fs.write.mock.calls.length;
    const upgraded = createRsvpLinks({
      kv: world.kv,
      store: world.store,
      user: HOST,
      getPuter: () => world.fakePuter,
      fetchFn: bridgeFetch(world.fakePuter),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
    });
    await upgraded.start();
    await upgraded.refreshEvent(ev.id);
    await settle(upgraded);

    // Rewrote the source, no new worker, cfg re-stamped.
    expect(world.fakePuter.fs.write.mock.calls.length).toBeGreaterThan(writesBefore);
    expect(world.fakePuter.workers.create).toHaveBeenCalledTimes(1);
    expect(world.kv.map.get('cal:rsvp:cfg').version).toBe(RSVP_WORKER_VERSION);

    // The already-sent link still answers — the human link now redirects to
    // the app page, and the API resolves the same token.
    const u = new URL(link);
    const worker = world.fakePuter.workersByUrl.get(u.origin);
    expect((await worker.instance.call('GET', u.pathname)).status).toBe(303);
    const api = await worker.instance.call('GET', `/api${u.pathname}`);
    expect(api.status).toBe(200);
    expect((await api.json()).guest.email).toBe('ada@example.com');
  });

  it('reuses the existing worker across sessions (no second deploy)', async () => {
    const ev = await hostEvent(world.store);
    await settle(world.rsvp);

    // "New session": fresh module over the same kv/store.
    const again = createRsvpLinks({
      kv: world.kv,
      store: world.store,
      user: HOST,
      getPuter: () => world.fakePuter,
      fetchFn: bridgeFetch(world.fakePuter),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
    });
    await again.start();
    await settle(again);
    expect(world.fakePuter.workers.create).toHaveBeenCalledTimes(1);
    // Links restored from the host's KV cache.
    expect(again.linksFor(ev.id)['ada@example.com']).toBe(
      world.rsvp.linksFor(ev.id)['ada@example.com'],
    );
  });
});

describe('rsvp-links: guest answers round-trip', () => {
  let world;
  let ev;
  beforeEach(async () => {
    world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    ev = await hostEvent(world.store);
    await settle(world.rsvp);
  });

  function guestPost(url, body) {
    const u = new URL(url);
    const worker = world.fakePuter.workersByUrl.get(u.origin);
    return worker.instance.call('POST', `/api${u.pathname}`, { json: body });
  }

  it('a no-change refresh stays silent — no onUpdate, no card flicker (regression)', async () => {
    const spy = vi.fn();
    world.rsvp.onUpdate(spy);
    await world.rsvp.refreshEvent(ev.id); // what opening the details card does
    await settle(world.rsvp);
    expect(spy).not.toHaveBeenCalled();
  });

  it("merges a guest's response into the event (with their note)", async () => {
    const link = world.rsvp.linksFor(ev.id)['ada@example.com'];
    expect(
      (await guestPost(link, { status: 'tentative', comment: 'maybe late' })).status,
    ).toBe(200);

    await world.rsvp.refreshEvent(ev.id);
    await settle(world.rsvp);

    const guest = world.store.getEvent(ev.id).guests.find((g) => g.email === 'ada@example.com');
    expect(guest.status).toBe('tentative');
    expect(guest.comment).toBe('maybe late');
    expect(guest.rsvpAt).toBeGreaterThan(0);
  });

  it("pulls a guest's answer on its own while the calendar sits open (no edit, no card)", async () => {
    // Guests answer from their inbox; nothing in the app announces it, so the
    // periodic pull is the only way an open calendar ever learns of it.
    const polled = makeWorld({ moduleOpts: { pollMs: 25, pullMinMs: 0 } });
    await polled.store.load();
    await polled.rsvp.start();
    const dinner = await hostEvent(polled.store);
    await settle(polled.rsvp);
    const link = polled.rsvp.linksFor(dinner.id)['ada@example.com'];
    const u = new URL(link);
    const worker = polled.fakePuter.workersByUrl.get(u.origin);
    expect((await worker.instance.call('POST', `/api${u.pathname}`, { json: { status: 'accepted' } })).status).toBe(200);

    await new Promise((r) => setTimeout(r, 150)); // a few polls, no store change, no refreshEvent
    await settle(polled.rsvp);
    const guest = polled.store.getEvent(dinner.id).guests.find((g) => g.email === 'ada@example.com');
    expect(guest.status).toBe('accepted');
    polled.rsvp.stop();
  });

  it('a re-pull of the same response is a no-op (no save churn)', async () => {
    const link = world.rsvp.linksFor(ev.id)['ada@example.com'];
    await guestPost(link, { status: 'accepted' });
    await world.rsvp.refreshEvent(ev.id);
    await settle(world.rsvp);

    const before = world.store.getEvent(ev.id).updatedAt;
    const applied = await world.store.applyRsvpResponses(ev.id, [
      {
        email: 'ada@example.com',
        status: 'accepted',
        respondedAt: world.store.getEvent(ev.id).guests.find((g) => g.email === 'ada@example.com')
          .rsvpAt,
      },
    ]);
    expect(applied).toBeNull();
    expect(world.store.getEvent(ev.id).updatedAt).toBe(before);
  });

  it('removing a guest revokes their link; deleting the event revokes all', async () => {
    const link = world.rsvp.linksFor(ev.id)['ada@example.com'];
    const u = new URL(link);
    const worker = world.fakePuter.workersByUrl.get(u.origin);

    await world.store.saveEvent({
      ...world.store.getEvent(ev.id),
      guests: [{ email: HOST.email, status: 'accepted' }, { email: 'new@example.com', status: 'needs-action' }],
    });
    await settle(world.rsvp);
    expect((await worker.instance.call('GET', `/api${u.pathname}`)).status).toBe(404);
    expect(world.rsvp.linksFor(ev.id)['new@example.com']).toBeTruthy();

    await world.store.deleteEvent(ev.id);
    await settle(world.rsvp);
    expect(world.rsvp.linksFor(ev.id)).toBeNull();
    expect(worker.instance.kv.map.has(`rsvpw:evt:${ev.id}`)).toBe(false);
  });

  it('pushes detail edits (new time) to the worker snapshot', async () => {
    const moved = ev.start + 24 * HOUR;
    await world.store.saveEvent({ ...world.store.getEvent(ev.id), start: moved, end: moved + HOUR });
    await settle(world.rsvp);
    const u = new URL(world.rsvp.linksFor(ev.id)['ada@example.com']);
    const worker = world.fakePuter.workersByUrl.get(u.origin);
    const record = worker.instance.kv.map.get(`rsvpw:evt:${ev.id}`);
    expect(record.snapshot.start).toBe(moved);
  });

  it('attaching a meeting link re-syncs, and the guest API serves a Join URL', async () => {
    const join = 'https://meetings.puter.com/#/m/abcd-efgh-ijkl';
    // The link is IN the digest: attaching it alone must dirty the event.
    await world.store.saveEvent({ ...world.store.getEvent(ev.id), meeting: { url: join } });
    await settle(world.rsvp);
    const u = new URL(world.rsvp.linksFor(ev.id)['ada@example.com']);
    const worker = world.fakePuter.workersByUrl.get(u.origin);
    expect(worker.instance.kv.map.get(`rsvpw:evt:${ev.id}`).snapshot.meetingUrl).toBe(join);
    const data = await (await worker.instance.call('GET', `/api${u.pathname}`)).json();
    expect(data.event.meetingUrl).toBe(join);
  });
});

describe('rsvp-links: verified deploys', () => {
  it('a deploy that comes up on the wrong version is never stamped, and a later session heals it (regression)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const template = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/workers/rsvp-worker.js'),
      'utf8',
    );
    // Simulate the broken-deploy class of failure (e.g. a stale-module build):
    // the deployed worker reports a version that is NOT the current one.
    const brokenSource = template.replace('__RSVP_WORKER_VERSION__', 'stale');

    const world = makeWorld({
      moduleOpts: { source: brokenSource, verifyAttempts: 2, verifyDelayMs: 1 },
    });
    await world.store.load();
    await world.rsvp.start();
    const ev = await hostEvent(world.store);
    await settle(world.rsvp);

    // The worker deployed, but verification failed: version must NOT be
    // stamped (that would freeze the broken source in place forever).
    const cfg = world.kv.map.get('cal:rsvp:cfg');
    expect(cfg).toBeTruthy();
    expect(cfg.version).not.toBe(RSVP_WORKER_VERSION);
    expect(world.rsvp.linksFor(ev.id)).toBeNull(); // sync never completed

    // A later session with the healthy source repairs the SAME worker in
    // place — no second deploy, links finally mint.
    const healed = createRsvpLinks({
      kv: world.kv,
      store: world.store,
      user: HOST,
      getPuter: () => world.fakePuter,
      fetchFn: bridgeFetch(world.fakePuter),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
    });
    await healed.start();
    await settle(healed);

    expect(world.fakePuter.workers.create).toHaveBeenCalledTimes(1);
    expect(world.kv.map.get('cal:rsvp:cfg').version).toBe(RSVP_WORKER_VERSION);
    expect(world.kv.map.get('cal:rsvp:cfg').name).toBe(cfg.name);
    expect(healed.linksFor(ev.id)['ada@example.com']).toMatch(/\/rsvp\/[0-9a-f]{40}$/);
  });
});

describe('rsvp-links: a request that never answers', () => {
  it('fails its pass on a deadline instead of wedging the queue forever', async () => {
    // `fetch` has no timeout of its own, and every admin call runs on the queue
    // that serializes the whole sync pass — here and in booking.js. A request
    // that neither answers nor errors used to leave that queue pending for the
    // rest of the session: no later pass, no pulled bookings, nothing short of
    // restarting the app. So the request must carry a deadline, and the pass
    // after it must still run.
    const fakePuter = makeFakePuter();
    const live = bridgeFetch(fakePuter);
    let stall = false;
    const fetchFn = vi.fn((url, init = {}) => {
      if (!stall) return live(url, init);
      // Settles only when aborted — the shape of a black-holed connection. With
      // no deadline this promise is never settled at all, so `settle()` below
      // never returns and the test times out: that timeout IS the regression.
      return new Promise((_resolve, reject) => {
        if (init.signal) init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const kv = makeKv();
    const store = createStore(kv);
    const rsvp = createRsvpLinks({
      kv,
      store,
      user: HOST,
      getPuter: () => fakePuter,
      fetchFn,
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
      adminTimeoutMs: 20,
    });
    await store.load();
    await rsvp.start();
    const first = await hostEvent(store);
    await settle(rsvp);
    expect(rsvp.linksFor(first.id)).toBeTruthy(); // the worker is up and live

    stall = true;
    const stalled = await hostEvent(store, { title: 'Stalled' });
    await settle(rsvp);
    expect(rsvp.linksFor(stalled.id)).toBeNull(); // that pass could not land
    expect(fetchFn.mock.calls.some(([, init]) => init && init.signal)).toBe(true);

    // The queue is still usable: the next pass runs and mints its links.
    stall = false;
    await store.saveEvent({ ...stalled, title: 'Retried' });
    await settle(rsvp);
    expect(rsvp.linksFor(stalled.id)['ada@example.com']).toMatch(/\/rsvp\/[0-9a-f]{40}$/);
  });
});

describe('rsvp-links: destructive-action guards', () => {
  it("an identity-unknown boot never revokes links for organizer-stamped events (regression)", async () => {
    // Session 1: host with a known email creates the event and links.
    const world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    const ev = await hostEvent(world.store);
    await settle(world.rsvp);
    const link = world.rsvp.linksFor(ev.id)['ada@example.com'];
    const u = new URL(link);
    const worker = world.fakePuter.workersByUrl.get(u.origin);

    // Session 2: same data, but the email grant is gone — getUser() has no
    // email, so isHosted() fails for every organizer-stamped event. That must
    // NOT read as "deleted": no revoke, no data loss.
    const blindRsvp = createRsvpLinks({
      kv: world.kv,
      store: world.store,
      user: null,
      getPuter: () => world.fakePuter,
      fetchFn: bridgeFetch(world.fakePuter),
      blocked: () => false,
      requestUser: async () => null,
      syncDelayMs: 0,
    });
    await blindRsvp.start();
    await settle(blindRsvp);

    expect((await worker.instance.call('GET', `/api${u.pathname}`)).status).toBe(200);
    expect(world.kv.map.has(`cal:rsvp:links:${ev.id}`)).toBe(true);
  });

  it('a FAILED links point-read aborts the sync instead of reissuing (regression)', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    const ev = await hostEvent(world.store);
    await settle(world.rsvp);
    const link = world.rsvp.linksFor(ev.id)['ada@example.com'];

    // Second session: the links list AND the point-read both fail (429 burst)
    // — "couldn't read" must never be treated as "nothing stored".
    const realGet = world.kv.get.getMockImplementation();
    const realList = world.kv.list.getMockImplementation();
    world.kv.list.mockImplementation(async (pattern, values) =>
      String(pattern).startsWith('cal:rsvp:links:') ? [] : realList(pattern, values),
    );
    world.kv.get.mockImplementation(async (key) => {
      if (String(key).startsWith('cal:rsvp:links:')) throw new Error('too_many_requests');
      return realGet(key);
    });
    const second = createRsvpLinks({
      kv: world.kv,
      store: world.store,
      user: HOST,
      getPuter: () => world.fakePuter,
      fetchFn: bridgeFetch(world.fakePuter),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
    });
    await second.start();
    await settle(second);

    // The old link must still answer — no reissue happened.
    const u = new URL(link);
    const worker = world.fakePuter.workersByUrl.get(u.origin);
    expect((await worker.instance.call('GET', `/api${u.pathname}`)).status).toBe(200);

    // Reads recover → the same link is adopted, still no reissue.
    world.kv.get.mockImplementation(realGet);
    await world.store.saveEvent({ ...world.store.getEvent(ev.id), title: 'Dinner (edited)' });
    await settle(second);
    expect(second.linksFor(ev.id)['ada@example.com']).toBe(link);
  });

  it('on divergence the STORED links win over stale in-memory ones (regression)', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    const ev = await hostEvent(world.store);
    await settle(world.rsvp);
    const stale = world.rsvp.linksFor(ev.id)['ada@example.com'];

    // "Another device" reissues ada's link: worker + stored KV now hold a new
    // token; this session's in-memory cache still has the old URL.
    const u = new URL(stale);
    const worker = world.fakePuter.workersByUrl.get(u.origin);
    const cfg = world.kv.map.get('cal:rsvp:cfg');
    const resync = await worker.instance.call('POST', '/admin/sync', {
      headers: { authorization: `Bearer ${cfg.secret}` },
      json: {
        event: { id: ev.id, title: ev.title, start: ev.start, end: ev.end },
        guests: [{ email: 'ada@example.com' }],
        reissue: ['ada@example.com'],
      },
    });
    const freshToken = (await resync.json()).links['ada@example.com'];
    const freshUrl = `${u.origin}/rsvp/${freshToken}`;
    const storedKey = `cal:rsvp:links:${ev.id}`;
    const storedVal = world.kv.map.get(storedKey);
    world.kv.map.set(storedKey, {
      ...storedVal,
      links: { ...storedVal.links, 'ada@example.com': freshUrl },
    });

    // This session edits the event → sync → the stored (live) link must win
    // and must not be clobbered by the stale in-memory copy.
    await world.store.saveEvent({ ...world.store.getEvent(ev.id), title: 'Dinner (moved)' });
    await settle(world.rsvp);
    expect(world.rsvp.linksFor(ev.id)['ada@example.com']).toBe(freshUrl);
    expect(world.kv.map.get(storedKey).links['ada@example.com']).toBe(freshUrl);
  });

  it('a lossy links-cache load never reissues links that are still in KV (regression)', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.rsvp.start();
    const ev = await hostEvent(world.store);
    await settle(world.rsvp);
    const link = world.rsvp.linksFor(ev.id)['ada@example.com'];

    // Session 2 boots with a truncated kv.list: the links key exists but the
    // flat listing "loses" it. The point-read in syncEvent must recover the
    // stored link instead of minting a replacement (which would kill the one
    // already sent to the guest).
    const realList = world.kv.list.getMockImplementation();
    world.kv.list.mockImplementation(async (pattern, values) =>
      String(pattern).startsWith('cal:rsvp:links:') ? [] : realList(pattern, values),
    );
    const second = createRsvpLinks({
      kv: world.kv,
      store: world.store,
      user: HOST,
      getPuter: () => world.fakePuter,
      fetchFn: bridgeFetch(world.fakePuter),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
    });
    await second.start();
    await settle(second);

    expect(second.linksFor(ev.id)['ada@example.com']).toBe(link);
    const u = new URL(link);
    const worker = world.fakePuter.workersByUrl.get(u.origin);
    expect((await worker.instance.call('GET', `/api${u.pathname}`)).status).toBe(200);
  });
});

describe('rsvp-links: offline safety', () => {
  it('makes no network calls and never deploys while blocked', async () => {
    const kv = makeKv();
    const store = createStore(kv);
    await store.load();
    const fakePuter = makeFakePuter();
    const rsvp = createRsvpLinks({
      kv,
      store,
      user: HOST,
      getPuter: () => fakePuter,
      fetchFn: bridgeFetch(fakePuter),
      blocked: () => true, // offline
      requestUser: async () => HOST,
      syncDelayMs: 0,
    });
    await rsvp.start();
    await hostEvent(store);
    await settle(rsvp);
    expect(fakePuter.workers.create).not.toHaveBeenCalled();
    expect(fakePuter.fs.write).not.toHaveBeenCalled();
  });
});

describe('computeExpiresAt', () => {
  const start = new Date(2026, 6, 6, 18).getTime(); // Mon Jul 6 2026, 6pm
  it('plain event: its end', () => {
    expect(computeExpiresAt({ start, end: start + HOUR })).toBe(start + HOUR);
  });
  it('until-bound series: the last occurrence end', () => {
    const until = new Date(2026, 7, 31, 23, 59, 59, 999).getTime();
    expect(
      computeExpiresAt({ start, end: start + HOUR, recurrence: { freq: 'weekly', interval: 1, byWeekday: [1], until } }),
    ).toBe(new Date(2026, 7, 31, 19).getTime()); // Mon Aug 31, 6–7pm
  });
  it('count-bound series: last occurrence end', () => {
    const out = computeExpiresAt({
      start,
      end: start + HOUR,
      recurrence: { freq: 'daily', interval: 1, count: 5 },
    });
    expect(out).toBe(start + 4 * 86_400_000 + HOUR);
  });
  it('an occurrence moved past the series end keeps links alive until IT ends', () => {
    const day = 86_400_000;
    const moved = start + 40 * day;
    const out = computeExpiresAt({
      start,
      end: start + HOUR,
      recurrence: { freq: 'daily', interval: 1, count: 5 },
      exdates: [],
      overrides: { [start + 2 * day]: { start: moved, end: moved + HOUR } },
    });
    expect(out).toBe(moved + HOUR);
  });
  it('endless series: null (never expires)', () => {
    expect(
      computeExpiresAt({ start, end: start + HOUR, recurrence: { freq: 'daily', interval: 1 } }),
    ).toBeNull();
  });
  it('version constant is wired', () => {
    expect(RSVP_WORKER_VERSION).toBeTruthy();
  });
});

describe('rsvp-links: guest suggestions round-trip', () => {
  let world;
  let ev;
  let toastSpy;

  beforeEach(async () => {
    toastSpy = vi.fn();
    world = makeWorld({ moduleOpts: { toast: toastSpy } });
    await world.store.load();
    await world.rsvp.start();
    ev = await hostEvent(world.store);
    await settle(world.rsvp);
  });

  /** A guest proposes an addition through the real (bridged) worker API. */
  function guestSuggest(link, fields) {
    const u = new URL(link);
    const worker = world.fakePuter.workersByUrl.get(u.origin);
    return worker.instance.call('POST', `/api${u.pathname}/guests`, { json: fields });
  }

  function adminSuggestions() {
    const origin = world.rsvp.workerOrigin();
    const worker = world.fakePuter.workersByUrl.get(origin);
    const secret = world.kv.map.get('cal:rsvp:cfg').secret;
    return worker.instance
      .call('GET', '/admin/responses', { headers: { authorization: `Bearer ${secret}` } })
      .then((res) => res.json())
      .then((data) => data.events[ev.id].suggestions);
  }

  it('a suggestion reaches the host: suggestionsFor, onUpdate, and one toast', async () => {
    const spy = vi.fn();
    world.rsvp.onUpdate(spy);
    const link = world.rsvp.linksFor(ev.id)['ada@example.com'];
    expect(
      (await guestSuggest(link, { email: 'sara@example.com', name: 'Sara' })).status,
    ).toBe(200);

    await world.rsvp.refreshEvent(ev.id); // what opening the details card does
    await settle(world.rsvp);

    const pending = world.rsvp.suggestionsFor(ev.id);
    expect(pending.length).toBe(1);
    expect(pending[0]).toMatchObject({
      email: 'sara@example.com',
      name: 'Sara',
      by: 'ada@example.com',
    });
    expect(spy).toHaveBeenCalledWith(ev.id);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0][0]).toContain('ada@example.com suggested adding sara@example.com');
  });

  it('a suggestion already announced never re-toasts — not even after a reload', async () => {
    const link = world.rsvp.linksFor(ev.id)['ada@example.com'];
    await guestSuggest(link, { email: 'sara@example.com' });
    await world.rsvp.refreshEvent(ev.id);
    await settle(world.rsvp);
    expect(toastSpy).toHaveBeenCalledTimes(1);

    // Same account boots again: seen-stamps came back from KV, so the pull
    // that re-delivers the (still pending) suggestion stays quiet.
    const rebootToast = vi.fn();
    const reboot = createRsvpLinks({
      kv: world.kv,
      store: world.store,
      user: HOST,
      getPuter: () => world.fakePuter,
      fetchFn: bridgeFetch(world.fakePuter),
      blocked: () => false,
      requestUser: async () => HOST,
      toast: rebootToast,
      syncDelayMs: 0,
    });
    await reboot.start();
    await settle(reboot);
    expect(reboot.suggestionsFor(ev.id).length).toBe(1); // still pending, still shown
    expect(rebootToast).not.toHaveBeenCalled(); // but not re-announced
  });

  it('dismissing settles the suggestion on the worker — it cannot resurrect', async () => {
    const link = world.rsvp.linksFor(ev.id)['ada@example.com'];
    await guestSuggest(link, { email: 'sara@example.com' });
    await world.rsvp.refreshEvent(ev.id);
    await settle(world.rsvp);

    await world.rsvp.dismissSuggestion(ev.id, 'sara@example.com');
    expect(world.rsvp.suggestionsFor(ev.id)).toEqual([]);
    expect(await adminSuggestions()).toEqual([]);
  });

  it("approval is just adding the guest: suggestion settles, link mints, card row's gone at once", async () => {
    const link = world.rsvp.linksFor(ev.id)['ada@example.com'];
    await guestSuggest(link, { email: 'sara@example.com', name: 'Sara' });
    await world.rsvp.refreshEvent(ev.id);
    await settle(world.rsvp);
    expect(world.rsvp.suggestionsFor(ev.id).length).toBe(1);

    // What the details card's Approve does: put them on the guest list.
    const current = world.store.getEvent(ev.id);
    await world.store.saveEvent({
      ...current,
      guests: [...current.guests, { email: 'sara@example.com', name: 'Sara', status: 'needs-action' }],
    });
    // The row disappears immediately — before any network round-trip.
    expect(world.rsvp.suggestionsFor(ev.id)).toEqual([]);

    await settle(world.rsvp);
    expect(await adminSuggestions()).toEqual([]); // worker settled it on sync
    expect(world.rsvp.linksFor(ev.id)['sara@example.com']).toMatch(/\/rsvp\/[0-9a-f]{40}$/);
  });

  it('a stale sync response cannot resurrect a just-dismissed suggestion (tombstone)', async () => {
    const link = world.rsvp.linksFor(ev.id)['ada@example.com'];
    await guestSuggest(link, { email: 'sara@example.com' });
    await world.rsvp.refreshEvent(ev.id);
    await settle(world.rsvp);
    await world.rsvp.dismissSuggestion(ev.id, 'sara@example.com');

    // Simulate the response of a pull that left BEFORE the dismissal landed:
    // put the entry back on the worker, then force a fresh sync to deliver it.
    const origin = world.rsvp.workerOrigin();
    const workerKv = world.fakePuter.workersByUrl.get(origin).instance.kv;
    workerKv.map.set(`rsvpw:sug:${ev.id}:sara@example.com`, {
      email: 'sara@example.com',
      name: '',
      by: 'ada@example.com',
      at: Date.now() - 1000,
    });
    await world.store.saveEvent({ ...world.store.getEvent(ev.id), title: 'Dinner (moved)' });
    await settle(world.rsvp);

    expect(world.rsvp.suggestionsFor(ev.id)).toEqual([]); // tombstone holds
  });

  it('a seen-map that could not be read is never overwritten (and announcing still works)', async () => {
    const kv = makeKv();
    // The seen key alone is unreadable; everything else (cfg, links) works.
    const failingKv = {
      ...kv,
      get: (k) =>
        k === 'cal:rsvp:suggestions-seen' ? Promise.reject(new Error('boom')) : kv.get(k),
    };
    kv.map.set('cal:rsvp:suggestions-seen', { 'old-event:x@example.com': 123 }); // prior stamps
    const store = createStore(failingKv);
    const fakePuter = makeFakePuter();
    const toastSpy2 = vi.fn();
    const rsvp = createRsvpLinks({
      kv: failingKv,
      store,
      user: HOST,
      getPuter: () => fakePuter,
      fetchFn: bridgeFetch(fakePuter),
      blocked: () => false,
      requestUser: async () => HOST,
      toast: toastSpy2,
      syncDelayMs: 0,
    });
    await store.load();
    await rsvp.start();
    const hosted = await hostEvent(store);
    await settle(rsvp);

    const link = rsvp.linksFor(hosted.id)['ada@example.com'];
    const u = new URL(link);
    await fakePuter.workersByUrl
      .get(u.origin)
      .instance.call('POST', `/api${u.pathname}/guests`, { json: { email: 'sara@example.com' } });
    await rsvp.refreshEvent(hosted.id);
    await settle(rsvp);

    expect(toastSpy2).toHaveBeenCalledTimes(1); // a repeat toast beats a silent one
    // …but the stored map was never clobbered by this blind session.
    expect(kv.map.get('cal:rsvp:suggestions-seen')).toEqual({ 'old-event:x@example.com': 123 });
  });

  it('dismissing while offline throws instead of pretending (a local-only dismiss resurrects)', async () => {
    let offline = false;
    const blockedWorld = makeWorld({ moduleOpts: { blocked: () => offline } });
    await blockedWorld.store.load();
    await blockedWorld.rsvp.start();
    const blockedEv = await hostEvent(blockedWorld.store);
    await settle(blockedWorld.rsvp);
    offline = true;
    await expect(
      blockedWorld.rsvp.dismissSuggestion(blockedEv.id, 'x@example.com'),
    ).rejects.toThrow(/offline/);
  });
});

/* ---- Worker naming -------------------------------------------------------- */

describe('rsvp-links: the worker is named for its host', () => {
  it('leads with the username and keeps a random name in reserve', () => {
    const [first, second, last] = workerNameCandidates('nariman');
    expect(first).toBe('cal-nariman');
    expect(second).toMatch(/^cal-nariman-[0-9a-f]{4}$/);
    expect(last).toMatch(/^cal-rsvp-[0-9a-f]{10}$/);
  });

  it('makes a subdomain label out of whatever the username is', () => {
    expect(workerNameCandidates('Ada_Lovelace')[0]).toBe('cal-ada-lovelace');
    expect(workerNameCandidates('--nj--')[0]).toBe('cal-nj');
    expect(workerNameCandidates('a'.repeat(40))[0]).toBe('cal-' + 'a'.repeat(24));
  });

  it('offers only the random name when the username gives nothing to use', () => {
    // No Latin letters or digits at all, one character, absent entirely.
    for (const name of ['Кофе', 'x', '', null, undefined]) {
      const names = workerNameCandidates(name);
      expect(names).toHaveLength(1);
      expect(names[0]).toMatch(/^cal-rsvp-[0-9a-f]{10}$/);
    }
  });

  it('announces the worker as soon as the stored config is read', async () => {
    // The booking sidebar's copy buttons are gated on workerOrigin(); nothing
    // else fires between the boot read and the next sync round trip, so
    // without this they sit on "Preparing your link…" long after the link works.
    const world = makeWorld({ user: { ...HOST, username: 'nariman' } });
    world.kv.map.set('cal:rsvp:cfg', {
      name: 'cal-nariman',
      url: 'https://cal-nariman.puter.work',
      secret: 's3cret',
      version: RSVP_WORKER_VERSION,
    });
    const seen = [];
    world.rsvp.onUpdate((eventId) => seen.push({ eventId, origin: world.rsvp.workerOrigin() }));
    await world.store.load();
    await world.rsvp.start();
    expect(seen).toEqual([{ eventId: undefined, origin: 'https://cal-nariman.puter.work' }]);
  });

  it('announces the worker the moment a version upgrade verifies', async () => {
    // Same reason, on the slow path: after an app update the deployed worker
    // predates the booking routes, so the copy buttons genuinely have to wait
    // — but only until the redeploy verifies, not until the sync POST that
    // happens to follow it.
    const world = makeWorld({ user: { ...HOST, username: 'nariman' } });
    await world.store.load();
    await world.rsvp.start();
    await hostEvent(world.store);
    await settle(world.rsvp); // deploys the worker for real

    const cfg = world.kv.map.get('cal:rsvp:cfg');
    world.kv.map.set('cal:rsvp:cfg', { ...cfg, version: '6' }); // predates /book/
    const rebooted = createRsvpLinks({
      kv: world.kv,
      store: world.store,
      user: { ...HOST, username: 'nariman' },
      getPuter: () => world.fakePuter,
      fetchFn: bridgeFetch(world.fakePuter),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
    });
    const seen = [];
    rebooted.onUpdate(() => seen.push(rebooted.workerOrigin()));
    await rebooted.start();
    expect(seen).toEqual([]); // an unserveable worker announces nothing
    expect(rebooted.workerOrigin()).toBe(null);

    await rebooted.refreshEvent(world.store.getAllEvents()[0].id);
    await settle(rebooted);
    expect(seen[0]).toBe('https://cal-nariman.puter.work');
  });

  it('deploys under the host name', async () => {
    const world = makeWorld({ user: { ...HOST, username: 'nariman' } });
    await world.store.load();
    await world.rsvp.start();
    await hostEvent(world.store);
    await settle(world.rsvp);
    expect(world.fakePuter.created).toEqual(['cal-nariman']);
    expect(world.rsvp.workerOrigin()).toBe('https://cal-nariman.puter.work');
  });

  it('does not lose the host name to a one-off create failure', async () => {
    // A worker can never be renamed, so reading a blip as "taken" would cost
    // this host `cal-nariman` permanently. The first name gets a second go.
    const world = makeWorld({ user: { ...HOST, username: 'nariman' }, moduleOpts: { createRetryMs: 0 } });
    const create = world.fakePuter.workers.create;
    const real = create.getMockImplementation();
    let failed = false;
    create.mockImplementation(async (name, filePath) => {
      if (!failed) {
        failed = true;
        throw new Error('transient');
      }
      return real(name, filePath);
    });
    await world.store.load();
    await world.rsvp.start();
    await hostEvent(world.store);
    await settle(world.rsvp);
    expect(world.rsvp.workerOrigin()).toBe('https://cal-nariman.puter.work');
  });

  it('falls past a name someone else already holds rather than failing the deploy', async () => {
    const world = makeWorld({ user: { ...HOST, username: 'nariman' }, moduleOpts: { createRetryMs: 0 } });
    const create = world.fakePuter.workers.create;
    const real = create.getMockImplementation();
    // Puter rejects a taken name; only the first candidate is taken here.
    create.mockImplementation(async (name, filePath) => {
      if (name === 'cal-nariman') throw new Error('name already in use');
      return real(name, filePath);
    });
    await world.store.load();
    await world.rsvp.start();
    await hostEvent(world.store);
    await settle(world.rsvp);
    expect(world.rsvp.workerOrigin()).toMatch(/^https:\/\/cal-nariman-[0-9a-f]{4}\.puter\.work$/);
  });
});

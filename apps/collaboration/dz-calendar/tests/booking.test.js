import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createStore } from '../src/js/store.js';
import { createRsvpLinks, RSVP_WORKER_VERSION } from '../src/js/rsvp-links.js';
import {
  createBooking,
  normalizePage,
  normalizeHours,
  defaultHours,
  computeBusy,
  slugifyPageId,
  defaultPageOrigin,
  normalizeDisplayName,
  DISPLAY_NAME_MAX,
} from '../src/js/booking.js';
import { startOfDay, endOfDay, addDays } from '../src/js/date-utils.js';
import { makeKv, makeFakePuter, bridgeFetch } from './helpers/worker-harness.js';

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const HOUR = 3_600_000;
const DAY = 86_400_000;
const HOST = { email: 'host@example.com', username: 'nariman' };

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const instances = [];

/**
 * A full world: real store, fake Puter, and the real rsvp-links module whose
 * admin channel the booking module rides — so the first booking sync genuinely
 * deploys the (real, instantiated) worker, and guests can be simulated by
 * calling that worker directly.
 */
function makeWorld({ user = HOST, moduleOpts = {} } = {}) {
  const kv = makeKv();
  const store = createStore(kv);
  const fakePuter = makeFakePuter();
  const fetchFn = vi.fn(bridgeFetch(fakePuter));
  const rsvp = createRsvpLinks({
    kv,
    store,
    user,
    getPuter: () => fakePuter,
    fetchFn,
    blocked: () => false,
    requestUser: async () => user,
    syncDelayMs: 0,
  });
  const toast = vi.fn();
  const booking = createBooking({
    kv,
    store,
    rsvp,
    user,
    toast,
    blocked: () => false,
    requestUser: async () => user,
    syncDelayMs: 0,
    pullMinMs: 0,
    pollMs: 3_600_000,
    pageOrigin: 'https://calendar.puter.com',
    ...moduleOpts,
  });
  instances.push(booking);
  return { kv, store, fakePuter, rsvp, booking, toast, fetchFn };
}

async function settle(booking) {
  for (let i = 0; i < 4; i++) {
    await tick();
    await booking.whenIdle();
  }
}

/** The live worker instance the world deployed (throws if none). */
function workerOf(world) {
  const origin = world.kv.map.get('cal:rsvp:cfg').url;
  return world.fakePuter.workersByUrl.get(origin).instance;
}

/** Book a slot as an anonymous guest, straight against the worker. */
async function guestBook(world, pageId, start, fields = {}) {
  const res = await workerOf(world).call('POST', `/api/book/${pageId}`, {
    body: new URLSearchParams({
      start: String(start),
      name: fields.name ?? 'Ada Lovelace',
      email: fields.email ?? 'ada@example.com',
      notes: fields.notes ?? '',
      tz: 'Europe/London',
    }).toString(),
  });
  expect(res.status).toBe(200);
  return res.json();
}

/** A slot the default page (Mon–Fri 9–17 host-local) is sure to offer. */
async function firstSlot(world, pageId) {
  const res = await workerOf(world).call('GET', `/api/book/${pageId}`);
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.firstAvailable).toBeTruthy();
  return data.firstAvailable;
}

afterEach(() => {
  while (instances.length) instances.pop().stop();
});

/* ---- Pure pieces --------------------------------------------------------- */

describe('booking: normalizePage', () => {
  it('fills defaults and clamps out-of-range values', () => {
    const page = normalizePage({});
    expect(page.id).toMatch(/^[0-9a-f]{10}$/);
    expect(page.title).toBe('30 minute meeting');
    expect(page.durationMin).toBe(30);
    expect(page.incrementMin).toBe(30);
    expect(page.minNoticeMin).toBe(120);
    expect(page.maxAdvanceDays).toBe(60);
    expect(page.enabled).toBe(true);
    expect(page.hours).toEqual(defaultHours());

    const clamped = normalizePage({ durationMin: 9999, maxAdvanceDays: 400, minNoticeMin: -5 });
    expect(clamped.durationMin).toBe(720);
    expect(clamped.maxAdvanceDays).toBe(90);
    expect(clamped.minNoticeMin).toBe(0);
  });

  it('keeps a valid id/tz and derives the title from the duration', () => {
    const page = normalizePage({ id: 'ab12cd34ef', durationMin: 45, tz: 'Asia/Tokyo' });
    expect(page.id).toBe('ab12cd34ef');
    expect(page.title).toBe('45 minute meeting');
    expect(page.tz).toBe('Asia/Tokyo');
    expect(normalizePage({ id: 'NOT OK' }).id).not.toBe('NOT OK');
    expect(normalizePage({ tz: 'Not/AZone' }).tz).not.toBe('Not/AZone');
  });

  it('incrementMin 0 resolves to "same as duration" (regression)', () => {
    expect(normalizePage({ durationMin: 60, incrementMin: 0 }).incrementMin).toBe(60);
    expect(normalizePage({ durationMin: 60 }).incrementMin).toBe(60);
    expect(normalizePage({ durationMin: 60, incrementMin: 15 }).incrementMin).toBe(15);
  });

  it('meeting links default ON — pages saved before the field existed get them too', () => {
    expect(normalizePage({}).meet).toBe(true);
    expect(normalizePage({ meet: undefined }).meet).toBe(true);
    expect(normalizePage({ meet: false }).meet).toBe(false);
    expect(normalizePage({ meet: true }).meet).toBe(true);
  });

  it('normalizeHours merges overlapping intervals and drops inverted ones', () => {
    expect(
      normalizeHours({
        1: [
          { start: 600, end: 720 },
          { start: 540, end: 660 }, // overlaps the first — merged
          { start: 900, end: 300 }, // inverted — dropped
        ],
        9: [{ start: 0, end: 60 }], // not a weekday — ignored
      }),
    ).toEqual({ 1: [{ start: 540, end: 720 }] });
  });
});

describe('booking: computeBusy', () => {
  let store;
  beforeEach(async () => {
    store = createStore(makeKv());
    await store.load();
  });

  it('includes timed events, excludes declined / all-day / hidden-color rules apply', async () => {
    const t0 = Date.now() + DAY;
    const timed = await store.saveEvent({ title: 'Busy', start: t0, end: t0 + HOUR });
    await store.saveEvent({ title: 'Declined', start: t0 + 2 * HOUR, end: t0 + 3 * HOUR, declined: true });
    await store.saveEvent({ title: 'Birthday', start: t0, end: t0 + DAY, allDay: true });
    // Hidden color still counts — hiding a category is cosmetic, not free time.
    await store.saveSettings({ hiddenColors: [timed.color] });

    const busy = computeBusy(store, 30);
    expect(busy).toEqual([[t0, t0 + HOUR]]);
  });

  it('counts every occurrence of a repeating all-day out-of-office block', async () => {
    const first = startOfDay(new Date(Date.now() + DAY));
    await store.saveEvent({
      title: 'Fridays off',
      start: first.getTime(),
      end: endOfDay(first).getTime(),
      allDay: true,
      ooo: true,
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [first.getDay()], count: 3 },
    });
    const busy = computeBusy(store, 30);
    for (const week of [0, 1, 2]) {
      const dayStart = addDays(first, 7 * week);
      const s = dayStart.getTime();
      const e = endOfDay(dayStart).getTime();
      expect(busy.some(([a, b]) => a <= s && b >= e)).toBe(true);
    }
  });

  it('counts all-day out-of-office blocks and expands recurring events', async () => {
    const t0 = Date.now() + DAY;
    const ooo = await store.saveEvent({ title: 'Away', start: t0, end: t0 + DAY, allDay: true, ooo: true });
    await store.saveEvent({
      title: 'Standup',
      start: t0 + 2 * DAY,
      end: t0 + 2 * DAY + 30 * 60_000,
      recurrence: { freq: 'daily', count: 3 },
    });
    const busy = computeBusy(store, 30);
    expect(busy.some(([s, e]) => s <= ooo.start && e >= ooo.end)).toBe(true);
    // Three daily occurrences, each 30 minutes.
    const standups = busy.filter(([s, e]) => e - s === 30 * 60_000);
    expect(standups).toHaveLength(3);
  });

  it('merges overlapping intervals and clips to the horizon', async () => {
    const t0 = Date.now() + DAY;
    await store.saveEvent({ title: 'A', start: t0, end: t0 + 2 * HOUR });
    await store.saveEvent({ title: 'B', start: t0 + HOUR, end: t0 + 3 * HOUR });
    await store.saveEvent({ title: 'Far', start: t0 + 300 * DAY, end: t0 + 300 * DAY + HOUR });
    const busy = computeBusy(store, 30);
    expect(busy).toEqual([[t0, t0 + 3 * HOUR]]);
  });
});

describe('booking: share links and worker versions', () => {
  it('workerOrigin is null while the deployed worker predates the booking routes', async () => {
    const world = makeWorld();
    await world.store.load();
    world.kv.map.set('cal:rsvp:cfg', {
      name: 'cal-rsvp-old',
      url: 'https://cal-rsvp-old.puter.work',
      secret: 's3cret',
      version: '6', // older than the booking-capable version
    });
    await world.rsvp.start();
    expect(world.rsvp.workerOrigin()).toBe(null); // copy buttons stay "preparing"
  });

  it('copy buttons light up the moment the worker is announced, not on the next sync', async () => {
    // The origin arrives on rsvp's timeline (its boot read, or a verified
    // deploy). Relaying that immediately is the difference between the sidebar
    // enabling its copy buttons then and enabling them a sync round trip later
    // — or, when that POST fails, a whole poll interval later.
    const kv = makeKv({
      'cal:book:pages': {
        'intro-call': { id: 'intro-call', title: 'Intro call', durationMin: 30, updatedAt: 1 },
      },
    });
    const store = createStore(kv);
    await store.load();
    let origin = null;
    const rsvpCbs = new Set();
    const rsvp = {
      workerOrigin: () => origin,
      onUpdate: (cb) => {
        rsvpCbs.add(cb);
        return () => rsvpCbs.delete(cb);
      },
      adminRequest: async () => ({}),
    };
    const booking = createBooking({
      kv,
      store,
      rsvp,
      user: HOST,
      toast: vi.fn(),
      blocked: () => true, // no passes at all: this is purely the relay
      requestUser: async () => HOST,
      syncDelayMs: 0,
      pollMs: 3_600_000,
      pageOrigin: 'https://calendar.puter.com',
    });
    instances.push(booking);
    const seen = [];
    booking.onUpdate(() => seen.push(booking.linkFor('intro-call')));
    await booking.start();
    expect(booking.linkFor('intro-call')).toBe(null);

    seen.length = 0;
    origin = 'https://cal-nariman.puter.work';
    for (const cb of rsvpCbs) cb(); // rsvp: "the worker is serveable now"
    expect(seen).toEqual(['https://calendar.puter.com/#/nariman/intro-call']);

    // Every later rsvp update is about some event, not the worker — re-rendering
    // the whole sidebar for each of those would be pure churn.
    seen.length = 0;
    for (const cb of rsvpCbs) cb('evt-1');
    expect(seen).toEqual([]);
  });

  it('enables the copy buttons after an upgrade even when the sync POST fails', async () => {
    // End to end on the slow path: the app updated, so the deployed worker
    // predates this bundle and gets rewritten in place on the next boot. The
    // links work the moment that redeploy verifies — the sync POST that used to
    // be the only thing announcing them is a separate, failable request.
    const world = makeWorld({ user: { ...HOST, username: 'nariman' } });
    await world.store.load();
    await world.rsvp.start();
    await world.booking.start();
    await world.booking.savePage({ title: 'Intro call', durationMin: 30 });
    await settle(world.booking);
    const cfg = world.kv.map.get('cal:rsvp:cfg');
    expect(cfg.version).toBe(RSVP_WORKER_VERSION);

    // Reboot against that worker, one app version later.
    world.kv.map.set('cal:rsvp:cfg', { ...cfg, version: '6' });
    const fetchFn = vi.fn(async (url, init) => {
      if (String(url).includes('/admin/booking/sync')) throw new Error('network');
      return bridgeFetch(world.fakePuter)(url, init);
    });
    const rsvp = createRsvpLinks({
      kv: world.kv,
      store: world.store,
      user: { ...HOST, username: 'nariman' },
      getPuter: () => world.fakePuter,
      fetchFn,
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
    });
    const booking = createBooking({
      kv: world.kv,
      store: world.store,
      rsvp,
      user: HOST,
      toast: vi.fn(),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
      pullMinMs: 0,
      pollMs: 3_600_000,
      pageOrigin: 'https://calendar.puter.com',
    });
    instances.push(booking);
    const seen = [];
    booking.onUpdate(() => seen.push(booking.linkFor(booking.getPages()[0].id)));
    await rsvp.start();
    await booking.start();
    expect(booking.linkFor(booking.getPages()[0].id)).toBe(null); // still "preparing"

    await settle(booking);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('/admin/booking/sync'),
      expect.anything(),
    ); // the announcement really did not come from a successful sync
    expect(seen.filter(Boolean)[0]).toMatch(/^https:\/\/calendar\.puter\.com\/#\/nariman\//);
    expect(booking.linkFor(booking.getPages()[0].id)).toMatch(/^https:\/\/calendar\.puter\.com\/#\/nariman\//);
  });

  /** A booking module over a stubbed rsvp whose worker origin the test controls;
   *  no passes run (blocked), so linkFor is exercised in isolation. */
  async function linkWorld(pagesById, origin, moduleOpts = {}) {
    const kv = makeKv({ 'cal:book:pages': pagesById });
    const store = createStore(kv);
    await store.load();
    const rsvp = { workerOrigin: () => origin.value, onUpdate: () => () => {}, adminRequest: async () => ({}) };
    const booking = createBooking({
      kv,
      store,
      rsvp,
      user: HOST,
      toast: vi.fn(),
      blocked: () => true,
      requestUser: async () => HOST,
      syncDelayMs: 0,
      pollMs: 3_600_000,
      ...moduleOpts,
    });
    instances.push(booking);
    await booking.start();
    return booking;
  }
  const PAGES = {
    'intro-call': { id: 'intro-call', title: 'Intro call', durationMin: 30, updatedAt: 1 },
    // A page from before slugs existed keeps its hex id; the route carries it fine.
    ab12cd34ef: { id: 'ab12cd34ef', title: 'Встреча', durationMin: 30, updatedAt: 1 },
  };

  it('share links are the app origin, the worker label and the page slug — derived, never registered', async () => {
    const origin = { value: 'https://cal-nariman-a1b2.puter.work' }; // the plain name was taken
    // A trailing slash on the origin must not read `…com//#/…`.
    const booking = await linkWorld(PAGES, origin, { pageOrigin: 'https://calendar.puter.com/' });

    expect(booking.linkFor('intro-call')).toBe('https://calendar.puter.com/#/nariman-a1b2/intro-call');
    expect(booking.linkFor('ab12cd34ef')).toBe('https://calendar.puter.com/#/nariman-a1b2/ab12cd34ef');
    // The oldest workers are `cal-rsvp-<hex>`: still `cal-`, still derivable.
    origin.value = 'https://cal-rsvp-ab12cd34ef.puter.work';
    expect(booking.linkFor('intro-call')).toBe('https://calendar.puter.com/#/rsvp-ab12cd34ef/intro-call');
    // No such page, no link; no worker, no link — the buttons stay "preparing".
    expect(booking.linkFor('discovery-call')).toBe(null);
    expect(booking.linkFor('')).toBe(null);
    origin.value = null;
    expect(booking.linkFor('intro-call')).toBe(null);
  });

  it('a worker origin the route grammar cannot carry keeps the worker-redirect link', async () => {
    // Nothing this app deploys, but the platform owns the URL it hands back.
    // Rather than mint a link the guest page would refuse, fall back to the
    // form every worker serves — which is also what every pre-existing link is.
    const origin = { value: null };
    const booking = await linkWorld(PAGES, origin, { pageOrigin: 'https://calendar.puter.com' });
    for (const url of [
      'https://rsvp-legacy.puter.work',
      'https://cal-Nariman.puter.work',
      'https://cal-nariman.puter.work:8443',
      'http://cal-nariman.puter.work',
      'https://cal-nariman.puter.work.example.com',
      'https://cal-.puter.work',
    ]) {
      origin.value = url;
      expect(booking.linkFor('intro-call'), url).toBe(`${url}/book/intro-call`);
    }
  });

  it("share links point at the app's own origin by default — book.html ships beside it", async () => {
    const origin = { value: 'https://cal-nariman.puter.work' };
    const booking = await linkWorld(PAGES, origin);
    expect(defaultPageOrigin()).toBe(window.location.origin);
    expect(booking.linkFor('intro-call')).toBe(`${window.location.origin}/#/nariman/intro-call`);
  });

  it('workerOrigin trusts a NEWER deployed worker instead of downgrading it', async () => {
    const world = makeWorld();
    await world.store.load();
    world.kv.map.set('cal:rsvp:cfg', {
      name: 'cal-rsvp-new',
      url: 'https://cal-rsvp-new.puter.work',
      secret: 's3cret',
      version: '99',
    });
    await world.rsvp.start();
    expect(world.rsvp.workerOrigin()).toBe('https://cal-rsvp-new.puter.work');
    // And the (version-gated) upgrade path never rewrites its source.
    await world.rsvp.whenIdle();
    expect(world.fakePuter.fs.write).not.toHaveBeenCalled();
  });
});

/* ---- Page CRUD + deploy --------------------------------------------------- */

describe('booking: pages and the worker', () => {
  it('creating the first page deploys the worker and makes the share link live', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    await settle(world.booking);
    expect(world.fakePuter.workers.create).not.toHaveBeenCalled(); // nothing to serve yet

    const page = await world.booking.savePage({ title: 'Coffee chat', durationMin: 30 });
    await settle(world.booking);

    expect(world.fakePuter.workers.create).toHaveBeenCalledTimes(1);
    // Both halves of the link read: the host's name fronts it, and the page's
    // own title is its last segment — on the app's origin, not the worker's.
    expect(page.id).toBe('coffee-chat');
    expect(world.booking.linkFor(page.id)).toBe('https://calendar.puter.com/#/nariman/coffee-chat');

    // The worker now serves the page to guests.
    const res = await workerOf(world).call('GET', `/api/book/${page.id}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.page.title).toBe('Coffee chat');
    expect(data.page.organizer).toBe('nariman');
  });

  it('pushes the calendar as busy time — a calendar event blocks its slot', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Chat', durationMin: 60, minNoticeMin: 0 });
    await settle(world.booking);
    const slot = await firstSlot(world, page.id);

    // The host now gets a meeting exactly there…
    await world.store.saveEvent({ title: 'Conflict', start: slot, end: slot + HOUR });
    await settle(world.booking);

    // …and the slot is gone from the guest grid.
    const res = await workerOf(world).call(
      'GET',
      `/api/book/${page.id}/slots?from=${slot - DAY}&to=${slot + DAY}`,
    );
    const { slots } = await res.json();
    expect(slots).not.toContain(slot);
  });

  it('deleting a page stops the guest page; other pages survive', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const a = await world.booking.savePage({ title: 'A' });
    const b = await world.booking.savePage({ title: 'B' });
    await settle(world.booking);
    await world.booking.deletePage(a.id);
    await settle(world.booking);
    expect((await workerOf(world).call('GET', `/api/book/${a.id}`)).status).toBe(404);
    expect((await workerOf(world).call('GET', `/api/book/${b.id}`)).status).toBe(200);
  });

  it('a device with a stale page map never erases pages created elsewhere (regression)', async () => {
    const world = makeWorld();
    await world.store.load();

    // Device B boots while no pages exist…
    const deviceB = createBooking({
      kv: world.kv,
      store: world.store,
      rsvp: world.rsvp,
      user: HOST,
      toast: vi.fn(),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
      pullMinMs: 0,
      pollMs: 3_600_000,
    });
    instances.push(deviceB);
    await deviceB.start();

    // …device A then creates page P…
    await world.booking.start();
    const p = await world.booking.savePage({ title: 'Created on A' });
    await settle(world.booking);

    // …and device B (stale map) makes its own edit. P must survive.
    const q = await deviceB.savePage({ title: 'Created on B' });
    await settle(deviceB);
    const stored = world.kv.map.get('cal:book:pages');
    expect(Object.keys(stored).sort()).toEqual([p.id, q.id].sort());
    expect(deviceB.getPage(p.id).title).toBe('Created on A');
  });

  it('a deletion on another device propagates on the next pass', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const p = await world.booking.savePage({ title: 'Doomed' });
    await settle(world.booking);

    const deviceB = createBooking({
      kv: world.kv,
      store: world.store,
      rsvp: world.rsvp,
      user: HOST,
      toast: vi.fn(),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
      pullMinMs: 0,
      pollMs: 3_600_000,
    });
    instances.push(deviceB);
    await deviceB.start();
    expect(deviceB.getPage(p.id)).toBeTruthy();

    await world.booking.deletePage(p.id);
    await settle(world.booking);
    await deviceB.refresh();
    expect(deviceB.getPage(p.id)).toBe(null);
  });

  it('a background pass never clobbers a page saved while its config read was in flight (race regression)', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    await world.booking.savePage({ title: 'First' });
    await settle(world.booking);

    // Gate the pass's read of the page map so it resolves — with a PRE-SAVE
    // snapshot — only after a fresh page has been saved underneath it.
    // (savePage runs off the pass chain, so the two genuinely interleave.)
    const realGet = world.kv.get.getMockImplementation();
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    let gated = false;
    world.kv.get.mockImplementation(async (key) => {
      if (key === 'cal:book:pages' && !gated) {
        gated = true;
        const snapshot = await realGet(key); // captured before the save below
        await gate;
        return snapshot;
      }
      return realGet(key);
    });

    const raced = world.booking.refresh(); // authoritative reload, read gated
    await tick();
    const saved = await world.booking.savePage({ title: 'Second' });
    release();
    await raced;

    expect(world.booking.getPage(saved.id)).toBeTruthy();
    expect(world.booking.getPages().map((p) => p.title)).toContain('Second');
  });

  it('pushes busy time past the far edge of a 90-day window', async () => {
    // The busy list is clipped to whole LOCAL days, so how much of today has
    // already gone is what decides whether the tail of the last bookable day
    // is reported. Pin 22:00 local, whatever zone runs this.
    vi.useFakeTimers({ toFake: ['Date'] });
    const midday = new Date(Date.UTC(2027, 5, 15, 12));
    vi.setSystemTime(startOfDay(midday).getTime() + 22 * HOUR);
    try {
      const world = makeWorld();
      await world.store.load();
      await world.booking.start();
      // A meeting at the horizon can run 12 hours and hold a 4-hour buffer
      // after it, so busy has to reach that far or the slot engine judges the
      // edge of the window against a calendar it can't see.
      const far = Date.now() + 90 * DAY + 15 * HOUR;
      await world.store.saveEvent({ title: 'Board offsite', start: far, end: far + HOUR });
      await world.booking.savePage({ title: 'Long lead time', maxAdvanceDays: 90 });
      await settle(world.booking);

      const cfg = workerOf(world).kv.map.get('bookw:cfg');
      expect(cfg.busy.some(([s2, e2]) => s2 <= far && e2 >= far + HOUR)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses page changes while offline', async () => {
    const world = makeWorld({ moduleOpts: { blocked: () => true } });
    await world.store.load();
    await world.booking.start();
    await expect(world.booking.savePage({ title: 'Nope' })).rejects.toThrow(/offline/i);
    expect(world.booking.getPages()).toHaveLength(0);
  });

  it('pages survive a reload without churning the sync digest', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Persist me', durationMin: 45 });
    await settle(world.booking);

    // A second module instance over the same KV (a reload).
    const again = createBooking({
      kv: world.kv,
      store: world.store,
      rsvp: world.rsvp,
      user: HOST,
      toast: vi.fn(),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
      pullMinMs: 0,
      pollMs: 3_600_000,
    });
    instances.push(again);
    await again.start();
    await settle(again);
    const loaded = again.getPage(page.id);
    expect(loaded.title).toBe('Persist me');
    expect(loaded.durationMin).toBe(45);
    expect(loaded.updatedAt).toBe(page.updatedAt); // not re-stamped on load
  });

  it('pushes nothing until the calendar has actually been read', async () => {
    const world = makeWorld(); // note: no store.load()
    await world.booking.start();
    // A page exists, so there is something to serve — but busy time computed
    // from an unread calendar would say the host is free all week, and that
    // must not be what guests are told.
    await world.booking.savePage({ title: 'Intro call' });
    await settle(world.booking);
    expect(world.fakePuter.created).toEqual([]);

    await world.store.load();
    await settle(world.booking);
    expect(world.fakePuter.created.length).toBe(1);
    const cfg = workerOf(world).kv.map.get('bookw:cfg');
    expect(Object.keys(cfg.pages)).toHaveLength(1);
  });

  it('refuses a save it would have to make over an unreadable page map', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const first = await world.booking.savePage({ title: 'Intro call' });
    await settle(world.booking);

    // Every persist rewrites the whole map, so saving over a snapshot we could
    // not read is how a page created on another device disappears. "Couldn't
    // save" is recoverable; that is not.
    const realGet = world.kv.get.getMockImplementation();
    let glitched = false;
    world.kv.get.mockImplementation(async (key) => {
      if (key === 'cal:book:pages' && !glitched) {
        glitched = true;
        return null;
      }
      return realGet(key);
    });

    await expect(world.booking.savePage({ title: 'Second' })).rejects.toThrow(/try again/i);
    expect(world.booking.getPages().map((p) => p.title)).toEqual(['Intro call']);
    // The retry, on a readable map, goes through.
    const second = await world.booking.savePage({ title: 'Second' });
    expect(second.id).not.toBe(first.id);
    expect(world.booking.getPages()).toHaveLength(2);
  });

  it('keeps live links alive when the stored page map reads back as nothing', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call' });
    await settle(world.booking);
    expect((await workerOf(world).call('GET', `/api/book/${page.id}`)).status).toBe(200);

    // One transient empty read of the map. persistPages never writes null, so
    // this can only be the read failing — taking it as "no pages" would push
    // an empty config and 404 every link the host has shared.
    const realGet = world.kv.get.getMockImplementation();
    let glitched = false;
    world.kv.get.mockImplementation(async (key) => {
      if (key === 'cal:book:pages' && !glitched) {
        glitched = true;
        return null;
      }
      return realGet(key);
    });

    await world.booking.refresh();
    await settle(world.booking);

    expect(world.booking.getPages().map((p) => p.title)).toEqual(['Intro call']);
    expect((await workerOf(world).call('GET', `/api/book/${page.id}`)).status).toBe(200);
  });

  it('still lets the last page be deleted on another device (an empty map is real)', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call' });
    await settle(world.booking);

    // What another device's delete leaves behind: the key, holding `{}`.
    await world.kv.set('cal:book:pages', {});
    await world.booking.refresh();
    await settle(world.booking);

    expect(world.booking.getPages()).toEqual([]);
    expect((await workerOf(world).call('GET', `/api/book/${page.id}`)).status).toBe(404);
  });
});

/* ---- Bookings → calendar events ------------------------------------------- */

describe('booking: pulling bookings into the calendar', () => {
  async function worldWithBooking() {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({
      title: 'Office hours',
      durationMin: 60,
      minNoticeMin: 0,
      location: 'Video call',
      color: 'green',
    });
    await settle(world.booking);
    const slot = await firstSlot(world, page.id);
    const out = await guestBook(world, page.id, slot, { notes: 'About the roadmap' });
    // The guest booked from outside — nothing changed the store, so ask for a
    // pass the way the poll / visibility handler would.
    await world.booking.refresh();
    return { world, page, slot, out };
  }

  it('creates a calendar event for a new booking (id = booking id)', async () => {
    const { world, page, slot, out } = await worldWithBooking();
    await settle(world.booking);

    const ev = world.store.getEvent(out.booking.id);
    expect(ev).toBeTruthy();
    expect(ev.start).toBe(slot);
    expect(ev.end).toBe(slot + HOUR);
    expect(ev.title).toBe('Ada Lovelace — Office hours');
    expect(ev.location).toBe('Video call');
    expect(ev.color).toBe('green');
    expect(ev.guests).toEqual([{ email: 'ada@example.com', name: 'Ada Lovelace', status: 'accepted' }]);
    expect(ev.organizer).toEqual({ email: HOST.email });
    expect(ev.booking).toEqual({
      id: out.booking.id,
      pageId: page.id,
      pageTitle: 'Office hours',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });
    expect(ev.description).toContain('About the roadmap');
    expect(world.toast).toHaveBeenCalledWith(expect.stringContaining('New booking: Ada Lovelace'), expect.anything());
  });

  it('attaches the worker-minted Puter Meetings link to the created event', async () => {
    const { world, out } = await worldWithBooking();
    await settle(world.booking);

    // The worker minted the room at booking time (pages default meet: true)…
    expect(out.booking.meetingUrl).toMatch(
      /^https:\/\/meetings\.puter\.com\/#\/m\/[a-z]{4}-[a-z]{4}-[a-z]{4}$/,
    );
    // …and the pull carried it onto the calendar event, so the details card
    // shows the same Join link the guest's confirmation email carries.
    const ev = world.store.getEvent(out.booking.id);
    expect(ev.meeting).toEqual({ url: out.booking.meetingUrl });
  });

  it('a page with meetings off books without a link', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'In person', minNoticeMin: 0, meet: false });
    await settle(world.booking);
    const slot = await firstSlot(world, page.id);
    const out = await guestBook(world, page.id, slot);
    await world.booking.refresh();
    await settle(world.booking);

    expect(out.booking.meetingUrl).toBe('');
    expect('meeting' in world.store.getEvent(out.booking.id)).toBe(false);
  });

  it('refuses a pulled link that is not a Puter Meetings room URL (tampered worker record)', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Office hours', minNoticeMin: 0 });
    await settle(world.booking);
    const slot = await firstSlot(world, page.id);
    const out = await guestBook(world, page.id, slot);
    // The admin pull passes booking records through as-is — corrupt the stored
    // record before the app sees it. The event must still land, link-less.
    workerOf(world).kv.map.get(`bookw:bkg:${out.booking.id}`).meetingUrl =
      'https://evil.example/#/m/abcd-efgh-ijkl';
    await world.booking.refresh();
    await settle(world.booking);

    const ev = world.store.getEvent(out.booking.id);
    expect(ev).toBeTruthy();
    expect('meeting' in ev).toBe(false);
  });

  it('never duplicates the event — a second device applying the same pull is a no-op', async () => {
    const { world, out } = await worldWithBooking();
    await settle(world.booking);

    const second = createBooking({
      kv: world.kv,
      store: world.store,
      rsvp: world.rsvp,
      user: HOST,
      toast: vi.fn(),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
      pullMinMs: 0,
      pollMs: 3_600_000,
    });
    instances.push(second);
    await second.start();
    await settle(second);

    const matches = world.store.getAllEvents().filter((ev) => ev.booking && ev.booking.id === out.booking.id);
    expect(matches).toHaveLength(1);
  });

  it('a guest cancellation removes the event and says who cancelled', async () => {
    const { world, out } = await worldWithBooking();
    await settle(world.booking);
    expect(world.store.getEvent(out.booking.id)).toBeTruthy();

    const res = await workerOf(world).call('POST', `/api/booking/${out.token}/cancel`, { body: '' });
    expect(res.status).toBe(200);
    // Nudge a pass — in the app the poll or a store change would do this.
    await world.booking.refresh();
    await settle(world.booking);

    expect(world.store.getEvent(out.booking.id)).toBe(null);
    expect(world.toast).toHaveBeenCalledWith(expect.stringContaining('cancelled their booking'));
  });

  it('a host-removed event is NOT resurrected by the next pull', async () => {
    const { world, out } = await worldWithBooking();
    await settle(world.booking);
    await world.store.deleteEvent(out.booking.id);
    await settle(world.booking);
    expect(world.store.getEvent(out.booking.id)).toBe(null);
  });

  /**
   * The host with the calendar open twice (a second tab, a phone): `world` is
   * the window that pulls the booking first, `behind` is a second store that
   * read the calendar BEFORE the booking existed and — like a real open window
   * — never reads it again on its own.
   */
  async function twoWindows() {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Office hours', minNoticeMin: 0 });
    await settle(world.booking);

    const behind = createStore(world.kv);
    await behind.load();

    const slot = await firstSlot(world, page.id);
    const out = await guestBook(world, page.id, slot);
    await world.booking.refresh();
    await settle(world.booking);
    return { world, behind, page, out };
  }

  it('coming back to the calendar window pulls, without waiting for the poll', async () => {
    // Inside the Puter desktop, moving between app windows never hides the tab,
    // so `visibilitychange` never fires there — `focus` is the event that says
    // "the host is looking at the calendar again", and the moment to have their
    // bookings. The poll here is effectively switched off, so only the focus
    // handler can make this pass happen.
    const world = makeWorld({ moduleOpts: { pollMs: 3_600_000 } });
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Office hours', minNoticeMin: 0 });
    await settle(world.booking);
    const slot = await firstSlot(world, page.id);
    const out = await guestBook(world, page.id, slot);
    expect(world.store.getEvent(out.booking.id)).toBe(null);

    window.dispatchEvent(new Event('focus'));
    await settle(world.booking);

    expect(world.store.getEvent(out.booking.id)).toBeTruthy();
  });

  it('a window that adopted another window’s applied entry still shows the event', async () => {
    // The host has the calendar open twice (a second tab, a phone). One window
    // pulls the booking first: it writes the event to the cloud AND the applied
    // entry to the shared map. The other window then reads that map, so its own
    // pull sees "already applied" and creates nothing — and its store only ever
    // read the calendar at boot, before the event existed. Without a cloud look
    // the booking is invisible there until the app is restarted, which is the
    // bug this covers.
    const { world, behind, out } = await twoWindows();
    expect(world.store.getEvent(out.booking.id)).toBeTruthy(); // the window that pulled
    expect(behind.getEvent(out.booking.id)).toBe(null); // the one that hasn't re-read

    const second = createBooking({
      kv: world.kv,
      store: behind,
      rsvp: world.rsvp,
      user: HOST,
      toast: vi.fn(),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
      pullMinMs: 0,
      pollMs: 3_600_000,
    });
    instances.push(second);
    await second.start();
    await settle(second);

    expect(behind.getEvent(out.booking.id)).toBeTruthy();
  });

  it('the catch-up look never starts a countdown to cancelling a live booking', async () => {
    // Same window-behind situation, but with no grace at all: finding the event
    // in the cloud has to settle it outright. A window that is merely behind
    // must never be the reason a guest is told their meeting is off.
    const { world, behind, out } = await twoWindows();

    const second = createBooking({
      kv: world.kv,
      store: behind,
      rsvp: world.rsvp,
      user: HOST,
      toast: vi.fn(),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
      pullMinMs: 0,
      pollMs: 3_600_000,
      orphanGraceMs: 0,
    });
    instances.push(second);
    await second.start();
    await settle(second);
    await behind.saveSettings({}); // a second pass, which is when a grace of 0 would fire
    await settle(second);

    const view = await (await workerOf(world).call('GET', `/api/booking/${out.token}`)).json();
    expect(view.booking.status).toBe('confirmed');
    expect(behind.getEvent(out.booking.id)).toBeTruthy();
  });

  it('cancelBooking cancels on the worker, emails aside, and removes the event', async () => {
    const { world, out } = await worldWithBooking();
    await settle(world.booking);

    await world.booking.cancelBooking(out.booking.id);
    expect(world.store.getEvent(out.booking.id)).toBe(null);
    const view = await (await workerOf(world).call('GET', `/api/booking/${out.token}`)).json();
    expect(view.booking.status).toBe('cancelled');
    expect(view.booking.cancelledBy).toBe('host');
    // The freed slot is bookable again — once the busy re-push (the deleted
    // event was busy time) lands, which the event deletion itself schedules.
    await settle(world.booking);
    const res = await workerOf(world).call(
      'GET',
      `/api/book/${out.booking.pageId}/slots?from=${out.booking.start - 1}&to=${out.booking.start + 1}`,
    );
    expect((await res.json()).slots).toContain(out.booking.start);
  });

  it.each([true, false, undefined])('reports the worker email result honestly (emailed=%s)', async (emailed) => {
    const { world, out } = await worldWithBooking();
    await settle(world.booking);
    const request = world.rsvp.adminRequest;
    vi.spyOn(world.rsvp, 'adminRequest').mockImplementation(async (path, body) => {
      const result = await request(path, body);
      return path === '/admin/booking/cancel' ? { ...result, emailed } : result;
    });
    expect(await world.booking.cancelBooking(out.booking.id)).toEqual({ notified: emailed === true });
    expect(world.store.getEvent(out.booking.id)).toBeNull();
    const result = await (await workerOf(world).call('GET', `/api/booking/${out.token}`)).json();
    expect(result.booking.status).toBe('cancelled');
  });

  it.each([true, false])('safety net reports email delivery accurately (emailed=%s)', async (emailed) => {
    const { world, out } = await worldWithBooking();
    await settle(world.booking);

    const request = world.rsvp.adminRequest;
    vi.spyOn(world.rsvp, 'adminRequest').mockImplementation(async (path, body) => {
      const result = await request(path, body);
      return path === '/admin/booking/cancel' ? { ...result, emailed } : result;
    });
    const notifyToast = vi.fn();

    // Bypass the explicit action: delete the event directly.
    await world.store.deleteEvent(out.booking.id);
    // First pass records missingSince (grace 0 here means the SECOND pass acts).
    const short = createBooking({
      kv: world.kv,
      store: world.store,
      rsvp: world.rsvp,
      user: HOST,
      toast: notifyToast,
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
      pullMinMs: 0,
      pollMs: 3_600_000,
      orphanGraceMs: 0,
    });
    instances.push(short);
    await short.start();
    await settle(short);
    await world.store.saveSettings({}); // trigger another pass
    await settle(short);

    const view = await (await workerOf(world).call('GET', `/api/booking/${out.token}`)).json();
    expect(view.booking.status).toBe('cancelled');
    expect(notifyToast).toHaveBeenCalledWith(expect.stringContaining(
      emailed ? 'and let them know.' : 'but no cancellation email was sent.',
    ));
  });

  it('scans the calendar once per pull, not once per booking it lists', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Office hours', durationMin: 60, minNoticeMin: 0 });
    await settle(world.booking);

    // Four bookings, all cancelled by their guests. The worker keeps listing a
    // cancelled booking for 200 days, and its applied record names no event —
    // so every pull re-answers "where is its event?" for every one of them.
    for (let i = 0; i < 4; i++) {
      const slot = await firstSlot(world, page.id);
      const out = await guestBook(world, page.id, slot, { email: `g${i}@example.com` });
      await world.booking.refresh();
      await settle(world.booking);
      await workerOf(world).call('POST', `/api/booking/${out.token}/cancel`, { body: '' });
      await world.booking.refresh();
      await settle(world.booking);
    }

    const real = world.store.getAllEvents;
    let scans = 0;
    world.store.getAllEvents = (...args) => {
      scans += 1;
      return real.apply(world.store, args);
    };
    try {
      await world.booking.refresh();
      await settle(world.booking);
    } finally {
      world.store.getAllEvents = real;
    }
    // One index per sweep (the pull's apply, then the orphan check) — not one
    // full scan per booking, which is where this used to grow with the O(n·m)
    // product of bookings and calendar size.
    expect(scans).toBeGreaterThan(0);
    expect(scans).toBeLessThanOrEqual(2);
  });

  it('upcomingCount counts confirmed future bookings for the delete confirm', async () => {
    const { world, page } = await worldWithBooking();
    await settle(world.booking);
    expect(world.booking.upcomingCount(page.id)).toBe(1);
    expect(world.booking.upcomingCount('other999')).toBe(0);
  });

  it('prunes applied entries for long-past bookings so the state map stays bounded', async () => {
    const { world, out } = await worldWithBooking();
    await settle(world.booking);
    // Plant an ancient entry, as if from a booking the worker itself pruned.
    const stored = world.kv.map.get('cal:book:state');
    stored.applied['0ldbooking0000'] = {
      status: 'cancelled',
      at: 1,
      start: Date.now() - 250 * DAY,
      pageId: 'gone',
    };
    world.kv.map.set('cal:book:state', stored);

    // A fresh instance loads that state and its next pull prunes it.
    const again = createBooking({
      kv: world.kv,
      store: world.store,
      rsvp: world.rsvp,
      user: HOST,
      toast: vi.fn(),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
      pullMinMs: 0,
      pollMs: 3_600_000,
    });
    instances.push(again);
    await again.start();
    await settle(again);
    const after = world.kv.map.get('cal:book:state');
    expect(after.applied['0ldbooking0000']).toBeUndefined();
    expect(after.applied[out.booking.id]).toBeTruthy(); // the live one stays
  });
});

/* ---- Readable link ids ---------------------------------------------------- */

describe('booking: the orphan safety net', () => {
  it('re-reads the calendar before cancelling, so a partial read cancels nothing', async () => {
    const world = makeWorld({ moduleOpts: { orphanGraceMs: 0 } });
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call' });
    await settle(world.booking);
    const start = await firstSlot(world, page.id);
    const out = await guestBook(world, page.id, start);
    await world.booking.refresh();
    await settle(world.booking);
    expect(world.store.getEvent(out.booking.id)).toBeTruthy();

    // One key listing that silently drops the booking's event. puter.kv.list
    // does exactly this on large result sets, and the store's own shard
    // fan-out is a mitigation, not a guarantee — so the calendar in memory can
    // be missing an event the cloud still holds.
    const realList = world.kv.list.getMockImplementation();
    let dropped = false;
    world.kv.list.mockImplementation(async (pattern, withValues) => {
      const res = await realList(pattern, withValues);
      if (!dropped && pattern === 'cal:evt:*' && withValues) {
        dropped = true;
        return res.filter((e) => !e.key.endsWith(out.booking.id));
      }
      return res;
    });
    await world.store.load();
    expect(world.store.getEvent(out.booking.id)).toBeNull();
    expect(world.kv.map.has(`cal:evt:${out.booking.id}`)).toBe(true);

    for (let i = 0; i < 2; i++) {
      await world.booking.refresh();
      await settle(world.booking);
    }
    // Still confirmed, and the guest was never written to.
    expect(workerOf(world).kv.map.get(`bookw:bkg:${out.booking.id}`).status).toBe('confirmed');
    expect(world.store.getEvent(out.booking.id)).toBeTruthy();
  });

  it('still cancels a booking whose event is really gone', async () => {
    const world = makeWorld({ moduleOpts: { orphanGraceMs: 0 } });
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call' });
    await settle(world.booking);
    const start = await firstSlot(world, page.id);
    const out = await guestBook(world, page.id, start);
    await world.booking.refresh();
    await settle(world.booking);

    await world.store.deleteEvent(out.booking.id);
    for (let i = 0; i < 2; i++) {
      await world.booking.refresh();
      await settle(world.booking);
    }
    const record = workerOf(world).kv.map.get(`bookw:bkg:${out.booking.id}`);
    expect(record.status).toBe('cancelled');
    expect(record.cancelledBy).toBe('host');
  });

  it('waits rather than guessing when the calendar cannot be re-read', async () => {
    const world = makeWorld({ moduleOpts: { orphanGraceMs: 0 } });
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call' });
    await settle(world.booking);
    const start = await firstSlot(world, page.id);
    const out = await guestBook(world, page.id, start);
    await world.booking.refresh();
    await settle(world.booking);
    await world.store.deleteEvent(out.booking.id);

    const realList = world.kv.list.getMockImplementation();
    world.kv.list.mockImplementation(async (pattern, withValues) => {
      if (pattern === 'cal:evt:*') throw new Error('kv unavailable');
      return realList(pattern, withValues);
    });
    for (let i = 0; i < 2; i++) {
      await world.booking.refresh();
      await settle(world.booking);
    }
    expect(workerOf(world).kv.map.get(`bookw:bkg:${out.booking.id}`).status).toBe('confirmed');

    // Readable again: the cancellation goes through.
    world.kv.list.mockImplementation(realList);
    await world.booking.refresh();
    await settle(world.booking);
    expect(workerOf(world).kv.map.get(`bookw:bkg:${out.booking.id}`).status).toBe('cancelled');
  });
});

describe('booking: a booking the worker no longer has', () => {
  /** A world where the host deleted a booked event AND the worker's record for
   *  it is gone (pruned long ago, or a calendar restored from a backup). */
  async function worldWithVanishedRecord(moduleOpts) {
    const world = makeWorld({ moduleOpts });
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call' });
    await settle(world.booking);
    const start = await firstSlot(world, page.id);
    const out = await guestBook(world, page.id, start);
    await world.booking.refresh();
    await settle(world.booking);
    await world.store.deleteEvent(out.booking.id);
    workerOf(world).kv.map.delete(`bookw:bkg:${out.booking.id}`);
    return { world, out };
  }

  it('stops re-asking the worker to cancel it on every pass', async () => {
    const { world } = await worldWithVanishedRecord({ orphanGraceMs: 0 });
    const attempts = () =>
      world.fetchFn.mock.calls.filter(([u]) => String(u).endsWith('/admin/booking/cancel')).length;

    await world.booking.refresh();
    await settle(world.booking);
    const first = attempts();
    expect(first).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      await world.booking.refresh();
      await settle(world.booking);
    }
    expect(attempts()).toBe(first);
  });

  it('still lets the host cancel it, and says nobody was emailed', async () => {
    const { world, out } = await worldWithVanishedRecord({ orphanGraceMs: 60 * 60_000 });
    // Put the event back so the host is looking at a cancellable booking.
    await world.store.saveEvent({
      id: out.booking.id,
      title: 'Ada — Intro call',
      start: out.booking.start,
      end: out.booking.end,
      booking: { id: out.booking.id, pageId: out.booking.pageId, email: 'ada@example.com' },
    });
    const res = await world.booking.cancelBooking(out.booking.id);
    expect(res).toEqual({ notified: false });
    expect(world.store.getEvent(out.booking.id)).toBeNull();
  });
});

describe('booking: a cancelled slot opens up again', () => {
  async function worldWithOneBooking() {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call' });
    await settle(world.booking);
    const start = await firstSlot(world, page.id);
    const out = await guestBook(world, page.id, start);
    await world.booking.refresh();
    await settle(world.booking);
    expect(world.store.getEvent(out.booking.id)).toBeTruthy();
    return { world, page, start, out };
  }

  const slotsAround = async (world, pageId, start) =>
    (
      await (
        await workerOf(world).call('GET', `/api/book/${pageId}/slots?from=${start - 1}&to=${start + 1}`)
      ).json()
    ).slots;

  it('frees the time for a booking recorded before the span was tracked', async () => {
    const { world, page, start, out } = await worldWithOneBooking();
    // What an applied record looked like before it carried `end`.
    const stored = world.kv.map.get('cal:book:state');
    delete stored.applied[out.booking.id].end;
    await world.kv.set('cal:book:state', stored);
    while (instances.length) instances.pop().stop();

    const fresh = createBooking({
      kv: world.kv,
      store: world.store,
      rsvp: world.rsvp,
      user: HOST,
      toast: vi.fn(),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
      pullMinMs: 0,
      pollMs: 3_600_000,
    });
    instances.push(fresh);
    await fresh.start();
    await fresh.refresh();
    await settle(fresh);
    expect(world.kv.map.get('cal:book:state').applied[out.booking.id].end).toBe(out.booking.end);

    const res = await workerOf(world).call('POST', `/api/booking/${out.token}/cancel`, { body: '' });
    expect(res.status).toBe(200);
    expect(await slotsAround(world, page.id, start)).toEqual([start]);
  });

  it('frees the time the moment the guest cancels, with no further pass', async () => {
    const { world, page, start, out } = await worldWithOneBooking();
    expect(await slotsAround(world, page.id, start)).toEqual([]);

    // The guest cancels through their manage link. Nothing on the host's side
    // runs — the worker's own record is what has to free the slot.
    const res = await workerOf(world).call('POST', `/api/booking/${out.token}/cancel`, { body: '' });
    expect(res.status).toBe(200);
    expect(await slotsAround(world, page.id, start)).toEqual([start]);
  });

  it('keeps blocking the time while the booking stands', async () => {
    const { world, page, start } = await worldWithOneBooking();
    expect(await slotsAround(world, page.id, start)).toEqual([]);
    // And a second guest is still turned away.
    const res = await workerOf(world).call('POST', `/api/book/${page.id}`, {
      body: new URLSearchParams({ start: String(start), name: 'Bob', email: 'bob@example.com' }).toString(),
    });
    expect(res.status).toBe(409);
  });

  it('reports a MOVED booking event as busy at its new time', async () => {
    const { world, page, start, out } = await worldWithOneBooking();
    const ev = world.store.getEvent(out.booking.id);
    // The host drags it an hour later. Nothing tells the guest (by design),
    // and the worker still blocks the original slot from its own record — but
    // the new hour is time only the calendar knows about.
    const moved = { ...ev, start: ev.start + HOUR, end: ev.end + HOUR };
    await world.store.saveEvent(moved);
    await world.booking.refresh();
    await settle(world.booking);
    expect(await slotsAround(world, page.id, start + HOUR)).toEqual([]);
    expect(await slotsAround(world, page.id, start)).toEqual([]);
  });
});

describe('booking: the applied-booking record', () => {
  /** A world holding one applied booking whose event the host then deletes. */
  async function worldWithDeletedBookingEvent() {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call' });
    await settle(world.booking);
    const start = await firstSlot(world, page.id);
    const out = await guestBook(world, page.id, start);
    await world.booking.refresh();
    await settle(world.booking);
    expect(world.store.getEvent(out.booking.id)).toBeTruthy();
    // The host removes it by hand (no "Cancel booking"), which the orphan net
    // owns from here on — it must never be re-created underneath them.
    await world.store.deleteEvent(out.booking.id);
    return { world, page, booking: out.booking };
  }

  it('does not recreate a deleted booking event when the state read fails', async () => {
    const { world, booking } = await worldWithDeletedBookingEvent();
    while (instances.length) instances.pop().stop();

    // A fresh boot whose read of the applied map glitches once.
    const realGet = world.kv.get.getMockImplementation();
    let glitched = false;
    world.kv.get.mockImplementation(async (key) => {
      if (key === 'cal:book:state' && !glitched) {
        glitched = true;
        throw new Error('kv unavailable');
      }
      return realGet(key);
    });

    const fresh = createBooking({
      kv: world.kv,
      store: world.store,
      rsvp: world.rsvp,
      user: HOST,
      toast: vi.fn(),
      blocked: () => false,
      requestUser: async () => HOST,
      syncDelayMs: 0,
      pullMinMs: 0,
      pollMs: 3_600_000,
    });
    instances.push(fresh);
    await fresh.start();
    await settle(fresh);
    expect(world.store.getEvent(booking.id)).toBeNull();

    // Once the map is readable the pull resumes normally — and still doesn't
    // resurrect it, because the record says it was applied already.
    await fresh.refresh();
    await settle(fresh);
    expect(world.store.getEvent(booking.id)).toBeNull();
  });

  it('merges the stored map on write instead of overwriting another device', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call' });
    await settle(world.booking);

    // An entry only the OTHER device knows about, written under this one's feet.
    const other = {
      applied: {
        deadbeefdeadbeefdeadbeefdeadbeef: {
          status: 'confirmed',
          at: Date.now(),
          start: Date.now() + 5 * DAY,
          pageId: page.id,
          name: 'Grace',
          email: 'grace@example.com',
          eventId: 'deadbeefdeadbeefdeadbeefdeadbeef',
        },
      },
    };
    await world.kv.set('cal:book:state', other);

    // This device applies a booking of its own, which rewrites the whole map.
    const start = await firstSlot(world, page.id);
    const out = await guestBook(world, page.id, start);
    await world.booking.refresh();
    await settle(world.booking);

    const stored = world.kv.map.get('cal:book:state');
    expect(Object.keys(stored.applied).sort()).toEqual(
      ['deadbeefdeadbeefdeadbeefdeadbeef', out.booking.id].sort(),
    );
  });
});

describe('booking: page ids read as slugs', () => {
  it('slugifies a title, and says so with an empty string when it cannot', () => {
    expect(slugifyPageId('Intro call')).toBe('intro-call');
    expect(slugifyPageId('  Coffee & Cake!!  ')).toBe('coffee-cake');
    expect(slugifyPageId('Café crème')).toBe('cafe-creme'); // accents folded, not dropped
    expect(slugifyPageId('30 minute meeting')).toBe('30-minute-meeting');
    // Too short to be an id, and nothing Latin to work with at all.
    expect(slugifyPageId('A')).toBe('');
    expect(slugifyPageId('Кофе')).toBe('');
    expect(slugifyPageId('')).toBe('');
    // Capped at 32, and never left ending on the separator the cut landed in.
    const long = slugifyPageId('a'.repeat(20) + ' ' + 'b'.repeat(20));
    expect(long.length).toBeLessThanOrEqual(32);
    expect(long.endsWith('-')).toBe(false);
  });

  it('gives a new page its title as an id, and the next of that title a suffix', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const first = await world.booking.savePage({ title: 'Intro call' });
    const second = await world.booking.savePage({ title: 'Intro call' });
    expect(first.id).toBe('intro-call');
    expect(second.id).toBe('intro-call-2');
  });

  it('falls back to a random id when the title yields no usable slug', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Кофе' });
    expect(page.id).toMatch(/^[0-9a-f]{10}$/);
  });

  it('keeps the id when a page is renamed — its link is already out there', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call' });
    const renamed = await world.booking.savePage({ id: page.id, title: 'Discovery call' });
    expect(renamed.id).toBe('intro-call');
    expect(renamed.title).toBe('Discovery call');
  });

  it('still accepts the random hex ids every page created before slugs uses', () => {
    expect(normalizePage({ id: '9f3c1a2b0d' }).id).toBe('9f3c1a2b0d');
    // A hyphen may sit inside an id, never at either end.
    expect(normalizePage({ id: 'intro-call' }).id).toBe('intro-call');
    expect(normalizePage({ id: '-intro' }).id).not.toBe('-intro');
    expect(normalizePage({ id: 'intro-' }).id).not.toBe('intro-');
  });
});

describe("booking: the host's profile picture", () => {
  const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

  /** A world whose profile reads are scripted, so the sync can be watched
   *  without a Puter drive behind it. */
  function pictureWorld(results) {
    const answers = [].concat(results);
    const readPicture = vi.fn(async () => (answers.length > 1 ? answers.shift() : answers[0]));
    return { world: makeWorld({ moduleOpts: { readPicture } }), readPicture };
  }

  function cfgOf(world) {
    return workerOf(world).kv.map.get('bookw:cfg');
  }

  async function pageView(world, id) {
    const res = await workerOf(world).call('GET', `/api/book/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()).page;
  }

  it('is opt-in per page, and never coerced from a truthy value', () => {
    // A page saved before the field existed must not start publishing its
    // host's face because the app was updated under it.
    expect(normalizePage({}).avatar).toBe(false);
    expect(normalizePage({ avatar: 'yes' }).avatar).toBe(false);
    expect(normalizePage({ avatar: 1 }).avatar).toBe(false);
    expect(normalizePage({ avatar: true }).avatar).toBe(true);
  });

  it('publishes the SDK picture through the real sync path only on opted-in pages', async () => {
    const getProfilePicture = vi.fn().mockResolvedValue(PIC);
    vi.stubGlobal('puter', { auth: { getProfilePicture } });
    try {
      const world = makeWorld();
      await world.store.load();
      await world.booking.start();
      const hidden = await world.booking.savePage({ title: 'Hidden', avatar: false });
      await settle(world.booking);
      expect(getProfilePicture).not.toHaveBeenCalled();
      const shown = await world.booking.savePage({ title: 'Shown', avatar: true });
      await settle(world.booking);
      expect(getProfilePicture).toHaveBeenCalledWith(HOST.username);
      expect((await pageView(world, shown.id)).organizerPicture).toBe(PIC);
      expect((await pageView(world, hidden.id)).organizerPicture).toBe('');
      await world.booking.savePage({ ...shown, avatar: false });
      await settle(world.booking);
      expect((await pageView(world, shown.id)).organizerPicture).toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('publishes the picture for a page that asks, and hands it to guests', async () => {
    const { world, readPicture } = pictureWorld({ state: 'found', picture: PIC });
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call', avatar: true });
    await settle(world.booking);

    expect(readPicture).toHaveBeenCalled();
    expect(cfgOf(world).organizerPicture).toBe(PIC);
    expect((await pageView(world, page.id)).organizerPicture).toBe(PIC);
  });

  it('never reads the profile for a host whose pages all say no', async () => {
    const { world, readPicture } = pictureWorld({ state: 'found', picture: PIC });
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call' });
    await settle(world.booking);

    expect(readPicture).not.toHaveBeenCalled();
    expect(cfgOf(world).organizerPicture).toBe('');
    expect((await pageView(world, page.id)).organizerPicture).toBe('');
  });

  it('one page saying yes does not put the picture on the others', async () => {
    const { world } = pictureWorld({ state: 'found', picture: PIC });
    await world.store.load();
    await world.booking.start();
    const shown = await world.booking.savePage({ title: 'Intro call', avatar: true });
    const hidden = await world.booking.savePage({ title: 'Deep dive' });
    await settle(world.booking);

    expect((await pageView(world, shown.id)).organizerPicture).toBe(PIC);
    expect((await pageView(world, hidden.id)).organizerPicture).toBe('');
  });

  it('takes the picture back off when the switch goes off', async () => {
    const { world } = pictureWorld({ state: 'found', picture: PIC });
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call', avatar: true });
    await settle(world.booking);
    expect(cfgOf(world).organizerPicture).toBe(PIC);

    await world.booking.savePage({ ...page, avatar: false });
    await settle(world.booking);
    // Off means gone from the worker, not merely hidden by the page view.
    expect(cfgOf(world).organizerPicture).toBe('');
    expect((await pageView(world, page.id)).organizerPicture).toBe('');
  });

  it('stops publishing once the account has no picture', async () => {
    const { world } = pictureWorld([{ state: 'found', picture: PIC }, { state: 'none' }]);
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call', avatar: true });
    await settle(world.booking);
    expect(cfgOf(world).organizerPicture).toBe(PIC);

    // The host removed it in Puter. The next read that is due says so, and the
    // page follows — but only because the answer was authoritative.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 31 * 60_000);
      await world.booking.savePage({ ...page, title: 'Intro call!' });
      await settle(world.booking);
    } finally {
      vi.useRealTimers();
    }
    expect(cfgOf(world).organizerPicture).toBe('');
  });

  it('keeps publishing what it had when a read proves nothing', async () => {
    const { world } = pictureWorld([{ state: 'found', picture: PIC }, { state: 'unknown' }]);
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call', avatar: true });
    await settle(world.booking);
    expect(cfgOf(world).organizerPicture).toBe(PIC);

    // An fs hiccup is not the host taking their picture down: a live page must
    // not lose its host's face over one failed read.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 31 * 60_000);
      await world.booking.savePage({ ...page, title: 'Intro call!' });
      await settle(world.booking);
    } finally {
      vi.useRealTimers();
    }
    expect(cfgOf(world).organizerPicture).toBe(PIC);
  });

  it('reads the profile once, not once per pass', async () => {
    const { world, readPicture } = pictureWorld({ state: 'found', picture: PIC });
    await world.store.load();
    await world.booking.start();
    await world.booking.savePage({ title: 'Intro call', avatar: true });
    await settle(world.booking);
    expect(readPicture).toHaveBeenCalledTimes(1);

    // Every calendar change runs a pass; the picture lives in the host's drive
    // and is not what changed.
    for (let i = 0; i < 3; i++) {
      await world.store.saveEvent({ title: `Standup ${i}`, start: Date.now() + HOUR, end: Date.now() + 2 * HOUR });
      await settle(world.booking);
    }
    expect(readPicture).toHaveBeenCalledTimes(1);
  });

  it('retries an inconclusive read sooner than a settled one', async () => {
    const { world, readPicture } = pictureWorld([{ state: 'unknown' }, { state: 'found', picture: PIC }]);
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Intro call', avatar: true });
    await settle(world.booking);
    expect(cfgOf(world).organizerPicture).toBe('');

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 3 * 60_000); // past the retry window, not the TTL
      await world.booking.savePage({ ...page, title: 'Intro call!' });
      await settle(world.booking);
    } finally {
      vi.useRealTimers();
    }
    expect(readPicture).toHaveBeenCalledTimes(2);
    expect(cfgOf(world).organizerPicture).toBe(PIC);
  });
});

/* ---- The host's public name ---------------------------------------------- */

describe("booking: the host's public name", () => {
  it('normalizeDisplayName makes a name fit to publish: one line, single spaces, capped', () => {
    expect(normalizeDisplayName('  Nariman   Jelveh ')).toBe('Nariman Jelveh');
    expect(normalizeDisplayName('Nariman\nJelveh\r\n')).toBe('Nariman Jelveh');
    expect(normalizeDisplayName('Nar\u0000iman\u2028J\u009f')).toBe('Nar iman J');
    expect(normalizeDisplayName('x'.repeat(200))).toHaveLength(DISPLAY_NAME_MAX);
    expect(normalizeDisplayName('   ')).toBe('');
    for (const bad of [null, undefined, 42, {}, [], true]) expect(normalizeDisplayName(bad)).toBe('');
  });

  it('guests see the username until the host picks a name — then the name, on every page, with no page re-saved', async () => {
    const world = makeWorld();
    await world.store.load();
    await world.booking.start();
    const page = await world.booking.savePage({ title: 'Coffee chat', durationMin: 30 });
    await settle(world.booking);
    const organizerOf = async () => {
      const res = await workerOf(world).call('GET', `/api/book/${page.id}`);
      expect(res.status).toBe(200);
      return (await res.json()).page.organizer;
    };
    expect(world.booking.displayName()).toBe('nariman');
    expect(await organizerOf()).toBe('nariman');

    // The setting's change is what schedules the push — nothing else moved.
    await expect(world.booking.setDisplayName('  Nariman  Jelveh ')).resolves.toBe('Nariman Jelveh');
    expect(world.store.getSettings().bookingName).toBe('Nariman Jelveh');
    await settle(world.booking);
    expect(await organizerOf()).toBe('Nariman Jelveh');

    // Back to the username — stored as '' so a later account rename is
    // followed rather than frozen — whether typed out in full or cleared.
    await world.booking.setDisplayName('nariman');
    expect(world.store.getSettings().bookingName).toBe('');
    await world.booking.setDisplayName('Someone Else');
    await world.booking.setDisplayName('   ');
    expect(world.store.getSettings().bookingName).toBe('');
    await settle(world.booking);
    expect(await organizerOf()).toBe('nariman');
  });

  it('a name set on another device is what this one publishes', async () => {
    // The setting rides in cal:settings like the rest, so a fresh load here
    // sees it — no per-device copy to drift.
    const world = makeWorld();
    world.kv.map.set('cal:settings', { bookingName: 'Nariman Jelveh' });
    await world.store.load();
    await world.booking.start();
    expect(world.booking.displayName()).toBe('Nariman Jelveh');
  });

  it('refuses offline, like every other change that must reach the worker', async () => {
    const world = makeWorld({ moduleOpts: { blocked: () => true } });
    await world.store.load();
    await world.booking.start();
    await expect(world.booking.setDisplayName('X')).rejects.toThrow(/offline/);
    expect(world.store.getSettings().bookingName).toBe('');
  });
});

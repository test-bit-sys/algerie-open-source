import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStore } from '../src/js/store.js';
import { createRsvpLinks } from '../src/js/rsvp-links.js';
import { createBooking } from '../src/js/booking.js';
import { createOfflineKv } from '../src/js/offline-store.js';
import { startOfDay } from '../src/js/date-utils.js';
import { makeKv, makeFakePuter, bridgeFetch } from './helpers/worker-harness.js';

/**
 * The booking module across more than one window of the same account — a
 * second device, a second tab — and over the offline kv wrapper the app really
 * runs on. One `cloud` (kv), one worker, several devices.
 */
const HOUR = 3_600_000;
const DAY = 86_400_000;
const HOST = { email: 'host@example.com', username: 'nariman' };
const tick = () => new Promise((r) => setTimeout(r, 5));
const devices = [];

async function settle(booking) {
  for (let i = 0; i < 4; i++) {
    await tick();
    await booking.whenIdle();
  }
}

function device(kv, fakePuter, { now = () => Date.now(), orphanGraceMs } = {}) {
  const store = createStore(kv);
  const rsvp = createRsvpLinks({
    kv,
    store,
    user: HOST,
    getPuter: () => fakePuter,
    fetchFn: vi.fn(bridgeFetch(fakePuter)),
    blocked: () => false,
    requestUser: async () => HOST,
    syncDelayMs: 0,
  });
  const toast = vi.fn();
  const booking = createBooking({
    kv,
    store,
    rsvp,
    user: HOST,
    toast,
    blocked: () => false,
    requestUser: async () => HOST,
    syncDelayMs: 0,
    pullMinMs: 0,
    pollMs: 3_600_000,
    now,
    ...(orphanGraceMs ? { orphanGraceMs } : {}),
  });
  devices.push(booking);
  return { store, rsvp, booking, toast };
}

function workerOf(cloud, fakePuter) {
  const origin = cloud.map.get('cal:rsvp:cfg').url;
  return fakePuter.workersByUrl.get(origin).instance;
}
async function guestBook(w, pageId, start, email) {
  const res = await w.call('POST', `/api/book/${pageId}`, {
    body: new URLSearchParams({ start: String(start), name: 'Ada', email, notes: '', tz: 'UTC' }).toString(),
  });
  expect(res.status).toBe(200);
  return res.json();
}
async function slots(w, pageId) {
  const res = await w.call('GET', `/api/book/${pageId}/slots`);
  return (await res.json()).slots;
}
async function recordOf(cloud, w, id) {
  const res = await w.call('GET', '/admin/booking/list', {
    headers: { authorization: `Bearer ${cloud.map.get('cal:rsvp:cfg').secret}` },
  });
  return (await res.json()).bookings.find((b) => b.id === id);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  while (devices.length) devices.pop().stop();
});

function workerBusy(cloud, fakePuter) {
  return workerOf(cloud, fakePuter).kv.map.get('bookw:cfg').busy;
}

describe('booking across two windows of one account', () => {
  it('a window that fell behind publishes busy time from the cloud, not its stale calendar', async () => {
    const cloud = makeKv();
    const fakePuter = makeFakePuter();
    const A = device(cloud, fakePuter);
    await A.store.load();
    await A.booking.start();
    const page = await A.booking.savePage({ title: 'Intro call' });
    await settle(A.booking);
    // A second window, opened once the account already has a booking link.
    const B = device(cloud, fakePuter);
    await B.store.load(); // B's calendar is read here and, on its own, never again
    await B.booking.start();
    await settle(B.booking);
    expect(workerBusy(cloud, fakePuter)).toEqual([]);

    // A puts a real meeting on the calendar tomorrow 10–11 and pushes it as busy.
    const tomorrow10 = startOfDay(new Date(Date.now() + DAY)).getTime() + 10 * HOUR;
    await A.store.saveEvent({ title: 'Real meeting', start: tomorrow10, end: tomorrow10 + HOUR });
    await settle(A.booking);
    expect(workerBusy(cloud, fakePuter)).toEqual([[tomorrow10, tomorrow10 + HOUR]]);

    // A renames the page — any page edit, or the day rolling over, will do.
    await A.booking.savePage({ id: page.id, title: 'Discovery call' });
    await settle(A.booking);
    expect(B.store.getAllEvents()).toHaveLength(0); // B, on its own, still knows nothing

    // B's next pass: the authoritative page reload sees the rename, its digest
    // differs, and it pushes. That push must carry A's meeting.
    await B.booking.refresh();
    await settle(B.booking);
    expect(workerBusy(cloud, fakePuter)).toEqual([[tomorrow10, tomorrow10 + HOUR]]);
  });

  it("adopts a booking's event another window created instead of writing a fresh one over it", async () => {
    const cloud = makeKv();
    const fakePuter = makeFakePuter();
    const A = device(cloud, fakePuter);
    const B = device(cloud, fakePuter);
    await A.store.load();
    await B.store.load();
    await A.booking.start();
    const page = await A.booking.savePage({ title: 'Intro call', minNoticeMin: 0, maxAdvanceDays: 7 });
    await settle(A.booking);
    await B.booking.start();
    await settle(B.booking);
    const w = workerOf(cloud, fakePuter);
    const [s1] = await slots(w, page.id);
    const X = (await guestBook(w, page.id, s1, 'x@example.com')).booking;

    // A applies the booking and the host edits its event on A (a longer title).
    await A.booking.refresh();
    await settle(A.booking);
    await A.store.saveEvent({ id: X.id, title: 'Ada — Intro call (prep the deck)' });
    expect(cloud.map.get('cal:evt:' + X.id).title).toBe('Ada — Intro call (prep the deck)');

    // B's pull: no local event, no applied entry it knows of. It must look at
    // the cloud and adopt A's event, not overwrite it from the booking record.
    await B.booking.refresh();
    await settle(B.booking);
    expect(cloud.map.get('cal:evt:' + X.id).title).toBe('Ada — Intro call (prep the deck)');
    expect(B.store.getEvent(X.id).title).toBe('Ada — Intro call (prep the deck)');
  });
});

describe('booking over the offline kv wrapper', () => {
  it('the orphan net does not cancel on a cloud look the snapshot answered', async () => {
    const cloud = makeKv();
    const fakePuter = makeFakePuter();
    let offset = 0;
    // Device A is the real app shape: the store over the offline wrapper.
    const wrapped = createOfflineKv(cloud);
    wrapped.ensureUser('u1');
    const A = device(wrapped, fakePuter, { now: () => Date.now() + offset });
    const B = device(cloud, fakePuter); // the host's other window
    await A.store.load(); // writes the local snapshot
    await B.store.load();
    await A.booking.start();
    const page = await A.booking.savePage({ title: 'Intro call', minNoticeMin: 0, maxAdvanceDays: 7 });
    await settle(A.booking);
    await B.booking.start();
    await settle(B.booking);
    const w = workerOf(cloud, fakePuter);
    const [s1, s2] = await slots(w, page.id);

    // Y is applied by A; X only by B, so A's calendar never learns of X's event.
    const Y = (await guestBook(w, page.id, s1, 'y@example.com')).booking;
    await A.booking.refresh();
    await settle(A.booking);
    const X = (await guestBook(w, page.id, s2, 'x@example.com')).booking;
    await B.booking.refresh();
    await settle(B.booking);
    expect(cloud.map.get('cal:evt:' + X.id)).toBeTruthy();
    expect(A.store.getEvent(X.id)).toBeNull();

    // Cancelling Y on A merges B's entry for X into A's map: X is "applied"
    // on A with no event in A's calendar — exactly what the orphan net exists
    // to look into.
    await A.booking.cancelBooking(Y.id);

    // puter.kv now fails from A (a 429, a blip) while the worker stays
    // reachable. Nothing sets isBlocked(), so passes run; the wrapper answers
    // every list from the snapshot, which cannot contain X's event.
    cloud.list.mockImplementation(async () => {
      throw new Error('kv unavailable');
    });
    await A.booking.refresh();
    await settle(A.booking);
    offset += 10 * 60_000 + 1; // the grace elapses with kv still failing
    await A.booking.refresh();
    await settle(A.booking);

    // A read that fails is a reason to wait, never to guess in this direction.
    expect((await recordOf(cloud, w, X.id)).status).toBe('confirmed');
    expect(cloud.map.get('cal:evt:' + X.id)).toBeTruthy();
    expect(A.toast).not.toHaveBeenCalledWith(expect.stringMatching(/^Cancelled/));
  });

  it("loadState treats a snapshot-answered read as failed, so a first-session device can't resurrect a deleted booking", async () => {
    const cloud = makeKv();
    const fakePuter = makeFakePuter();
    const B = device(cloud, fakePuter);
    await B.store.load();
    await B.booking.start();
    const page = await B.booking.savePage({ title: 'Intro call', minNoticeMin: 0, maxAdvanceDays: 7 });
    await settle(B.booking);
    const w = workerOf(cloud, fakePuter);
    const [s1] = await slots(w, page.id);
    const X = (await guestBook(w, page.id, s1, 'x@example.com')).booking;
    await B.booking.refresh();
    await settle(B.booking);
    // The host deletes the event by hand on B (the orphan grace has not elapsed).
    await B.store.deleteEvent(X.id);
    expect(cloud.map.has('cal:evt:' + X.id)).toBe(false);

    // A new device: the store loads (so a snapshot exists), then its one read
    // of the applied map glitches. The wrapper answers null — "never took a
    // booking" — which the pull would read as licence to create X's event.
    const wrapped = createOfflineKv(cloud);
    wrapped.ensureUser('u1');
    const A = device(wrapped, fakePuter);
    await A.store.load();
    const realGet = cloud.get.getMockImplementation();
    let glitched = false;
    cloud.get.mockImplementation(async (key) => {
      if (key === 'cal:book:state' && !glitched) {
        glitched = true;
        throw new Error('kv unavailable');
      }
      return realGet(key);
    });
    await A.booking.start();
    await settle(A.booking);
    expect(glitched).toBe(true);
    expect(cloud.map.has('cal:evt:' + X.id)).toBe(false);

    // The next pass reads the real map and carries on normally.
    await A.booking.refresh();
    await settle(A.booking);
    expect(cloud.map.has('cal:evt:' + X.id)).toBe(false);
    expect(A.booking.getPages().map((p) => p.id)).toEqual([page.id]);
  });
});

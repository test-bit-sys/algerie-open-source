import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { instantiateWorker, makeKv, sha256Hex } from './helpers/worker-harness.js';

const RAW = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/workers/rsvp-worker.js'),
  'utf8',
);

const SECRET = 'test-admin-secret';
const AUTH = { authorization: `Bearer ${SECRET}` };
const PAGE_URL = 'https://app.test/rsvp.html';
const HOUR = 3_600_000;
const DAY = 86_400_000;

// Frozen "now": Monday 2027-01-04 00:00 UTC — a deterministic anchor for every
// availability computation in this file.
const NOW = Date.UTC(2027, 0, 4, 0, 0, 0);

async function loadWorker({ email, authToken } = {}) {
  const source = RAW.replace('__RSVP_ADMIN_SECRET_HASH__', await sha256Hex(SECRET))
    .replace('__RSVP_WORKER_VERSION__', 'test')
    .replace('__RSVP_PAGE_URL__', PAGE_URL);
  const kv = makeKv();
  const me = { puter: { kv, ...(email ? { email } : {}), ...(authToken ? { authToken } : {}) } };
  return instantiateWorker(source, { kv, me });
}

function pageDef(overrides = {}) {
  return {
    id: 'abcd1234',
    title: 'Intro call',
    description: 'A quick hello',
    location: 'Video call',
    durationMin: 60,
    incrementMin: 60,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    minNoticeMin: 0,
    maxAdvanceDays: 30,
    maxPerDay: 0,
    tz: 'UTC',
    hours: { 1: [{ start: 540, end: 1020 }] }, // Mondays 9:00–17:00
    enabled: true,
    ...overrides,
  };
}

async function syncBooking(worker, { pages = [pageDef()], busy = [], ...rest } = {}) {
  const res = await worker.call('POST', '/admin/booking/sync', {
    headers: AUTH,
    json: {
      pages,
      busy,
      organizerName: 'Nariman',
      organizerEmail: 'host@example.com',
      hour12: true,
      ...rest,
    },
  });
  expect(res.status).toBe(200);
  return res.json();
}

async function getSlots(worker, pageId, from, to) {
  const res = await worker.call('GET', `/api/book/${pageId}/slots?from=${from}&to=${to}`);
  expect(res.status).toBe(200);
  return (await res.json()).slots;
}

async function book(worker, pageId, fields) {
  return worker.call('POST', `/api/book/${pageId}`, {
    body: new URLSearchParams({
      start: String(fields.start),
      name: fields.name ?? 'Ada Lovelace',
      email: fields.email ?? 'ada@example.com',
      notes: fields.notes ?? '',
      tz: fields.tz ?? 'Europe/London',
    }).toString(),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('booking worker: admin', () => {
  it('rejects booking admin routes without the bearer secret', async () => {
    const worker = await loadWorker();
    for (const [method, route] of [
      ['POST', '/admin/booking/sync'],
      ['GET', '/admin/booking/list'],
      ['POST', '/admin/booking/cancel'],
    ]) {
      const res = await worker.call(method, route, { json: method === 'POST' ? {} : undefined });
      expect(res.status, route).toBe(401);
    }
  });

  it('sanitizes the synced config: bad pages dropped, busy merged and ordered', async () => {
    const worker = await loadWorker();
    const out = await syncBooking(worker, {
      pages: [
        pageDef(),
        { id: 'BAD ID!', title: 'nope' }, // invalid id — dropped
        pageDef({ id: 'zz990011', durationMin: 100000, hours: { 2: [{ start: 900, end: 300 }] } }),
      ],
      busy: [
        [NOW + 10 * HOUR, NOW + 11 * HOUR],
        [NOW + 2 * HOUR, NOW + 4 * HOUR],
        [NOW + 3 * HOUR, NOW + 5 * HOUR], // overlaps the previous — merged
        ['x', 'y'], // garbage — dropped
      ],
    });
    expect(out.pages).toBe(2);
    expect(out.busy).toBe(2);
    const cfg = worker.kv.map.get('bookw:cfg');
    expect(cfg.pages.zz990011.durationMin).toBe(720); // clamped
    expect(cfg.pages.zz990011.hours).toEqual({}); // inverted interval dropped
    expect(cfg.busy).toEqual([
      [NOW + 2 * HOUR, NOW + 5 * HOUR],
      [NOW + 10 * HOUR, NOW + 11 * HOUR],
    ]);
  });
});

describe('booking worker: slots', () => {
  it('serves the weekly windows as slots, honoring duration and increment', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const slots = await getSlots(worker, 'abcd1234', NOW, NOW + DAY);
    // Monday 9:00–17:00 UTC, 60-min slots stepping hourly: 9:00 … 16:00.
    expect(slots).toEqual(
      Array.from({ length: 8 }, (_, i) => Date.UTC(2027, 0, 4, 9 + i)),
    );
  });

  it('applies minimum notice and the rolling horizon', async () => {
    const worker = await loadWorker();
    await syncBooking(worker, {
      pages: [pageDef({ minNoticeMin: 11 * 60, maxAdvanceDays: 7 })],
    });
    const today = await getSlots(worker, 'abcd1234', NOW, NOW + DAY);
    // Slots before 11:00 UTC (now + 11h) are gone.
    expect(today[0]).toBe(Date.UTC(2027, 0, 4, 11));
    // Next Monday (Jan 11) is day 7 — the last within the 7-day horizon at
    // exactly the boundary; the Monday after (Jan 18) must not appear.
    const twoWeeks = await getSlots(worker, 'abcd1234', NOW + DAY, NOW + 20 * DAY);
    expect(twoWeeks.every((ms) => ms <= NOW + 7 * DAY)).toBe(true);
  });

  it('subtracts busy intervals, padded by the buffers', async () => {
    const worker = await loadWorker();
    // Busy 11:00–12:00; buffers 30 before / 30 after each new meeting.
    await syncBooking(worker, {
      pages: [pageDef({ bufferBeforeMin: 30, bufferAfterMin: 30 })],
      busy: [[Date.UTC(2027, 0, 4, 11), Date.UTC(2027, 0, 4, 12)]],
    });
    const slots = await getSlots(worker, 'abcd1234', NOW, NOW + DAY);
    // 10:00 (padded to 9:30–11:30) collides; 11:00 collides; 12:00 (11:30–13:30)
    // collides with the busy block's end;  9:00 (8:30–10:30) is fine.
    expect(slots).toContain(Date.UTC(2027, 0, 4, 9));
    expect(slots).not.toContain(Date.UTC(2027, 0, 4, 10));
    expect(slots).not.toContain(Date.UTC(2027, 0, 4, 11));
    expect(slots).toContain(Date.UTC(2027, 0, 4, 13));
  });

  it('computes windows in the page time zone, correctly across a DST change', async () => {
    vi.setSystemTime(Date.UTC(2027, 2, 8, 0, 0, 0)); // Monday, a week before US DST starts
    const worker = await loadWorker();
    await syncBooking(worker, {
      pages: [
        pageDef({ tz: 'America/New_York', hours: { 1: [{ start: 540, end: 600 }] } }), // Mondays 9–10 local
      ],
    });
    const from = Date.UTC(2027, 2, 8);
    const slots = await getSlots(worker, 'abcd1234', from, from + 9 * DAY);
    expect(slots).toEqual([
      Date.UTC(2027, 2, 8, 14), // 9 AM EST
      Date.UTC(2027, 2, 15, 13), // 9 AM EDT — the hour moved with the zone
    ]);
  });

  it('offers the configured wall clock ON a DST transition day, in both directions', async () => {
    vi.setSystemTime(Date.UTC(2027, 2, 12, 20, 0)); // Friday before US spring forward
    const worker = await loadWorker();
    const tz = 'America/Los_Angeles';
    // Sundays 08:00–11:00 local — the hours a single-pass offset conversion
    // slid an hour, so 08:00 and 08:30 vanished and 09:00 was listed twice.
    await syncBooking(worker, {
      pages: [
        pageDef({
          durationMin: 30,
          incrementMin: 30,
          tz,
          hours: { 0: [{ start: 8 * 60, end: 11 * 60 }] },
          maxAdvanceDays: 90,
        }),
      ],
    });
    const wall = (ms) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(ms));

    // Spring forward: 2027-03-14 (the clock jumps 02:00 -> 03:00).
    const spring = await getSlots(worker, 'abcd1234', Date.UTC(2027, 2, 14), Date.UTC(2027, 2, 15));
    expect(spring.map(wall)).toEqual([
      '2027-03-14, 08:00',
      '2027-03-14, 08:30',
      '2027-03-14, 09:00',
      '2027-03-14, 09:30',
      '2027-03-14, 10:00',
      '2027-03-14, 10:30',
    ]);

  });

  it('offers the configured wall clock ON a fall-back day too (the other direction)', async () => {
    vi.setSystemTime(Date.UTC(2027, 10, 5, 20, 0)); // Friday before US fall back
    const worker = await loadWorker();
    const tz = 'America/Los_Angeles';
    await syncBooking(worker, {
      pages: [
        pageDef({
          durationMin: 30,
          incrementMin: 30,
          tz,
          hours: { 0: [{ start: 8 * 60, end: 11 * 60 }] },
        }),
      ],
    });
    const wall = (ms) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(ms));
    const fall = await getSlots(worker, 'abcd1234', Date.UTC(2027, 10, 7), Date.UTC(2027, 10, 8));
    expect(fall.map(wall)).toEqual([
      '2027-11-07, 08:00',
      '2027-11-07, 08:30',
      '2027-11-07, 09:00',
      '2027-11-07, 09:30',
      '2027-11-07, 10:00',
      '2027-11-07, 10:30',
    ]);
  });

  it('resolves a nonexistent spring-forward hour forward, never outside the window', async () => {
    vi.setSystemTime(Date.UTC(2027, 2, 12, 20, 0));
    const worker = await loadWorker();
    const tz = 'America/New_York';
    // 01:00–04:00 local on the day 02:00 does not exist.
    await syncBooking(worker, {
      pages: [
        pageDef({
          durationMin: 60,
          incrementMin: 60,
          tz,
          hours: { 0: [{ start: 60, end: 4 * 60 }] },
        }),
      ],
    });
    const slots = await getSlots(worker, 'abcd1234', Date.UTC(2027, 2, 14), Date.UTC(2027, 2, 15));
    // 01:00 EST, then the skipped 02:00 lands on 03:00 EDT, which 03:00 also
    // asks for — one instant, offered once, and nothing before 01:00 or after
    // the window's 04:00 end.
    expect(slots).toEqual([Date.UTC(2027, 2, 14, 6), Date.UTC(2027, 2, 14, 7)]);
  });

  it('resolves the spring-forward gap forward east of UTC too, and fall-back to the first occurrence', async () => {
    vi.setSystemTime(Date.UTC(2027, 2, 20, 20, 0));
    const worker = await loadWorker();
    // Berlin: 02:00 does not exist on Sun 28 Mar 2027 (clocks go 02:00 → 03:00 at 01:00Z).
    // A 02:00–04:00 window must offer 03:00 CEST only — never 01:00 CET, an
    // hour before the host said they were free.
    await syncBooking(worker, {
      pages: [
        pageDef({ durationMin: 60, incrementMin: 60, tz: 'Europe/Berlin', hours: { 0: [{ start: 120, end: 240 }] } }),
      ],
    });
    const slots = await getSlots(worker, 'abcd1234', Date.UTC(2027, 2, 27), Date.UTC(2027, 2, 29));
    expect(slots).toEqual([Date.UTC(2027, 2, 28, 1)]); // 03:00 CEST
    // Fall-back, Sun 31 Oct 2027: 02:00–03:00 CET exists twice; the window's
    // 02:00 start is its FIRST occurrence (00:00Z, CEST), as in New York.
    vi.setSystemTime(Date.UTC(2027, 9, 25, 20, 0));
    const fall = await getSlots(worker, 'abcd1234', Date.UTC(2027, 9, 30), Date.UTC(2027, 10, 1));
    expect(fall[0]).toBe(Date.UTC(2027, 9, 31, 0));
  });

  it('keeps each page in its own zone when several share a worker (formatter cache)', async () => {
    const worker = await loadWorker();
    await syncBooking(worker, {
      pages: [
        pageDef({ id: 'nyc12345', tz: 'America/New_York', hours: { 1: [{ start: 540, end: 600 }] } }),
        pageDef({ id: 'tok12345', tz: 'Asia/Tokyo', hours: { 1: [{ start: 540, end: 600 }] } }),
      ],
    });
    const from = Date.UTC(2027, 0, 4);
    // Mondays 9–10 in each page's OWN zone: EST is UTC-5, JST is UTC+9. The
    // engine reuses one wall-clock formatter per zone, so a mixed-zone worker
    // is where a mis-keyed cache would show up.
    expect(await getSlots(worker, 'nyc12345', from, from + DAY)).toEqual([Date.UTC(2027, 0, 4, 14)]);
    expect(await getSlots(worker, 'tok12345', from, from + DAY)).toEqual([Date.UTC(2027, 0, 4, 0)]);
  });

  it('404s an unknown page and 410s a disabled one', async () => {
    const worker = await loadWorker();
    await syncBooking(worker, { pages: [pageDef({ enabled: false })] });
    expect((await worker.call('GET', '/api/book/nope1234')).status).toBe(404);
    expect((await worker.call('GET', '/api/book/abcd1234')).status).toBe(410);
    expect((await worker.call('GET', '/api/book/abcd1234/slots?from=1&to=2')).status).toBe(410);
    expect((await book(worker, 'abcd1234', { start: NOW + 9 * HOUR })).status).toBe(410);
  });

  it('defaults the slots window when from/to are absent (Number(null) is 0 — regression)', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const res = await worker.call('GET', '/api/book/abcd1234/slots');
    expect(res.status).toBe(200);
    const { slots } = await res.json();
    // The default 31-day window covers several Mondays of 9–17 slots.
    expect(slots.length).toBeGreaterThan(8);
    expect(slots[0]).toBe(Date.UTC(2027, 0, 4, 9));
  });

  it('treats incrementMin 0 as "same as duration", never the 5-minute floor', async () => {
    const worker = await loadWorker();
    await syncBooking(worker, { pages: [pageDef({ incrementMin: 0 })] });
    const slots = await getSlots(worker, 'abcd1234', NOW, NOW + DAY);
    expect(slots).toHaveLength(8); // hourly, not every 5 minutes
  });

  it('reports the first available slot on the page view', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const res = await worker.call('GET', '/api/book/abcd1234');
    const data = await res.json();
    expect(data.page.title).toBe('Intro call');
    expect(data.page.organizer).toBe('Nariman');
    expect(data.firstAvailable).toBe(Date.UTC(2027, 0, 4, 9));
  });
});

describe("booking worker: the host's picture", () => {
  const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

  async function pageView(worker, id = 'abcd1234') {
    const res = await worker.call('GET', `/api/book/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()).page;
  }

  it('serves the picture only to the pages that asked for it', async () => {
    const worker = await loadWorker();
    await syncBooking(worker, {
      pages: [pageDef({ id: 'shown123', avatar: true }), pageDef({ id: 'hidden12' })],
      organizerPicture: PIC,
    });
    expect((await pageView(worker, 'shown123')).organizerPicture).toBe(PIC);
    // Absent means off, so a page pushed by an app that predates the field
    // never publishes its host's face.
    expect((await pageView(worker, 'hidden12')).organizerPicture).toBe('');
  });

  it('has nothing to serve when the host published no picture', async () => {
    const worker = await loadWorker();
    await syncBooking(worker, { pages: [pageDef({ avatar: true })] });
    expect((await pageView(worker)).organizerPicture).toBe('');
  });

  it('keeps only inline image data — never a URL, markup, or a huge one', async () => {
    const worker = await loadWorker();
    for (const bad of [
      'https://tracker.example/pixel.png',
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      // Percent-encoded SVG: an <img src> renders it, so it is markup we would
      // be handing a guest's browser.
      'data:image/svg+xml,%3Csvg%20onload%3Dalert(1)%3E',
      'data:image/png;base64,not valid base64!',
      'data:image/png;base64,' + 'A'.repeat(97 * 1024),
      42,
      null,
    ]) {
      await syncBooking(worker, { pages: [pageDef({ avatar: true })], organizerPicture: bad });
      expect((await pageView(worker)).organizerPicture, String(bad).slice(0, 40)).toBe('');
    }
    // …and the real thing still gets through afterwards.
    await syncBooking(worker, { pages: [pageDef({ avatar: true })], organizerPicture: PIC });
    expect((await pageView(worker)).organizerPicture).toBe(PIC);
  });

  it('drops the picture when a later sync stops sending one', async () => {
    const worker = await loadWorker();
    await syncBooking(worker, { pages: [pageDef({ avatar: true })], organizerPicture: PIC });
    expect((await pageView(worker)).organizerPicture).toBe(PIC);
    await syncBooking(worker, { pages: [pageDef({ avatar: true })] });
    expect((await pageView(worker)).organizerPicture).toBe('');
  });

  it('keeps the picture off the disabled-page and manage replies', async () => {
    const worker = await loadWorker();
    await syncBooking(worker, { pages: [pageDef({ avatar: true })], organizerPicture: PIC });
    const booked = await (await book(worker, 'abcd1234', { start: NOW + 9 * HOUR })).json();
    // The manage view is the guest's own booking, not the host's page: it
    // carries the organizer's name, and nothing this feature added.
    const manage = await (await worker.call('GET', `/api/booking/${booked.token}`)).json();
    expect(manage.booking.organizer).toBe('Nariman');
    expect(JSON.stringify(manage)).not.toContain(PIC);

    await syncBooking(worker, { pages: [pageDef({ avatar: true, enabled: false })], organizerPicture: PIC });
    const off = await worker.call('GET', '/api/book/abcd1234');
    expect(off.status).toBe(410);
    expect(JSON.stringify(await off.json())).not.toContain(PIC);
  });
});

describe('booking worker: booking', () => {
  it('books a listed slot, hides it from the grid, and serves the manage view', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const start = Date.UTC(2027, 0, 4, 9);
    const res = await book(worker, 'abcd1234', { start, notes: 'Looking forward!' });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.ok).toBe(true);
    expect(out.token).toMatch(/^[0-9a-f]{40}$/);
    expect(out.booking.start).toBe(start);
    expect(out.booking.title).toBe('Intro call');
    expect(out.booking.canCancel).toBe(true);
    expect(out.emailed).toEqual({ guest: false, host: false }); // no mailer in this runtime

    const slots = await getSlots(worker, 'abcd1234', NOW, NOW + DAY);
    expect(slots).not.toContain(start);

    const manage = await worker.call('GET', `/api/booking/${out.token}`);
    expect(manage.status).toBe(200);
    const view = await manage.json();
    expect(view.booking.email).toBe('ada@example.com');
    expect(view.booking.status).toBe('confirmed');
    // The token hash never leaves the worker.
    expect(JSON.stringify(view)).not.toContain('tokenHash');
  });

  it('validates the request: name, email, and a slot on the grid', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const start = Date.UTC(2027, 0, 4, 9);
    expect((await book(worker, 'abcd1234', { start, name: '  ' })).status).toBe(400);
    expect((await book(worker, 'abcd1234', { start, email: 'not-an-email' })).status).toBe(400);
    // 9:30 is between the hourly increments — never offered, so invalid.
    const off = await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9, 30) });
    expect(off.status).toBe(400);
    expect((await off.json()).error).toBe('invalid_slot');
    // Sunday is outside the weekly hours.
    const sunday = await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 10, 9) });
    expect(sunday.status).toBe(400);
  });

  it('answers 400 invalid_slot for a start beyond the Date range, not a crash', async () => {
    // 9e15 is finite but past Date's ±8.64e15 limit; unchecked it reaches
    // Intl.DateTimeFormat inside the slot engine and throws a RangeError.
    const worker = await loadWorker();
    await syncBooking(worker);
    for (const start of [9e15, -9e15, Number.MAX_SAFE_INTEGER]) {
      const res = await book(worker, 'abcd1234', { start });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_slot');
    }
    // Merely past the horizon (but a representable instant) is also a 400.
    const past = await book(worker, 'abcd1234', { start: NOW - 7 * DAY });
    expect(past.status).toBe(400);
    expect((await past.json()).error).toBe('invalid_slot');
  });

  it('a page named after an Object.prototype key is not found, not "off"', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    // `constructor` fits the page-id shape; a plain-object lookup would find
    // Object's and answer 410 page_off — with the host's name — for a page
    // that never existed.
    for (const path of ['/api/book/constructor', '/api/book/constructor/slots']) {
      const res = await worker.call('GET', path);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    const post = await book(worker, 'constructor', { start: Date.UTC(2027, 0, 4, 9) });
    expect(post.status).toBe(404);
    // The real page is unaffected.
    expect((await worker.call('GET', '/api/book/abcd1234')).status).toBe(200);
  });

  it('refuses a sync with no usable body rather than publishing an empty config', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    for (const body of ['not json', '', '[]', '"pages"', 'null']) {
      const res = await worker.call('POST', '/admin/booking/sync', { headers: AUTH, body });
      expect(res.status).toBe(400);
    }
    // The live config — and every link pointing at it — is untouched.
    expect((await worker.call('GET', '/api/book/abcd1234')).status).toBe(200);
    // Clearing on purpose still works: that arrives as an object.
    expect((await syncBooking(worker, { pages: [] })).pages).toBe(0);
    expect((await worker.call('GET', '/api/book/abcd1234')).status).toBe(404);
  });

  it('answers a slots request without a read per stored booking', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    // Records are kept for months after their meeting, so a page that has
    // been booked a few hundred times must not turn every anonymous request
    // for its free times into a few hundred storage round-trips.
    for (let i = 0; i < 120; i++) {
      const id = i.toString(16).padStart(32, '0');
      worker.kv.map.set(`bookw:bkg:${id}`, {
        id,
        pageId: 'abcd1234',
        pageTitle: 'Intro call',
        durationMin: 60,
        start: Date.UTC(2027, 0, 11 + (i % 5), 9 + (i % 8)),
        end: Date.UTC(2027, 0, 11 + (i % 5), 10 + (i % 8)),
        name: `Guest ${i}`,
        email: `guest${i}@example.com`,
        status: 'confirmed',
        createdAt: NOW - HOUR,
        updatedAt: NOW - HOUR,
        tokenHash: 'x',
      });
    }
    worker.kv.get.mockClear();
    worker.kv.list.mockClear();
    const slots = await getSlots(worker, 'abcd1234', Date.UTC(2027, 0, 11), Date.UTC(2027, 0, 16));
    // Monday 11th 9–17 offers eight hours; guests 0,5,10,… hold 9,10,…,16 → all taken.
    expect(slots.filter((ms) => ms < Date.UTC(2027, 0, 12))).toEqual([]);
    expect(worker.kv.get.mock.calls.length).toBeLessThanOrEqual(1); // the page config
    expect(worker.kv.list.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('re-lists bookings in shards when the flat list is heavy, even if short', async () => {
    // puter.kv.list truncates by payload size as well as by count. Three
    // hundred records with long notes weigh more than the trusted budget, so
    // the flat answer cannot be taken as the whole set — and a confirmed
    // booking it dropped would be offered to the next guest.
    const worker = await loadWorker();
    await syncBooking(worker);
    for (let i = 0; i < 300; i++) {
      const id = i.toString(16).padStart(32, '0');
      worker.kv.map.set(`bookw:bkg:${id}`, {
        id,
        pageId: 'abcd1234',
        pageTitle: 'Intro call',
        durationMin: 60,
        start: Date.UTC(2027, 5, 1 + (i % 20), 9 + (i % 8)),
        end: Date.UTC(2027, 5, 1 + (i % 20), 10 + (i % 8)),
        name: `Guest ${i}`,
        email: `guest${i}@example.com`,
        notes: 'x'.repeat(2000),
        status: 'confirmed',
        createdAt: NOW - HOUR,
        updatedAt: NOW - HOUR,
        tokenHash: 'x',
      });
    }
    worker.kv.list.mockClear();
    const res = await worker.call('GET', '/admin/booking/list', { headers: AUTH });
    expect(res.status).toBe(200);
    expect((await res.json()).bookings).toHaveLength(300);
    const patterns = worker.kv.list.mock.calls.map((c) => c[0]);
    expect(patterns).toContain('bookw:bkg:*');
    for (const c of '0123456789abcdef') expect(patterns).toContain(`bookw:bkg:${c}*`);
  });

  it('refuses a second booking of the same slot with slot_taken', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const start = Date.UTC(2027, 0, 4, 9);
    expect((await book(worker, 'abcd1234', { start })).status).toBe(200);
    const second = await book(worker, 'abcd1234', { start, email: 'other@example.com' });
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe('slot_taken');
  });

  it('never confirms two guests for one slot, even when the older request writes last', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const start = Date.UTC(2027, 0, 4, 9);

    // Stall the FIRST reservation write, so the request that started earlier
    // finishes last — the interleaving that used to confirm both, because the
    // "older booking wins" tie-break only settles a race the younger racer
    // can see, and it never saw one.
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    let stalled = false;
    const realSet = worker.kv.set.getMockImplementation();
    worker.kv.set.mockImplementation(async (key, value) => {
      if (typeof key === 'string' && key.startsWith('bookw:bkg:') && !stalled) {
        stalled = true;
        await gate;
      }
      return realSet(key, value);
    });

    const older = book(worker, 'abcd1234', { start, email: 'older@example.com' });
    await Promise.resolve();
    await Promise.resolve();
    vi.setSystemTime(NOW + 5_000); // the second request is the YOUNGER one
    const younger = await book(worker, 'abcd1234', { start, email: 'younger@example.com' });
    release();
    const olderRes = await older;

    const statuses = [olderRes.status, younger.status].sort();
    expect(statuses).toEqual([200, 409]);
    const confirmed = [...worker.kv.map.keys()]
      .filter((k) => k.startsWith('bookw:bkg:'))
      .map((k) => worker.kv.map.get(k))
      .filter((b) => b.status === 'confirmed');
    expect(confirmed).toHaveLength(1);
    // The loser leaves nothing behind: no token pointer, no dangling claim.
    expect([...worker.kv.map.keys()].filter((k) => k.startsWith('bookw:tok:'))).toHaveLength(1);
    const held = worker.kv.map.get(`bookw:slot:${start}`);
    expect(held.bookingId).toBe(confirmed[0].id);
  });

  it('an off-grid start is refused without writing anything', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    worker.kv.set.mockClear();
    // 9:17 on a page that only offers the hour — a stale page, or a hand-made
    // request. It must not cost a reservation to say no.
    const res = await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9, 17) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_slot');
    expect(worker.kv.set).not.toHaveBeenCalled();
    expect([...worker.kv.map.keys()].filter((k) => k.startsWith('bookw:'))).toEqual(['bookw:cfg']);
  });

  it('hands a resubmitting guest their own booking back, not slot_taken', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const start = Date.UTC(2027, 0, 4, 9);
    const first = await book(worker, 'abcd1234', { start });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    // Same guest, same slot: the reply to their first press went missing, so
    // they pressed Schedule again. They hold this booking — say so.
    const again = await book(worker, 'abcd1234', { start });
    expect(again.status).toBe(200);
    const body = await again.json();
    expect(body.duplicate).toBe(true);
    expect(body.booking.id).toBe(firstBody.booking.id);
    expect(body.token).toBeUndefined(); // only its hash is stored
    expect(body.emailed).toEqual({ guest: false, host: false });
    // And exactly one booking exists.
    expect([...worker.kv.map.keys()].filter((k) => k.startsWith('bookw:bkg:'))).toHaveLength(1);
  });

  it('never answers a same-guest double-submit with a booking that is about to vanish', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const start = Date.UTC(2027, 0, 4, 9);

    // Two presses from the SAME guest land together (two tabs, or a retry
    // overtaking a slow first request). Hold every availability read until
    // both reservations are written, and every rollback until both requests
    // have read, so each request sees the other's reservation standing — the
    // interleaving in which both used to yield AND both answered "you already
    // hold this booking", each pointing at the record the other was in the
    // middle of rolling back.
    const isBooking = (key) => typeof key === 'string' && key.startsWith('bookw:bkg:');
    let reserved;
    const bothReserved = new Promise((resolve) => (reserved = resolve));
    let read;
    const bothRead = new Promise((resolve) => (read = resolve));
    let reservations = 0;
    let reads = 0;
    const realSet = worker.kv.set.getMockImplementation();
    const realList = worker.kv.list.getMockImplementation();
    const realDel = worker.kv.del.getMockImplementation();
    worker.kv.set.mockImplementation(async (key, value) => {
      const out = await realSet(key, value);
      if (isBooking(key) && ++reservations === 2) reserved();
      return out;
    });
    worker.kv.list.mockImplementation(async (pattern, values) => {
      if (pattern === 'bookw:bkg:*') await bothReserved;
      const out = await realList(pattern, values);
      if (pattern === 'bookw:bkg:*' && ++reads === 2) read();
      return out;
    });
    worker.kv.del.mockImplementation(async (key) => {
      if (isBooking(key)) await bothRead;
      return realDel(key);
    });

    const replies = await Promise.all([book(worker, 'abcd1234', { start }), book(worker, 'abcd1234', { start })]);
    const bodies = await Promise.all(replies.map((r) => r.json()));
    const stored = [...worker.kv.map.keys()]
      .filter((k) => k.startsWith('bookw:bkg:'))
      .map((k) => worker.kv.map.get(k))
      .filter((b) => b.status === 'confirmed');

    // Whatever each reply says, it must be TRUE: a booking it hands back exists,
    // and nothing confirms the guest twice.
    expect(stored.length).toBeLessThanOrEqual(1);
    for (const [i, body] of bodies.entries()) {
      if (replies[i].status === 200) {
        expect(body.ok).toBe(true);
        expect(stored.map((b) => b.id)).toContain(body.booking.id);
      } else {
        expect(replies[i].status).toBe(409);
        expect(body.error).toBe('slot_taken');
      }
    }

    // And the press-again both were told to make settles it: the guest holds
    // exactly one booking, and a further press gets that one back.
    worker.kv.list.mockImplementation(realList);
    worker.kv.set.mockImplementation(realSet);
    worker.kv.del.mockImplementation(realDel);
    const again = await book(worker, 'abcd1234', { start });
    expect(again.status).toBe(200);
    const body = await again.json();
    const confirmed = [...worker.kv.map.keys()]
      .filter((k) => k.startsWith('bookw:bkg:'))
      .map((k) => worker.kv.map.get(k))
      .filter((b) => b.status === 'confirmed');
    expect(confirmed).toHaveLength(1);
    expect(body.booking.id).toBe(confirmed[0].id);
    // A committed booking carries no trace of its reservation phase.
    expect(confirmed[0].pending).toBeUndefined();
  });

  it('a stale reservation mark does not lock a guest out of their own booking', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const start = Date.UTC(2027, 0, 4, 9);
    // The request that reserved this booking died before clearing `pending`
    // (say the runtime was recycled mid-request). Long after any request could
    // still be running, the record is the booking it says it is — a resubmit
    // gets it back rather than "slot_taken" forever.
    worker.kv.map.set('bookw:bkg:deadbeefdeadbeefdeadbeefdeadbeef', {
      id: 'deadbeefdeadbeefdeadbeefdeadbeef',
      pageId: 'abcd1234',
      pageTitle: 'Intro call',
      durationMin: 60,
      start,
      end: start + HOUR,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      status: 'confirmed',
      createdAt: NOW - 10 * 60_000,
      updatedAt: NOW - 10 * 60_000,
      tokenHash: 'x',
      pending: true,
    });
    const again = await book(worker, 'abcd1234', { start });
    expect(again.status).toBe(200);
    const body = await again.json();
    expect(body.duplicate).toBe(true);
    expect(body.booking.id).toBe('deadbeefdeadbeefdeadbeefdeadbeef');
    // The admin view never shows the mark.
    const list = await worker.call('GET', '/admin/booking/list', { headers: AUTH });
    const listed = (await list.json()).bookings || [];
    expect(listed.length).toBeGreaterThan(0);
    for (const b of listed) expect(b.pending).toBeUndefined();
  });

  it('does not list a reservation that is still settling', async () => {
    // The host's pull landing inside a request's settle window used to see the
    // reservation as a confirmed booking; if that request then rolled it back,
    // the event the app had created from it was never removed.
    const worker = await loadWorker();
    await syncBooking(worker);
    const start = Date.UTC(2027, 0, 4, 9);
    const record = {
      id: 'cafebabecafebabecafebabecafebabe',
      pageId: 'abcd1234',
      pageTitle: 'Intro call',
      durationMin: 60,
      start,
      end: start + HOUR,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      status: 'confirmed',
      createdAt: NOW - 5_000,
      updatedAt: NOW - 5_000,
      tokenHash: 'x',
      pending: true,
    };
    worker.kv.map.set('bookw:bkg:' + record.id, record);
    let list = await worker.call('GET', '/admin/booking/list', { headers: AUTH });
    expect((await list.json()).bookings).toEqual([]);
    // Committed (the mark cleared) — or old enough that the mark no longer
    // counts — it is listed.
    worker.kv.map.set('bookw:bkg:' + record.id, { ...record, pending: undefined });
    list = await worker.call('GET', '/admin/booking/list', { headers: AUTH });
    expect((await list.json()).bookings.map((b) => b.id)).toEqual([record.id]);
    worker.kv.map.set('bookw:bkg:' + record.id, { ...record, createdAt: NOW - 10 * 60_000 });
    list = await worker.call('GET', '/admin/booking/list', { headers: AUTH });
    expect((await list.json()).bookings.map((b) => b.id)).toEqual([record.id]);
  });

  it('leaves nothing behind when storage fails mid-booking', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    // Break the read the availability check makes, after the reservation is
    // already written. Doing nothing would put a booking on the host's
    // calendar that its guest was told had failed.
    const realList = worker.kv.list.getMockImplementation();
    worker.kv.list.mockImplementation(async (pattern, rv) => {
      if (pattern === 'bookw:bkg:*') throw new Error('kv unavailable');
      return realList(pattern, rv);
    });
    const res = await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) });
    expect(res.status).toBe(503);
    worker.kv.list.mockImplementation(realList);
    expect([...worker.kv.map.keys()].filter((k) => k.startsWith('bookw:bkg:'))).toEqual([]);
    expect([...worker.kv.map.keys()].filter((k) => k.startsWith('bookw:tok:'))).toEqual([]);
    // And the retry goes through.
    expect((await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) })).status).toBe(200);
  });

  it('leaves nothing behind when the reservation itself half-lands', async () => {
    // The record is written, then its token pointer; if the second write
    // throws, the handler used to throw too — leaving a reservation that the
    // admin list showed as a confirmed booking (so the host's calendar adopted
    // it), that its guest had been told failed and could never cancel, and
    // that blocked the slot once the settle window lapsed.
    const worker = await loadWorker();
    await syncBooking(worker);
    const realSet = worker.kv.set.getMockImplementation();
    worker.kv.set.mockImplementation(async (k, v) => {
      if (typeof k === 'string' && k.startsWith('bookw:tok:')) throw new Error('kv unavailable');
      return realSet(k, v);
    });
    const res = await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) });
    expect(res.status).toBe(503);
    worker.kv.set.mockImplementation(realSet);
    expect([...worker.kv.map.keys()].filter((k) => k.startsWith('bookw:bkg:'))).toEqual([]);
    const list = await worker.call('GET', '/admin/booking/list', { headers: AUTH });
    expect((await list.json()).bookings).toEqual([]);
    // And the retry goes through.
    expect((await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) })).status).toBe(200);
  });

  it('still confirms the booking when the mail path throws outright', async () => {
    // Not a rejected send (sendBookingMail already answers false for those) —
    // a throw on the way to one. Mail is best-effort by design, so it must
    // cost the announcement and not the booking the guest is waiting on.
    const worker = await loadWorker({
      email: {
        get send() {
          throw new Error('mailer exploded');
        },
      },
    });
    await syncBooking(worker);
    const res = await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.emailed).toEqual({ guest: false, host: false });
    expect(worker.kv.map.get(`bookw:bkg:${body.booking.id}`).status).toBe('confirmed');
  });

  it('still tells a DIFFERENT guest the slot is taken', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const start = Date.UTC(2027, 0, 4, 9);
    expect((await book(worker, 'abcd1234', { start })).status).toBe(200);
    const other = await book(worker, 'abcd1234', { start, email: 'other@example.com' });
    expect(other.status).toBe(409);
    expect((await other.json()).error).toBe('slot_taken');
  });

  it("honors an existing booking's after-buffer — no back-to-back follow-up", async () => {
    const worker = await loadWorker();
    await syncBooking(worker, { pages: [pageDef({ bufferAfterMin: 30 })] });
    expect((await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) })).status).toBe(200);
    const slots = await getSlots(worker, 'abcd1234', NOW, NOW + DAY);
    // 10:00 begins the moment the booked 9:00–10:00 meeting ends — inside its
    // 30-minute after-buffer; 11:00 keeps the required gap.
    expect(slots).not.toContain(Date.UTC(2027, 0, 4, 10));
    expect(slots).toContain(Date.UTC(2027, 0, 4, 11));
    // POST agrees with the grid: a conflict, not a schedule mismatch.
    const res = await book(worker, 'abcd1234', {
      start: Date.UTC(2027, 0, 4, 10),
      email: 'other@example.com',
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('slot_taken');
  });

  it("honors an existing booking's before-buffer for an earlier candidate", async () => {
    const worker = await loadWorker();
    await syncBooking(worker, { pages: [pageDef({ bufferBeforeMin: 30 })] });
    expect((await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 12) })).status).toBe(200);
    const slots = await getSlots(worker, 'abcd1234', NOW, NOW + DAY);
    // 11:00–12:00 ends exactly where the booked 12:00 meeting's 30-minute
    // prep window begins — blocked; 10:00–11:00 leaves the window intact.
    expect(slots).not.toContain(Date.UTC(2027, 0, 4, 11));
    expect(slots).toContain(Date.UTC(2027, 0, 4, 10));
  });

  it('blocks overlapping slots across two pages (the host is one person)', async () => {
    const worker = await loadWorker();
    await syncBooking(worker, {
      pages: [pageDef(), pageDef({ id: 'ee220044', title: 'Long chat', durationMin: 120, incrementMin: 60 })],
    });
    // Book 9:00–10:00 on the first page…
    expect((await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) })).status).toBe(200);
    // …then the 2-hour page can no longer start at 8:00 (would overlap 9:00).
    const slots = await getSlots(worker, 'ee220044', NOW, NOW + DAY);
    expect(slots).not.toContain(Date.UTC(2027, 0, 4, 9));
    expect(slots).toContain(Date.UTC(2027, 0, 4, 11));
  });

  it('enforces the per-day booking cap for a page', async () => {
    const worker = await loadWorker();
    await syncBooking(worker, { pages: [pageDef({ maxPerDay: 1 })] });
    expect((await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) })).status).toBe(200);
    // The rest of Monday empties out; next Monday is unaffected.
    const monday = await getSlots(worker, 'abcd1234', NOW, NOW + DAY);
    expect(monday).toEqual([]);
    const nextMonday = await getSlots(worker, 'abcd1234', NOW + 6 * DAY, NOW + 8 * DAY);
    expect(nextMonday.length).toBeGreaterThan(0);
  });

  it('caps how many bookings a page accepts per day (anti-abuse)', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const dayKey = new Date(NOW).toISOString().slice(0, 10);
    worker.kv.map.set(`bookw:new:abcd1234:${dayKey}`, 50);
    const res = await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) });
    expect(res.status).toBe(429);
  });
});

describe('booking worker: meeting links', () => {
  const ROOM = /^https:\/\/meetings\.puter\.com\/#\/m\/[a-z]{4}-[a-z]{4}-[a-z]{4}$/;

  it('mints a distinct Puter Meetings room per booking by default, served everywhere', async () => {
    const worker = await loadWorker();
    await syncBooking(worker); // pageDef carries no `meet` — absent means ON
    const first = await (await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) })).json();
    const second = await (
      await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 10), email: 'bob@example.com' })
    ).json();
    expect(first.booking.meetingUrl).toMatch(ROOM);
    expect(second.booking.meetingUrl).toMatch(ROOM);
    // Different guests must never share a room.
    expect(second.booking.meetingUrl).not.toBe(first.booking.meetingUrl);

    const manage = await (await worker.call('GET', `/api/booking/${first.token}`)).json();
    expect(manage.booking.meetingUrl).toBe(first.booking.meetingUrl);

    const list = await (await worker.call('GET', '/admin/booking/list', { headers: AUTH })).json();
    const pulled = list.bookings.find((b) => b.id === first.booking.id);
    expect(pulled.meetingUrl).toBe(first.booking.meetingUrl);
  });

  it('mints nothing when the page turned meetings off', async () => {
    const worker = await loadWorker();
    await syncBooking(worker, { pages: [pageDef({ meet: false })] });
    const out = await (await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) })).json();
    expect(out.booking.meetingUrl).toBe('');
    const list = await (await worker.call('GET', '/admin/booking/list', { headers: AUTH })).json();
    expect('meetingUrl' in list.bookings[0]).toBe(false);
  });

  it('carries the link through both emails and the confirmation .ics', async () => {
    const send = vi.fn(async () => ({}));
    const worker = await loadWorker({ email: { sendTransactional: send } });
    await syncBooking(worker);
    const out = await (
      await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9), notes: 'Roadmap chat' })
    ).json();
    const join = out.booking.meetingUrl;
    expect(join).toMatch(ROOM);

    const guestMail = send.mock.calls.find(([m]) => m.to === 'ada@example.com')[0];
    expect(guestMail.text).toContain(`Join: ${join}`);
    expect(guestMail.html).toContain(`href="${join}"`);
    // Unfold (RFC 5545 §3.1) — long lines arrive split across continuations.
    const ics = Buffer.from(guestMail.attachments[0].content, 'base64')
      .toString('utf8')
      .replace(/\r\n[ \t]/g, '');
    expect(ics).toContain(`URL:${join}`);
    expect(ics).toContain(`X-GOOGLE-CONFERENCE:${join}`);
    expect(ics).toContain(`CONFERENCE;VALUE=URI;FEATURE=VIDEO:${join}`);
    expect(ics).toContain(`DESCRIPTION:Roadmap chat\\n\\nJoin: ${join}`);
    expect(ics).toContain('LOCATION:Video call'); // the page's real location is never displaced

    const hostMail = send.mock.calls.find(([m]) => m.to === 'host@example.com')[0];
    expect(hostMail.text).toContain(`Join: ${join}`);
    expect(hostMail.html).toContain(`href="${join}"`);
  });

  it('the .ics never writes the join link as a LOCATION (Gmail maps locations)', async () => {
    const send = vi.fn(async () => ({}));
    const worker = await loadWorker({ email: { sendTransactional: send } });
    await syncBooking(worker, { pages: [pageDef({ location: '' })] });
    const out = await (await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) })).json();
    const guestMail = send.mock.calls.find(([m]) => m.to === 'ada@example.com')[0];
    const ics = Buffer.from(guestMail.attachments[0].content, 'base64')
      .toString('utf8')
      .replace(/\r\n[ \t]/g, '');
    // No location on the page → no LOCATION at all; the link still reaches
    // every client through the conference properties and the description.
    expect(ics).not.toContain('LOCATION:');
    expect(ics).toContain(`X-GOOGLE-CONFERENCE:${out.booking.meetingUrl}`);
    expect(ics).toContain(`DESCRIPTION:Join: ${out.booking.meetingUrl}`);
  });

  it('never serves a stored link that is not a Puter Meetings room URL (defense in depth)', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const out = await (await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) })).json();
    // Records are worker-authored, but the guest view re-validates on the way
    // out — simulate a corrupted record.
    const record = worker.kv.map.get(`bookw:bkg:${out.booking.id}`);
    record.meetingUrl = 'https://evil.example/#/m/abcd-efgh-ijkl';
    const manage = await (await worker.call('GET', `/api/booking/${out.token}`)).json();
    expect(manage.booking.meetingUrl).toBe('');
  });

  it('escapes a lone CR in guest notes so it cannot split the .ics DESCRIPTION', async () => {
    const send = vi.fn(async () => ({}));
    const worker = await loadWorker({ email: { sendTransactional: send } });
    await syncBooking(worker, { pages: [pageDef({ meet: false })] });
    // A bare CR (no following LF) reaches the worker as %0D on the wire. Left
    // raw in DESCRIPTION it becomes a line break for lenient parsers, letting
    // the tail masquerade as its own property line.
    await book(worker, 'abcd1234', {
      start: Date.UTC(2027, 0, 4, 9),
      notes: 'Line one\rSUMMARY:injected',
    });
    const guestMail = send.mock.calls.find(([m]) => m.to === 'ada@example.com')[0];
    const ics = Buffer.from(guestMail.attachments[0].content, 'base64')
      .toString('utf8')
      .replace(/\r\n[ \t]/g, '');
    expect(ics).toContain('DESCRIPTION:Line one\\nSUMMARY:injected');
    // The only real CRLFs are the property line separators, never a bare CR
    // sitting inside a value.
    expect(ics).not.toMatch(/[^\n]\r[^\n]/);
  });

  it('quotes the CN param so a name with a colon cannot rewrite ATTENDEE', async () => {
    const send = vi.fn(async () => ({}));
    const worker = await loadWorker({ email: { sendTransactional: send } });
    await syncBooking(worker, {
      pages: [pageDef({ meet: false })],
      organizerName: 'Nariman: Puter',
    });
    // A bare param value ends at the next ':' — this name used to close the
    // params and supply the ATTENDEE's value itself.
    await book(worker, 'abcd1234', {
      start: Date.UTC(2027, 0, 4, 9),
      name: 'Eve:mailto:evil@attacker.test',
    });
    const guestMail = send.mock.calls.find(([m]) => m.to === 'ada@example.com')[0];
    const ics = Buffer.from(guestMail.attachments[0].content, 'base64')
      .toString('utf8')
      .replace(/\r\n[ \t]/g, '');
    expect(ics).toContain(
      'ATTENDEE;CN="Eve:mailto:evil@attacker.test";PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:ada@example.com',
    );
    expect(ics).toContain('ORGANIZER;CN="Nariman: Puter":mailto:host@example.com');
    expect(ics).not.toContain('mailto:evil@attacker.test\r\n');
  });

  it('drops quotes and control characters from a CN rather than breaking the line', async () => {
    const send = vi.fn(async () => ({}));
    const worker = await loadWorker({ email: { sendTransactional: send } });
    await syncBooking(worker, { pages: [pageDef({ meet: false })] });
    await book(worker, 'abcd1234', {
      start: Date.UTC(2027, 0, 4, 9),
      // bookLine already strips CR/LF from a name; a quote is what is left.
      name: 'Ada "Countess" Lovelace',
    });
    const guestMail = send.mock.calls.find(([m]) => m.to === 'ada@example.com')[0];
    const ics = Buffer.from(guestMail.attachments[0].content, 'base64')
      .toString('utf8')
      .replace(/\r\n[ \t]/g, '');
    expect(ics).toContain('ATTENDEE;CN="Ada Countess Lovelace";PARTSTAT=ACCEPTED');
  });

  it('folds .ics lines between whole code points, so an emoji survives the boundary', async () => {
    const send = vi.fn(async () => ({}));
    const worker = await loadWorker({ email: { sendTransactional: send } });
    // 'SUMMARY:' is 8 octets, so a title whose 66th character is astral puts
    // the surrogate pair exactly across a 75-octet fold. Folding by UTF-16
    // units orphaned each half and UTF-8 encoded them as U+FFFD.
    const lead = 'Product strategy deep dive with the platform team ';
    const title = `${lead}${'y'.repeat(65 - lead.length)}\u{1F44B} roadmap`;
    await syncBooking(worker, { pages: [pageDef({ title, meet: false, location: '' })] });
    await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) });
    const guestMail = send.mock.calls.find(([m]) => m.to === 'ada@example.com')[0];
    const ics = Buffer.from(guestMail.attachments[0].content, 'base64').toString('utf8');
    expect(ics).not.toContain('\uFFFD');
    expect(ics.replace(/\r\n[ \t]/g, '')).toContain(`SUMMARY:${title}`);
    // Still folded — every line stays inside the 75-octet limit.
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});

describe('booking worker: cancelling', () => {
  async function bookOne(worker, start = Date.UTC(2027, 0, 4, 9)) {
    const res = await book(worker, 'abcd1234', { start });
    expect(res.status).toBe(200);
    return res.json();
  }

  it('guest cancel frees the slot and is idempotent', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const start = Date.UTC(2027, 0, 4, 9);
    const { token } = await bookOne(worker, start);

    const res = await worker.call('POST', `/api/booking/${token}/cancel`, {
      body: new URLSearchParams({ reason: 'Something came up' }).toString(),
    });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.booking.status).toBe('cancelled');
    expect(out.booking.cancelledBy).toBe('guest');

    // The slot is bookable again…
    expect(await getSlots(worker, 'abcd1234', NOW, NOW + DAY)).toContain(start);
    // …and cancelling again is a no-op success.
    const again = await worker.call('POST', `/api/booking/${token}/cancel`, { body: '' });
    expect(again.status).toBe(200);
  });

  it('refuses a guest cancel once the meeting has started', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const start = Date.UTC(2027, 0, 4, 9);
    const { token } = await bookOne(worker, start);
    vi.setSystemTime(start + 1);
    const res = await worker.call('POST', `/api/booking/${token}/cancel`, { body: '' });
    expect(res.status).toBe(410);
  });

  it('keeps the guest as the canceller in the host notice when the guest cancels', async () => {
    const send = vi.fn(async () => ({}));
    const worker = await loadWorker({ email: { sendTransactional: send } });
    await syncBooking(worker);
    const { token } = await bookOne(worker);
    send.mockClear();
    const res = await worker.call('POST', `/api/booking/${token}/cancel`, {
      body: new URLSearchParams({ reason: 'Schedule changed' }).toString(),
    });
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe('host@example.com');
    expect(mail.text).toContain('Ada Lovelace (ada@example.com) cancelled their "Intro call" booking.');
    expect(mail.text).toContain('Their note: Schedule changed');
    expect(mail.html).not.toContain('You cancelled');
  });

  it('host cancel via admin marks the booking and dead tokens stay dead', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const { token, booking } = await bookOne(worker);
    const res = await worker.call('POST', '/admin/booking/cancel', {
      headers: AUTH,
      json: { id: booking.id, notify: false },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).booking.status).toBe('cancelled');
    // The manage view now reports it cancelled (token still resolves — the
    // guest deserves to see WHY their meeting vanished).
    const view = await (await worker.call('GET', `/api/booking/${token}`)).json();
    expect(view.booking.status).toBe('cancelled');
    expect(view.booking.cancelledBy).toBe('host');
    expect(view.booking.canCancel).toBe(false);
  });

  it('emails both guest and host once when the host cancels', async () => {
    const send = vi.fn(async () => ({}));
    const worker = await loadWorker({ email: { sendTransactional: send } });
    await syncBooking(worker);
    const { booking } = await bookOne(worker);
    send.mockClear();
    const cancel = () => worker.call('POST', '/admin/booking/cancel', {
      headers: AUTH,
      json: { id: booking.id, reason: '<Schedule changed>' },
    });

    const res = await cancel();
    expect(res.status).toBe(200);
    expect((await res.json()).emailed).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    const guest = send.mock.calls.find(([m]) => m.to === 'ada@example.com')[0];
    const host = send.mock.calls.find(([m]) => m.to === 'host@example.com')[0];
    expect(guest.text).toContain('Nariman cancelled your booking.');
    expect(guest.text).toContain('Pick a new time:');
    expect(host.subject).toContain('Cancelled: Ada');
    expect(host.text).toContain('You cancelled the "Intro call" booking with Ada Lovelace (ada@example.com).');
    expect(host.text).toContain('Your note: <Schedule changed>');
    expect(host.html).toContain('You cancelled');
    expect(host.html).toContain('&lt;Schedule changed&gt;');
    expect(host.text).not.toContain('Pick a new time:');
    expect((await cancel()).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each(['ada@example.com', 'host@example.com'])('still notifies the other person when mail to %s fails', async (failedEmail) => {
    const send = vi.fn(async () => ({}));
    const worker = await loadWorker({ email: { sendTransactional: send } });
    await syncBooking(worker);
    const { booking } = await bookOne(worker);
    send.mockClear();
    send.mockImplementation(async (mail) => {
      if (mail.to === failedEmail) throw new Error('Mail unavailable');
      return {};
    });
    const res = await worker.call('POST', '/admin/booking/cancel', {
      headers: AUTH,
      json: { id: booking.id, notify: true },
    });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.booking.status).toBe('cancelled');
    expect(out.emailed).toBe(failedEmail !== 'ada@example.com');
    expect(send.mock.calls.map(([mail]) => mail.to)).toEqual(['ada@example.com', 'host@example.com']);
  });

  it('does not send cancellation emails when notifications are disabled', async () => {
    const send = vi.fn(async () => ({}));
    const worker = await loadWorker({ email: { sendTransactional: send } });
    await syncBooking(worker);
    const { booking } = await bookOne(worker);
    send.mockClear();
    const res = await worker.call('POST', '/admin/booking/cancel', {
      headers: AUTH,
      json: { id: booking.id, notify: false },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).emailed).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('admin list returns bookings without token hashes', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    await bookOne(worker);
    const res = await worker.call('GET', '/admin/booking/list', { headers: AUTH });
    const data = await res.json();
    expect(data.bookings).toHaveLength(1);
    expect(data.bookings[0].email).toBe('ada@example.com');
    expect(data.bookings[0].tokenHash).toBeUndefined();
  });
});

describe('booking worker: one bad record cannot block the rest', () => {
  it('lists live bookings even when pruning an old one fails', async () => {
    const worker = await loadWorker();
    await syncBooking(worker);
    const live = await (await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) })).json();

    // A record from long enough ago that the list route wants it gone.
    worker.kv.map.set('bookw:bkg:deadbeef', {
      id: 'deadbeef',
      pageId: 'abcd1234',
      start: NOW - 400 * DAY,
      end: NOW - 400 * DAY + HOUR,
      email: 'old@example.com',
      status: 'confirmed',
    });
    const realDel = worker.kv.del.getMockImplementation();
    worker.kv.del.mockImplementation(async (key) => {
      if (key === 'bookw:bkg:deadbeef') throw new Error('kv unavailable');
      return realDel(key);
    });

    // This route is the app's ONLY way to learn about bookings, so one
    // undeletable record must not stop every future booking reaching the
    // calendar.
    const res = await worker.call('GET', '/admin/booking/list', { headers: AUTH });
    expect(res.status).toBe(200);
    const ids = (await res.json()).bookings.map((b) => b.id);
    expect(ids).toContain(live.booking.id);
    expect(ids).not.toContain('deadbeef');
  });

  it('records a cancellation even when the notice cannot be sent', async () => {
    const worker = await loadWorker({
      email: {
        get send() {
          throw new Error('mailer exploded');
        },
      },
    });
    await syncBooking(worker);
    const out = await (await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) })).json();

    const guest = await worker.call('POST', `/api/booking/${out.token}/cancel`, { body: '' });
    expect(guest.status).toBe(200);
    expect(worker.kv.map.get(`bookw:bkg:${out.booking.id}`).status).toBe('cancelled');
    // The freed slot is offerable again.
    expect(await getSlots(worker, 'abcd1234', NOW, NOW + DAY)).toContain(Date.UTC(2027, 0, 4, 9));
  });

  it('records a HOST cancellation even when the notice cannot be sent', async () => {
    const worker = await loadWorker({
      email: {
        get send() {
          throw new Error('mailer exploded');
        },
      },
    });
    await syncBooking(worker);
    const out = await (await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) })).json();

    const res = await worker.call('POST', '/admin/booking/cancel', {
      headers: AUTH,
      json: { id: out.booking.id, notify: true },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).emailed).toBe(false);
    expect(worker.kv.map.get(`bookw:bkg:${out.booking.id}`).status).toBe('cancelled');
  });
});

describe('booking worker: emails (best-effort)', () => {
  it('sends guest + host mail when the runtime grants a mailer', async () => {
    const send = vi.fn(async () => ({}));
    const worker = await loadWorker({ email: { sendTransactional: send } });
    await syncBooking(worker);
    const res = await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) });
    const out = await res.json();
    expect(out.emailed).toEqual({ guest: true, host: true });
    expect(send).toHaveBeenCalledTimes(2);
    const guestMail = send.mock.calls.find(([m]) => m.to === 'ada@example.com')[0];
    expect(guestMail.subject).toContain('Confirmed');
    expect(guestMail.text).toContain('/booking/'); // the manage link
    expect(guestMail.attachments[0].contentType).toContain('text/calendar');
    const hostMail = send.mock.calls.find(([m]) => m.to === 'host@example.com')[0];
    expect(hostMail.subject).toContain('New booking');
    // Both mails lead with a visible "this went through" mark — a check in a
    // green disc beside the heading in HTML, a check glyph in plain text — so
    // the confirmation reads before the details do.
    for (const mail of [guestMail, hostMail]) {
      expect(mail.html).toContain('background:#2fa66b');
      expect(mail.html).toContain('&#10003;');
      expect(mail.text.startsWith('\u2713') || mail.text.includes('\n\u2713 ')).toBe(true);
    }
    expect(guestMail.html).toContain('You&rsquo;re scheduled');
    expect(hostMail.html).toContain('<h1 style="margin:0;color:#111827;font-size:20px;line-height:1.3">New booking</h1>');
  });

  it('a failing mailer never fails the booking', async () => {
    const send = vi.fn(async () => {
      throw new Error('smtp down');
    });
    const worker = await loadWorker({ email: { sendTransactional: send } });
    await syncBooking(worker);
    const res = await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.ok).toBe(true);
    expect(out.emailed).toEqual({ guest: false, host: false });
  });

  it('bills the host as the requester when the runtime wants the token split out (live-platform form)', async () => {
    // The live platform (see email-worker.js sendForms, observed 2026-08)
    // rejects a bare owner send: the payer must be named via requesterToken.
    // Guests are anonymous, so the host's own token fills both halves.
    const send = vi.fn(async (message) => {
      if (message.requesterToken !== 'host-worker-token') {
        throw new Error('requesterToken required');
      }
      return {};
    });
    const worker = await loadWorker({ email: { sendTransactional: send }, authToken: 'host-worker-token' });
    await syncBooking(worker);
    const res = await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) });
    expect((await res.json()).emailed).toEqual({ guest: true, host: true });
    const guestMail = send.mock.calls.find(([m]) => m.to === 'ada@example.com')[0];
    expect(guestMail.requesterToken).toBe('host-worker-token');
    expect(guestMail.subject).toContain('Confirmed'); // message itself intact
  });

  it('falls back to a bare send when the runtime rejects the token parameter', async () => {
    const send = vi.fn(async (message) => {
      if ('requesterToken' in message) throw new Error('unrecognized parameter requesterToken');
      return {};
    });
    const worker = await loadWorker({ email: { sendTransactional: send }, authToken: 'host-worker-token' });
    await syncBooking(worker);
    const res = await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) });
    expect((await res.json()).emailed).toEqual({ guest: true, host: true });
  });

  it('a delivery failure is final — the message is never retried in another form', async () => {
    const send = vi.fn(async () => {
      throw new Error('recipient address rejected');
    });
    const worker = await loadWorker({ email: { sendTransactional: send }, authToken: 'host-worker-token' });
    await syncBooking(worker);
    const res = await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) });
    expect((await res.json()).emailed).toEqual({ guest: false, host: false });
    // One attempt per message (guest + host) — a rejected DELIVERY must not be
    // re-tried in another form, which could double-send an accepted message.
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('stops sending at the daily mail cap', async () => {
    const send = vi.fn(async () => ({}));
    const worker = await loadWorker({ email: { sendTransactional: send } });
    await syncBooking(worker);
    worker.kv.map.set(`bookw:mail:${new Date(NOW).toISOString().slice(0, 10)}`, 200);
    const res = await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) });
    expect((await res.json()).emailed).toEqual({ guest: false, host: false });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('booking worker: human links', () => {
  it('redirects /book/<page> to the app page with params in the fragment', async () => {
    const worker = await loadWorker();
    const res = await worker.call('GET', '/book/abcd1234');
    expect(res.status).toBe(303);
    const loc = res.headers.get('location');
    expect(loc.startsWith('https://app.test/book.html#')).toBe(true);
    const params = new URLSearchParams(loc.split('#')[1]);
    expect(params.get('w')).toBe('https://test-worker.puter.work');
    expect(params.get('p')).toBe('abcd1234');
  });

  it('redirects /booking/<token> with the token in the fragment', async () => {
    const worker = await loadWorker();
    const token = 'a'.repeat(40);
    const res = await worker.call('GET', `/booking/${token}`);
    expect(res.status).toBe(303);
    const params = new URLSearchParams(res.headers.get('location').split('#')[1]);
    expect(params.get('t')).toBe(token);
  });

  it('drops malformed ids/tokens from the redirect instead of forwarding them', async () => {
    const worker = await loadWorker();
    const res = await worker.call('GET', '/book/NOT%20VALID');
    const params = new URLSearchParams(res.headers.get('location').split('#')[1]);
    expect(params.get('p')).toBe(null);
  });
});

describe('booking mail: the send API name', () => {
  it('uses send() where the runtime predates sendTransactional', async () => {
    const send = vi.fn(async () => ({}));
    const worker = await loadWorker({ email: { send } });
    await syncBooking(worker);
    const out = await (await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) })).json();
    expect(out.emailed.guest).toBe(true);
    expect(send.mock.calls.find(([m]) => m.to === 'ada@example.com')).toBeTruthy();
  });

  it('prefers sendTransactional when a runtime carries both names', async () => {
    const send = vi.fn(async () => ({}));
    const sendTransactional = vi.fn(async () => ({}));
    const worker = await loadWorker({ email: { send, sendTransactional } });
    await syncBooking(worker);
    const out = await (await book(worker, 'abcd1234', { start: Date.UTC(2027, 0, 4, 9) })).json();
    expect(out.emailed.guest).toBe(true);
    expect(sendTransactional).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

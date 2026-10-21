import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * public/book.html is the app-hosted guest booking page: the worker serves no
 * HTML, so this page renders the whole Calendly-style flow from the worker's
 * JSON API. Its inline script exposes `window.__bookPageInit(opts)` when
 * `__BOOK_PAGE_TEST__` is set, which lets these tests drive it with a mock
 * fetch.
 */
const HTML = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/book.html'),
  'utf8',
);
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(HTML)[1];

const WORKER = 'https://cal-rsvp-ab12cd34ef.puter.work';
const PAGE_ID = 'abcd1234';
const TOKEN = 'b'.repeat(40);
const HOUR = 3_600_000;

// A fixed, far-future Wednesday at 09:00 UTC — stable whatever zone runs this.
const SLOT = Date.UTC(2030, 5, 12, 9, 0, 0);

function pageView(overrides = {}) {
  return {
    id: PAGE_ID,
    title: 'Intro call',
    description: 'A quick hello',
    location: 'Video call',
    durationMin: 60,
    minNoticeMin: 0,
    maxAdvanceDays: 60,
    organizer: 'Nariman',
    timeZone: 'UTC',
    ...overrides,
  };
}

function jsonRes(data, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => data });
}

/** A fetch stub routing the page's API calls; slots default to three on one day. */
function makeFetch({ page = pageView(), slots = [SLOT, SLOT + HOUR, SLOT + 2 * HOUR], firstAvailable, now, onBook, onCancel, booking, pageStatus = 200 } = {}) {
  return vi.fn((url, options = {}) => {
    const u = String(url);
    if (u.startsWith(`${WORKER}/api/book/${PAGE_ID}/slots`)) {
      return jsonRes({ ok: true, slots, durationMin: page.durationMin });
    }
    if (u === `${WORKER}/api/book/${PAGE_ID}` && (!options.method || options.method === 'GET')) {
      if (pageStatus !== 200) return jsonRes({ error: 'page_off' }, pageStatus);
      // The page view answers for the WHOLE window, not just the month the
      // slot list covers — pass it explicitly to separate "this month is
      // empty" from "there is nothing anywhere".
      return jsonRes({
        ok: true,
        page,
        firstAvailable: firstAvailable === undefined ? slots[0] || null : firstAvailable,
        now: now === undefined ? Date.now() : now,
      });
    }
    if (u === `${WORKER}/api/book/${PAGE_ID}` && options.method === 'POST') {
      return onBook(options);
    }
    if (u === `${WORKER}/api/booking/${TOKEN}` && (!options.method || options.method === 'GET')) {
      return jsonRes({ ok: true, booking, page: { id: PAGE_ID, enabled: true } });
    }
    if (u === `${WORKER}/api/booking/${TOKEN}/cancel`) {
      return onCancel(options);
    }
    return jsonRes({ error: 'not_found' }, 404);
  });
}

let init;
let root;

beforeEach(() => {
  window.__BOOK_PAGE_TEST__ = true;
  new Function(SCRIPT)();
  init = window.__bookPageInit;
  root = document.createElement('main');
  document.body.replaceChildren(root);
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function bookHash() {
  return `#w=${encodeURIComponent(WORKER)}&p=${PAGE_ID}`;
}

async function openPicker(fetchFn) {
  init({ root, hash: bookHash(), fetchFn });
  await tick();
  await tick();
}

describe('book.html: guarding', () => {
  it('refuses a non-puter.work worker origin without fetching anything', async () => {
    const fetchFn = vi.fn();
    init({ root, hash: `#w=${encodeURIComponent('https://evil.example.com')}&p=${PAGE_ID}`, fetchFn });
    await tick();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(root.textContent).toContain("This link isn't active");
  });

  it('refuses a malformed page id', async () => {
    const fetchFn = vi.fn();
    init({ root, hash: `#w=${encodeURIComponent(WORKER)}&p=NOT_OK!`, fetchFn });
    await tick();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(root.textContent).toContain("This link isn't active");
  });

  it('accepts a slug page id, and still rejects a malformed one', async () => {
    // Booking links read as `/book/intro-call` now; the guard has to let the
    // hyphen through without letting through what it was drawn to keep out.
    const fetchFn = vi.fn(() => jsonRes({ error: 'not_found' }, 404));
    init({ root, hash: `#w=${encodeURIComponent(WORKER)}&p=intro-call`, fetchFn });
    await tick();
    expect(fetchFn).toHaveBeenCalled(); // got past the guard and asked the worker
    for (const bad of ['-intro', 'intro-', 'a', 'Intro-Call', 'intro call']) {
      const spy = vi.fn();
      init({ root, hash: `#w=${encodeURIComponent(WORKER)}&p=${encodeURIComponent(bad)}`, fetchFn: spy });
      await tick();
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('accepts the share-link route (#/<host>/<page>) and rebuilds the worker from it', async () => {
    // index.html forwards calendar.puter.com/#/nariman/intro-call here with the
    // route intact; the worker is `cal-<host>.puter.work`, by grammar alone.
    const fetchFn = vi.fn(() => jsonRes({ error: 'not_found' }, 404));
    init({ root, hash: '#/nariman/intro-call', fetchFn });
    await tick();
    expect(fetchFn).toHaveBeenCalled();
    expect(fetchFn.mock.calls[0][0]).toBe('https://cal-nariman.puter.work/api/book/intro-call');
  });

  it('the share-link route is case-insensitive — it gets read out and retyped', async () => {
    const fetchFn = vi.fn(() => jsonRes({ error: 'not_found' }, 404));
    init({ root, hash: '#/Nariman-A1B2/Intro-Call', fetchFn });
    await tick();
    expect(fetchFn.mock.calls[0][0]).toBe('https://cal-nariman-a1b2.puter.work/api/book/intro-call');
  });

  it('refuses a malformed share-link route without contacting anyone', async () => {
    for (const bad of [
      '#/nariman',
      '#/nariman/',
      '#//intro-call',
      '#/nariman/intro-call/extra',
      '#/-nariman/intro-call',
      '#/nariman/-intro',
      '#/nariman/a',
      '#/nariman/intro call',
      '#/evil.example.com/intro-call',
      '#/nariman%2fx/intro-call',
      '#/cal-nj.puter.work/intro-call',
      `#/${'n'.repeat(60)}/intro-call`, // one past the DNS label with its cal- prefix
      '#/nariman/intro-call?w=https://evil.example.com',
    ]) {
      const spy = vi.fn();
      init({ root, hash: bad, fetchFn: spy });
      await tick();
      expect(spy, bad).not.toHaveBeenCalled();
      expect(root.textContent, bad).toContain("This link isn't active");
    }
  });

  it('renders the picker from the share-link route exactly as from the worker redirect', async () => {
    // WORKER is cal-rsvp-ab12cd34ef.puter.work, so its label is rsvp-ab12cd34ef.
    init({ root, hash: `#/rsvp-ab12cd34ef/${PAGE_ID}`, fetchFn: makeFetch() });
    await tick();
    await tick();
    expect(root.textContent).toContain('Intro call');
    expect(root.querySelectorAll('.slot')).toHaveLength(3);
  });

  it('a page removed mid-visit ends the visit, rather than looping on "Try again"', async () => {
    // The page opened fine; by the time the guest browses to the next month
    // the host has deleted it, and the slots route answers 404. That is
    // final — retrying it forever would only 404 forever.
    // Fake only Date (setTimeout stays real for tick()) so the next month is
    // inside the booking horizon and its arrow is enabled.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SLOT);
    try {
      const base = makeFetch({ now: SLOT });
      let slotCalls = 0;
      const fetchFn = vi.fn((url, options) => {
        if (String(url).includes('/slots') && ++slotCalls > 1) return jsonRes({ error: 'not_found' }, 404);
        return base(url, options);
      });
      await openPicker(fetchFn);
      const nav = [...root.querySelectorAll('.cal-nav button')];
      expect(nav[1].disabled).toBe(false);
      nav[1].click();
      await tick();
      await tick();
      expect(root.textContent).toContain("This link isn't active");
      expect(root.textContent).not.toContain('Try again');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the turned-off state for a disabled page', async () => {
    await openPicker(makeFetch({ pageStatus: 410 }));
    expect(root.textContent).toContain('Not accepting bookings');
  });
});

describe('book.html: picking a slot', () => {
  it('renders the page details as text (never markup) with available days and times', async () => {
    const fetchFn = makeFetch({
      page: pageView({ title: '<script>alert(1)</script>', description: '<b>bold</b>' }),
    });
    await openPicker(fetchFn);

    expect(root.querySelector('script')).toBe(null);
    expect(root.textContent).toContain('<script>alert(1)</script>');
    expect(root.textContent).toContain('<b>bold</b>');
    expect(root.textContent).toContain('Nariman');
    expect(root.textContent).toContain('1 hour');

    // The first-available day is preselected, so its three times are on screen.
    expect(root.querySelectorAll('.slot')).toHaveLength(3);
    // Exactly one calendar day is enabled (all slots share a day).
    const enabled = [...root.querySelectorAll('.cal-day')].filter((b) => !b.disabled);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].getAttribute('aria-pressed')).toBe('true');
  });

  it("starts the month grid on the viewer locale's first weekday", async () => {
    // June 2030 begins on a Saturday. Sunday-first that is five leading blanks;
    // Monday-first it is one less, and day 1 must still sit under Saturday.
    const dayOf = () => {
      const cells = [...root.querySelector('.cal-grid').children].slice(7);
      const one = cells.findIndex((c) => c.textContent === '1');
      const heads = [...root.querySelectorAll('.cal-dow')].map((h) => h.textContent);
      return { blanks: one, head: heads[one % 7], first: heads[0] };
    };

    const language = vi.spyOn(navigator, 'language', 'get');
    language.mockReturnValue('en-US');
    await openPicker(makeFetch({ slots: [Date.UTC(2030, 5, 12, 9)] }));
    const us = dayOf();
    expect(us.blanks).toBe(6);

    root = document.createElement('main');
    document.body.replaceChildren(root);
    language.mockReturnValue('en-GB');
    await openPicker(makeFetch({ slots: [Date.UTC(2030, 5, 12, 9)] }));
    const gb = dayOf();
    language.mockRestore();

    // A Monday-first week shifts everything one column left, and the headers
    // rotate with it — so June 1 still lands under the same weekday name.
    expect(gb.blanks).toBe(5);
    expect(gb.head).toBe(us.head);
    expect(us.first).not.toBe(gb.first);
  });

  it('follows the selected times into the new zone when the guest changes it', async () => {
    // One slot, Wednesday 23:00 UTC: Thursday morning in Auckland, Wednesday
    // afternoon in Los Angeles. The guest picks it in one zone, then switches.
    const late = Date.UTC(2030, 5, 12, 23, 0, 0);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(late - 3 * 86400000);
    try {
      await openPicker(makeFetch({ slots: [late], firstAvailable: late, now: late - 3 * 86400000 }));
      const tzSelect = root.querySelector('#bk-tz');
      expect(tzSelect).toBeTruthy();
      const pick = (zone) => {
        tzSelect.value = zone;
        tzSelect.dispatchEvent(new Event('change', { bubbles: true }));
      };
      pick('Pacific/Auckland');
      const pressed = () => [...root.querySelectorAll('.cal-day[aria-pressed="true"]')];
      expect(pressed()).toHaveLength(1);
      expect(pressed()[0].dataset.focusKey).toBe('day-2030-06-13');
      expect(root.querySelectorAll('.slot')).toHaveLength(1);

      pick('America/Los_Angeles');
      // The same instant, now under Wednesday: still selected, still listed —
      // not a disabled Thursday painted as chosen over an empty times column.
      expect(pressed()).toHaveLength(1);
      expect(pressed()[0].dataset.focusKey).toBe('day-2030-06-12');
      expect(pressed()[0].disabled).toBe(false);
      expect(root.querySelectorAll('.slot')).toHaveLength(1);
      expect(root.textContent).not.toContain('Pick a highlighted day');
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes its month bounds from the worker's clock, not the device's", async () => {
    // Fake only Date; the guest's machine is 45 days slow, which is enough to
    // put the real horizon on the far side of a month boundary.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SLOT - 45 * 86400000);
    try {
      await openPicker(makeFetch({ now: SLOT }));
      const nav = [...root.querySelectorAll('.cal-nav button')];
      // The picker opens on the month of the first available slot — which IS
      // the worker's current month, so back is closed and forward is open.
      // Read off the device clock, "today" sat two months earlier: back opened
      // onto months wholly in the past, and the 60-day horizon ended inside
      // the viewed month, greying out the arrow to every later slot.
      expect(nav[0].disabled).toBe(true);
      expect(nav[1].disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't send the guest month-hunting when the whole window is empty", async () => {
    // firstAvailable null means the worker found nothing in the entire horizon.
    init({ root, hash: bookHash(), fetchFn: makeFetch({ slots: [] }) });
    await tick();
    await tick();
    expect(root.textContent).toContain('No times are available at the moment');
    expect(root.textContent).not.toContain('Try the next one');
  });

  it('the empty-month notice only points at the next month when it can be visited', async () => {
    // Fake only Date (setTimeout stays real for tick()) and pin a mid-month
    // day, so whether the horizon crosses a month boundary is deterministic.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SLOT);
    try {
      // Horizon ends inside the current month: there is no next month to try.
      // firstAvailable is set so this stays a test about the month pointer —
      // a window with nothing in it at all gets its own message (below).
      await openPicker(
        makeFetch({ page: pageView({ maxAdvanceDays: 5 }), slots: [], firstAvailable: SLOT }),
      );
      const nav = [...root.querySelectorAll('.cal-nav button')];
      expect(nav[1].disabled).toBe(true);
      expect(root.textContent).toContain('No times available this month.');
      expect(root.textContent).not.toContain('Try the next one');

      // A longer horizon keeps the pointer to the (reachable) next month.
      root = document.createElement('main');
      document.body.replaceChildren(root);
      await openPicker(makeFetch({ slots: [], firstAvailable: SLOT }));
      expect(root.textContent).toContain('Try the next one');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retires slots as time passes, and hides a day once all of its are gone', async () => {
    // Fake only Date so tick()/setInterval stay real; sit just before the day
    // the fixture's three slots live on.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SLOT - 2 * HOUR);
    try {
      await openPicker(makeFetch());
      expect(root.querySelectorAll('.slot')).toHaveLength(3);

      // The month is a snapshot — walk past the first two slots and the picker
      // must stop offering them rather than fail on submit.
      vi.setSystemTime(SLOT + HOUR + 1);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(root.querySelectorAll('.slot')).toHaveLength(1);
      expect(root.querySelector('.slot').textContent).not.toContain('9:00');

      // Past the last one the whole day goes with them.
      vi.setSystemTime(SLOT + 3 * HOUR);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(root.querySelectorAll('.slot')).toHaveLength(0);
      expect([...root.querySelectorAll('.cal-day')].filter((b) => !b.disabled)).toHaveLength(0);
      // …and it must not stay painted as the chosen day: a disabled button
      // carrying aria-pressed="true" gets the accent pill over a times column
      // that says to pick one, and reads as both pressed and "no times".
      expect(root.querySelectorAll('.cal-day[aria-pressed="true"]')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ages the grid against the worker's clock, not a wrong device clock", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SLOT - 2 * HOUR);
    try {
      // The device is a day fast; every slot would look long gone locally.
      const fetchFn = makeFetch();
      const wrapped = vi.fn((url, options) => {
        const res = fetchFn(url, options);
        return res.then((r) => ({
          ...r,
          json: async () => {
            const data = await r.json();
            return data.page ? { ...data, now: Date.now() - 86_400_000 } : data;
          },
        }));
      });
      await openPicker(wrapped);
      expect(root.querySelectorAll('.slot')).toHaveLength(3);
      // A minimum notice is measured from that same corrected clock.
      document.dispatchEvent(new Event('visibilitychange'));
      expect(root.querySelectorAll('.slot')).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors the page minimum notice while the tab sits open', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SLOT - 3 * HOUR);
    try {
      // 2h notice: at T-3h all three are offered; at T-90m the first is not.
      await openPicker(makeFetch({ page: pageView({ minNoticeMin: 120 }) }));
      expect(root.querySelectorAll('.slot')).toHaveLength(3);
      vi.setSystemTime(SLOT - 90 * 60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(root.querySelectorAll('.slot')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('arms a slot on first tap and books on Confirm', async () => {
    let posted = null;
    const fetchFn = makeFetch({
      onBook: (options) => {
        posted = options.body;
        return jsonRes({
          ok: true,
          token: TOKEN,
          booking: {
            id: 'f00d'.repeat(8),
            pageId: PAGE_ID,
            title: 'Intro call',
            start: SLOT,
            end: SLOT + HOUR,
            location: 'Video call',
            organizer: 'Nariman',
            name: 'Ada',
            email: 'ada@example.com',
            status: 'confirmed',
            canCancel: true,
          },
          emailed: { guest: true, host: true },
        });
      },
    });
    await openPicker(fetchFn);

    // Tap the first time → it arms with a Confirm next to it.
    root.querySelectorAll('.slot')[0].click();
    expect(root.querySelector('.slot-confirm')).toBeTruthy();
    root.querySelector('.slot-confirm').click();

    // The details form.
    expect(root.textContent).toContain('Enter your details');
    root.querySelector('#bk-name').value = 'Ada';
    root.querySelector('#bk-email').value = 'ada@example.com';
    root.querySelector('#bk-notes').value = 'Hello!';
    root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    await tick();

    // The POST was urlencoded (a CORS simple request) and carried everything.
    const params = posted instanceof URLSearchParams ? posted : new URLSearchParams(String(posted));
    expect(params.get('start')).toBe(String(SLOT));
    expect(params.get('name')).toBe('Ada');
    expect(params.get('email')).toBe('ada@example.com');
    expect(params.get('notes')).toBe('Hello!');
    expect(params.get('tz')).toBeTruthy();

    // Confirmation screen with the manage link and an .ics download.
    expect(root.textContent).toContain("You're scheduled");
    expect(root.textContent).toContain('confirmation email is on its way');
    const manage = [...root.querySelectorAll('a')].find((a) => a.href.includes('/booking/'));
    expect(manage.href).toBe(`${WORKER}/booking/${TOKEN}`);
    const ics = [...root.querySelectorAll('a')].find((a) => (a.getAttribute('href') || '').startsWith('data:text/calendar'));
    expect(ics).toBeTruthy();
    expect(decodeURIComponent(ics.getAttribute('href'))).toContain('BEGIN:VEVENT');
  });

  it('validates name and email before posting', async () => {
    const onBook = vi.fn();
    await openPicker(makeFetch({ onBook }));
    root.querySelectorAll('.slot')[0].click();
    root.querySelector('.slot-confirm').click();
    root.querySelector('#bk-email').value = 'not-an-email';
    root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    expect(onBook).not.toHaveBeenCalled();
    expect(root.querySelector('#bk-name').getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector('#bk-email').getAttribute('aria-invalid')).toBe('true');
  });

  it('a lost race (409) returns to a fresh grid with an explanation', async () => {
    const fetchFn = makeFetch({ onBook: () => jsonRes({ error: 'slot_taken' }, 409) });
    await openPicker(fetchFn);
    root.querySelectorAll('.slot')[0].click();
    root.querySelector('.slot-confirm').click();
    root.querySelector('#bk-name').value = 'Ada';
    root.querySelector('#bk-email').value = 'ada@example.com';
    root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    await tick();
    expect(root.textContent).toContain('That time was just booked');
    expect(root.querySelectorAll('.cal-day').length).toBeGreaterThan(0); // back on the picker
  });

  it('a slot the page no longer offers (400 invalid_slot) also returns to a fresh grid (regression)', async () => {
    const fetchFn = makeFetch({ onBook: () => jsonRes({ error: 'invalid_slot' }, 400) });
    await openPicker(fetchFn);
    root.querySelectorAll('.slot')[0].click();
    root.querySelector('.slot-confirm').click();
    root.querySelector('#bk-name').value = 'Ada';
    root.querySelector('#bk-email').value = 'ada@example.com';
    root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    await tick();
    expect(root.textContent).toContain('no longer available');
    expect(root.querySelectorAll('.cal-day').length).toBeGreaterThan(0);
    // Never the dead-end "check your connection" copy for a permanent refusal.
    expect(root.textContent).not.toContain('check your connection');
  });

  it('shows "Loading times…" while the first slot fetch is in flight (regression)', async () => {
    let resolveSlots;
    const fetchFn = vi.fn((url) => {
      const u = String(url);
      if (u.includes('/slots')) {
        return new Promise((resolve) => {
          resolveSlots = () =>
            resolve({ ok: true, status: 200, json: async () => ({ ok: true, slots: [SLOT] }) });
        });
      }
      return jsonRes({ ok: true, page: pageView(), firstAvailable: SLOT, now: Date.now() });
    });
    init({ root, hash: bookHash(), fetchFn });
    await tick();
    await tick();
    expect(root.textContent).toContain('Loading times');
    resolveSlots();
    await tick();
    expect(root.textContent).not.toContain('Loading times');
    expect(root.querySelectorAll('.slot')).toHaveLength(1);
  });

  it('still renders the confirmation when the worker omits the times (a render throw used to blank the page)', async () => {
    const fetchFn = makeFetch({
      onBook: () =>
        jsonRes({
          ok: true,
          token: TOKEN,
          booking: { id: 'f00d'.repeat(8), title: 'Intro call', email: 'ada@example.com', status: 'confirmed' },
        }),
    });
    await openPicker(fetchFn);
    root.querySelectorAll('.slot')[0].click();
    root.querySelector('.slot-confirm').click();
    root.querySelector('#bk-name').value = 'Ada';
    root.querySelector('#bk-email').value = 'ada@example.com';
    root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    await tick();
    // The booking exists server-side by now — the page must say so, not blank.
    expect(root.textContent).toContain("You're scheduled");
    expect(root.textContent).toContain('Your booking is confirmed.');
    // No .ics without times to put in it, but the manage link still stands.
    expect(
      [...root.querySelectorAll('a')].some((a) => (a.getAttribute('href') || '').startsWith('data:text/calendar')),
    ).toBe(false);
    expect([...root.querySelectorAll('a')].find((a) => a.href.includes('/booking/'))).toBeTruthy();
  });

  it('keeps the keyboard in place when the form is left behind', async () => {
    const fetchFn = makeFetch({
      onBook: () => jsonRes({ error: 'slot_taken' }, 409),
    });
    await openPicker(fetchFn);
    const slot = root.querySelectorAll('.slot')[1];
    const chosen = slot.getAttribute('data-focus-key');
    slot.click(); // arm
    root.querySelector('.slot-confirm').click(); // -> details form

    // Back: the pressed button doesn't survive the render, so without an
    // explicit target focus fell all the way out to <body>.
    [...root.querySelectorAll('.ghost')].find((b) => b.textContent === 'Back').click();
    expect(document.activeElement.getAttribute('data-focus-key')).toBe(chosen);

    // A lost race bounces back to the grid — land on the explanation.
    root.querySelectorAll('.slot')[1].click();
    root.querySelector('.slot-confirm').click();
    root.querySelector('#bk-name').value = 'Ada';
    root.querySelector('#bk-email').value = 'ada@example.com';
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    await tick();
    expect(document.activeElement.classList.contains('banner--err')).toBe(true);
    expect(document.activeElement.textContent).toContain('just booked');
  });

  it('keeps typed details when going back to pick a different time', async () => {
    await openPicker(makeFetch({}));
    root.querySelectorAll('.slot')[0].click();
    root.querySelector('.slot-confirm').click();
    root.querySelector('#bk-name').value = 'Ada';
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Back').click();
    await tick();
    root.querySelectorAll('.slot')[1].click();
    root.querySelector('.slot-confirm').click();
    expect(root.querySelector('#bk-name').value).toBe('Ada');
  });
});

describe('book.html: managing a booking', () => {
  function confirmedBooking(overrides = {}) {
    return {
      id: 'f00d'.repeat(8),
      pageId: PAGE_ID,
      title: 'Intro call',
      start: SLOT,
      end: SLOT + HOUR,
      location: 'Video call',
      organizer: 'Nariman',
      name: 'Ada',
      email: 'ada@example.com',
      status: 'confirmed',
      cancelledBy: '',
      canCancel: true,
      ...overrides,
    };
  }

  it('renders the booking and cancels it with an optional note', async () => {
    let cancelBody = null;
    const fetchFn = makeFetch({
      booking: confirmedBooking(),
      onCancel: (options) => {
        cancelBody = options.body;
        return jsonRes({ ok: true, booking: confirmedBooking({ status: 'cancelled', cancelledBy: 'guest', canCancel: false }) });
      },
    });
    init({ root, hash: `#w=${encodeURIComponent(WORKER)}&t=${TOKEN}`, fetchFn });
    await tick();
    await tick();

    expect(root.textContent).toContain('Intro call');
    expect(root.textContent).toContain('ada@example.com');
    root.querySelector('#cancel-reason').value = 'Conflict came up';
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Cancel booking').click();
    await tick();
    await tick();

    const params = cancelBody instanceof URLSearchParams ? cancelBody : new URLSearchParams(String(cancelBody));
    expect(params.get('reason')).toBe('Conflict came up');
    expect(root.textContent).toContain('cancelled');
    // The page is still enabled, so a rebook link is offered.
    const rebook = [...root.querySelectorAll('a')].find((a) => a.href.includes(`/book/${PAGE_ID}`));
    expect(rebook).toBeTruthy();
  });

  it('says why there is no cancel control once the meeting has started', async () => {
    const fetchFn = makeFetch({ booking: confirmedBooking({ canCancel: false }) });
    init({ root, hash: `#w=${encodeURIComponent(WORKER)}&t=${TOKEN}`, fetchFn });
    await tick();
    await tick();
    expect([...root.querySelectorAll('button')].find((b) => b.textContent === 'Cancel booking')).toBeUndefined();
    expect(root.textContent).toContain('can no longer be cancelled');
  });

  it('a cancel refused because the meeting started reloads read-only, and says so', async () => {
    // The worker answers 410 once the start time has passed. The page used to
    // reload and quietly come back without the button or the typed note.
    let started = false;
    const fetchFn = vi.fn((url) => {
      const u = String(url);
      if (u === `${WORKER}/api/booking/${TOKEN}/cancel`) {
        started = true;
        return jsonRes({ error: 'started' }, 410);
      }
      if (u === `${WORKER}/api/booking/${TOKEN}`) {
        return jsonRes({ ok: true, booking: confirmedBooking({ canCancel: !started }), page: { id: PAGE_ID, enabled: true } });
      }
      return jsonRes({ error: 'not_found' }, 404);
    });
    init({ root, hash: `#w=${encodeURIComponent(WORKER)}&t=${TOKEN}`, fetchFn });
    await tick();
    await tick();
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Cancel booking').click();
    await tick();
    await tick();
    await tick();
    const notice = root.querySelector('.banner[role="status"]');
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain('already started');
    expect([...root.querySelectorAll('button')].find((b) => b.textContent === 'Cancel booking')).toBeUndefined();
    // Still confirmed — the join link stays, nothing reads as cancelled.
    expect(root.textContent).not.toContain('was cancelled');
  });

  it('a failed cancel keeps the typed note and offers the button again', async () => {
    const fetchFn = makeFetch({
      booking: confirmedBooking(),
      onCancel: () => Promise.reject(new Error('network down')),
    });
    init({ root, hash: `#w=${encodeURIComponent(WORKER)}&t=${TOKEN}`, fetchFn });
    await tick();
    await tick();

    root.querySelector('#cancel-reason').value = 'Sorry — my flight moved to Thursday';
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Cancel booking').click();
    await tick();
    await tick();

    expect(root.textContent).toContain("Couldn't cancel");
    // The guest's own words are irreplaceable — the re-render must keep them.
    expect(root.querySelector('#cancel-reason').value).toBe('Sorry — my flight moved to Thursday');
    const retry = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Cancel booking');
    expect(retry).toBeTruthy();
    expect(retry.disabled).toBe(false);
  });

  it('shows who cancelled when the organizer did', async () => {
    const fetchFn = makeFetch({
      booking: confirmedBooking({ status: 'cancelled', cancelledBy: 'host', canCancel: false }),
    });
    init({ root, hash: `#w=${encodeURIComponent(WORKER)}&t=${TOKEN}`, fetchFn });
    await tick();
    await tick();
    expect(root.textContent).toContain('cancelled by the organizer');
    expect(root.querySelector('#cancel-reason')).toBe(null);
  });

  it('an unknown token lands on the inactive-link screen', async () => {
    const fetchFn = vi.fn(() => jsonRes({ error: 'not_found' }, 404));
    init({ root, hash: `#w=${encodeURIComponent(WORKER)}&t=${TOKEN}`, fetchFn });
    await tick();
    await tick();
    expect(root.textContent).toContain("This link isn't active");
  });
});

describe('book.html: meeting links', () => {
  const JOIN = 'https://meetings.puter.com/#/m/abcd-efgh-ijkl';

  function bookedWith(meetingUrl, overrides = {}) {
    return makeFetch({
      onBook: () =>
        jsonRes({
          ok: true,
          token: TOKEN,
          booking: {
            id: 'f00d'.repeat(8),
            pageId: PAGE_ID,
            title: 'Intro call',
            start: SLOT,
            end: SLOT + HOUR,
            location: '',
            meetingUrl,
            organizer: 'Nariman',
            name: 'Ada',
            email: 'ada@example.com',
            status: 'confirmed',
            canCancel: true,
            ...overrides,
          },
          emailed: { guest: true, host: true },
        }),
    });
  }

  async function bookThrough(fetchFn) {
    init({ root, hash: bookHash(), fetchFn });
    await tick();
    await tick();
    root.querySelectorAll('.slot')[0].click();
    root.querySelector('.slot-confirm').click();
    root.querySelector('#bk-name').value = 'Ada';
    root.querySelector('#bk-email').value = 'ada@example.com';
    root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    await tick();
  }

  it('the confirmation shows a clickable Join row and writes the link into the .ics', async () => {
    await bookThrough(bookedWith(JOIN));
    expect(root.textContent).toContain("You're scheduled");
    const join = [...root.querySelectorAll('a')].find((a) => a.getAttribute('href') === JOIN);
    expect(join).toBeTruthy();
    expect(join.textContent).toBe(JOIN);
    expect(join.rel).toContain('noopener');

    const ics = decodeURIComponent(
      [...root.querySelectorAll('a')]
        .find((a) => (a.getAttribute('href') || '').startsWith('data:text/calendar'))
        .getAttribute('href'),
    );
    expect(ics).toContain(`URL:${JOIN}`);
    expect(ics).toContain(`X-GOOGLE-CONFERENCE:${JOIN}`);
    expect(ics).toContain(`CONFERENCE;VALUE=URI;FEATURE=VIDEO:${JOIN}`);
    expect(ics).not.toContain('LOCATION:'); // never as a location — Gmail maps those
    expect(ics).toContain(`DESCRIPTION:Join: ${JOIN}`);
  });

  it('holds the .ics UID to the worker id shape, so a rogue id cannot inject ICS lines', async () => {
    await bookThrough(bookedWith(JOIN, { id: 'x\r\nATTACH:https://evil.example/x.exe\r\nX-INJECTED:1' }));
    expect(root.textContent).toContain("You're scheduled");
    const ics = decodeURIComponent(
      [...root.querySelectorAll('a')]
        .find((a) => (a.getAttribute('href') || '').startsWith('data:text/calendar'))
        .getAttribute('href'),
    );
    expect(ics).not.toContain('evil.example');
    expect(ics).not.toContain('ATTACH');
    expect(ics).toContain('UID:booking@calendar.puter.com');
  });

  it('says so when the worker hands back a booking the guest already had', async () => {
    const fetchFn = makeFetch({
      onBook: () =>
        jsonRes({
          ok: true,
          duplicate: true,
          booking: {
            id: 'f00d'.repeat(8),
            pageId: PAGE_ID,
            title: 'Intro call',
            start: SLOT,
            end: SLOT + HOUR,
            location: '',
            organizer: 'Nariman',
            name: 'Ada',
            email: 'ada@example.com',
            status: 'confirmed',
            canCancel: true,
          },
          emailed: { guest: false, host: false },
        }),
    });
    await bookThrough(fetchFn);
    expect(root.textContent).toContain("You're scheduled");
    expect(root.textContent).toContain('You had already booked this time');
    // No token came back (only its hash is stored), so no manage link is
    // promised — but the .ics is still offered.
    expect(root.textContent).not.toContain('Cancel this booking');
    expect(
      [...root.querySelectorAll('a')].find((a) => (a.getAttribute('href') || '').startsWith('data:text/calendar')),
    ).toBeTruthy();
  });

  it('escapes a lone CR in the .ics so a title cannot split a property line', async () => {
    await bookThrough(
      bookedWith('', {
        title: 'Intro\rSUMMARY:injected',
        location: 'Room\rURL:https://evil.example/',
      }),
    );
    const ics = decodeURIComponent(
      [...root.querySelectorAll('a')]
        .find((a) => (a.getAttribute('href') || '').startsWith('data:text/calendar'))
        .getAttribute('href'),
    );
    expect(ics).toContain('SUMMARY:Intro\\nSUMMARY:injected');
    expect(ics).toContain('LOCATION:Room\\nURL:https://evil.example/');
    // The only CRs left are the property-line separators.
    expect(ics).not.toMatch(/[^\n]\r[^\n]/);
  });

  it('never renders a link that is not a Puter Meetings room URL', async () => {
    const evil = 'https://evil.example/#/m/abcd-efgh-ijkl';
    await bookThrough(bookedWith(evil));
    expect(root.textContent).toContain("You're scheduled");
    expect([...root.querySelectorAll('a')].find((a) => a.getAttribute('href') === evil)).toBeUndefined();
    const ics = decodeURIComponent(
      [...root.querySelectorAll('a')]
        .find((a) => (a.getAttribute('href') || '').startsWith('data:text/calendar'))
        .getAttribute('href'),
    );
    expect(ics).not.toContain(evil);
  });

  it('the manage view shows Join while confirmed, and drops it once cancelled', async () => {
    const booking = {
      id: 'f00d'.repeat(8),
      pageId: PAGE_ID,
      title: 'Intro call',
      start: SLOT,
      end: SLOT + HOUR,
      location: 'Video call',
      meetingUrl: JOIN,
      organizer: 'Nariman',
      name: 'Ada',
      email: 'ada@example.com',
      status: 'confirmed',
      cancelledBy: '',
      canCancel: true,
    };
    const fetchFn = makeFetch({
      booking,
      onCancel: () =>
        jsonRes({ ok: true, booking: { ...booking, status: 'cancelled', cancelledBy: 'guest', canCancel: false } }),
    });
    init({ root, hash: `#w=${encodeURIComponent(WORKER)}&t=${TOKEN}`, fetchFn });
    await tick();
    await tick();
    expect([...root.querySelectorAll('a')].find((a) => a.getAttribute('href') === JOIN)).toBeTruthy();

    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Cancel booking').click();
    await tick();
    await tick();
    // The room was never started — a cancelled booking offers nothing to join.
    expect([...root.querySelectorAll('a')].find((a) => a.getAttribute('href') === JOIN)).toBeUndefined();
  });
});

describe("book.html: the host's picture", () => {
  const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

  it('shows the picture above the host name when the page publishes one', async () => {
    await openPicker(makeFetch({ page: pageView({ organizerPicture: PIC }) }));
    const pic = root.querySelector('.host-pic');
    expect(pic).toBeTruthy();
    expect(pic.getAttribute('src')).toBe(PIC);
    // Decorative: the host's name is the next node, as text.
    expect(pic.alt).toBe('');
    expect(pic.nextElementSibling.textContent).toBe('Nariman');
  });

  it('removes an undecodable picture while keeping the booking page usable', async () => {
    await openPicker(makeFetch({ page: pageView({ organizerPicture: PIC }) }));
    root.querySelector('.host-pic').dispatchEvent(new Event('error'));
    expect(root.querySelector('.host-pic')).toBe(null);
    expect(root.textContent).toContain('Nariman');
    expect(root.querySelector('.slot')).toBeTruthy();
  });

  it('shows nothing when the page publishes none', async () => {
    await openPicker(makeFetch());
    expect(root.querySelector('.host-pic')).toBe(null);
  });

  it('renders only inline image data, whatever the worker says', async () => {
    // Belt and braces with the worker's own check: this is the value that
    // becomes an <img src> in a stranger's browser.
    for (const bad of ['https://tracker.example/pixel.png', 'javascript:alert(1)', '/etc/passwd', 42, {}]) {
      await openPicker(makeFetch({ page: pageView({ organizerPicture: bad }) }));
      expect(root.querySelector('.host-pic'), String(bad)).toBe(null);
    }
  });

  it('keeps the picture in view while the guest fills the form in', async () => {
    await openPicker(makeFetch({ page: pageView({ organizerPicture: PIC }) }));
    root.querySelectorAll('.slot')[0].click(); // arm
    root.querySelector('.slot-confirm').click(); // → the details step
    expect(root.textContent).toContain('Enter your details');
    expect(root.querySelector('.host-pic')).toBeTruthy();
  });
});

describe('book.html: the picker holds its height', () => {
  // A card that resizes between two clicks is a page that won't hold still
  // while it is read — and it is centred in the viewport, so resizing moves it.
  // The height comes from the month column, which is why these two invariants
  // are what the CSS is standing on.

  it('always lays out six week rows, whatever the month needs', async () => {
    // November 2030 fits in five rows from any week start (the 1st is a
    // Friday), so the sixth is entirely filler — without it, stepping into
    // this month from a six-row one shortened the card by a whole row.
    const nov = Date.UTC(2030, 10, 15, 9);
    await openPicker(makeFetch({ slots: [nov, nov + HOUR], firstAvailable: nov }));
    const cells = [...root.querySelectorAll('.cal-grid > *')];
    expect(cells).toHaveLength(7 + 42); // weekday headers + six rows
    expect(root.querySelectorAll('.cal-day')).toHaveLength(30); // November's dates
    // Every filler carries the class that holds its row open; a row of cells
    // with nothing in it collapses to no height at all.
    const blanks = cells.slice(7).filter((n) => n.tagName === 'DIV');
    expect(blanks).toHaveLength(12);
    expect(blanks.every((n) => n.className === 'cal-blank')).toBe(true);
  });

  it('hangs the times list in a frame, so its length never sizes the card', async () => {
    const many = [];
    for (let i = 0; i < 22; i++) many.push(SLOT + i * (HOUR / 2));
    await openPicker(makeFetch({ slots: many }));
    const frame = root.querySelector('.times-frame');
    expect(frame).toBeTruthy();
    // The scroller must be INSIDE the frame: the frame is what takes the
    // month's height, and the scroller is taken out of flow within it.
    expect(frame.querySelector('.times-scroll')).toBeTruthy();
    expect(root.querySelectorAll('.slot')).toHaveLength(22);
  });
});

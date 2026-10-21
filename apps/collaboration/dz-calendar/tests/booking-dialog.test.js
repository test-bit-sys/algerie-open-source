import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openBookingEditor } from '../src/js/booking-dialog.js';
import { normalizePage } from '../src/js/booking.js';

function makeBooking(overrides = {}) {
  return {
    savePage: vi.fn(async (input) => normalizePage(input)),
    deletePage: vi.fn(async () => ({})),
    linkFor: vi.fn(() => null),
    displayName: vi.fn(() => 'nariman'),
    setDisplayName: vi.fn(async (raw) => String(raw).trim() || 'nariman'),
    upcomingCount: vi.fn(() => 0),
    onUpdate: vi.fn(() => () => {}),
    ...overrides,
  };
}

const store = { getSettings: () => ({ weekStartsOn: 0, hour12: true }) };

function dialog() {
  return document.querySelector('.modal--booking');
}

function submit(form) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** The "HH:MM" a time field holds (its text box shows the formatted time). */
const timeOf = (input) => input.closest('.time-field').dataset.value;

afterEach(() => {
  document.querySelectorAll('.modal-scrim').forEach((n) => n.remove());
  document.body.replaceChildren();
});

describe('booking editor dialog', () => {
  it('resolves the host email (one-time grant prompt) when the editor opens', async () => {
    // The worker can only email the host about bookings if the sync can read
    // their address, and getUser() withholds it until the email-read grant.
    // Opening the editor is the deliberate moment to ask (like the event
    // modal's guest field) — without this, host notifications silently never
    // send for anyone who hasn't used the guests feature on this origin.
    const requestEmail = vi.fn(async () => 'host@example.com');
    openBookingEditor({ booking: makeBooking(), store, requestEmail });
    await tick();
    expect(requestEmail).toHaveBeenCalledTimes(1);
  });

  it('creates a page with the defaults (Mon–Fri 9–17, 30 minutes)', async () => {
    const booking = makeBooking();
    openBookingEditor({ booking, store });
    const form = dialog();
    expect(form).toBeTruthy();
    expect(form.querySelector('.modal__title').textContent).toBe('New booking link');

    // Weekday switches: Sunday-start order — off, on ×5, off.
    const toggles = [...form.querySelectorAll('.bk-day__head input')];
    expect(toggles.map((t) => t.checked)).toEqual([false, true, true, true, true, true, false]);

    form.querySelector('.input--title').value = 'Coffee chat';
    submit(form);
    await tick();

    expect(booking.savePage).toHaveBeenCalledTimes(1);
    const payload = booking.savePage.mock.calls[0][0];
    expect(payload.title).toBe('Coffee chat');
    expect(payload.durationMin).toBe(30);
    expect(payload.incrementMin).toBe(30); // "same as duration"
    expect(payload.enabled).toBe(true);
    expect(payload.hours[1]).toEqual([{ start: 540, end: 1020 }]);
    expect(payload.hours[0]).toEqual([]);
    expect(dialog()).toBe(null); // closed on save
  });

  it('edits weekly hours: toggling days and adding a second interval', async () => {
    const booking = makeBooking();
    openBookingEditor({ booking, store });
    const form = dialog();

    // Turn Saturday on (last row in Sunday-start order)…
    const rows = [...form.querySelectorAll('.bk-day')];
    rows[6].querySelector('input[type="checkbox"]').click();
    // …and give Monday (row 1) a second interval.
    const monday = [...dialog().querySelectorAll('.bk-day')][1];
    monday.querySelector('.bk-day__add').click();

    submit(dialog());
    await tick();
    const payload = booking.savePage.mock.calls[0][0];
    expect(payload.hours[6].length).toBe(1);
    expect(payload.hours[1].length).toBe(2);
    expect(payload.hours[1][1].start).toBeGreaterThan(payload.hours[1][0].end);
  });

  it('never seeds an added interval inside the one before it', async () => {
    const booking = makeBooking();
    openBookingEditor({ booking, store });
    // A day running late leaves little room: seeded an hour before its own end
    // (the old behaviour) the new row sat INSIDE the first, and normalizeHours
    // fused the pair on save — two rows in, one row out, nothing said.
    const end = dialog().querySelector('input[aria-label="Monday end time"]');
    end.value = '23:00';
    end.dispatchEvent(new Event('change', { bubbles: true }));
    [...dialog().querySelectorAll('.bk-day')][1].querySelector('.bk-day__add').click();

    submit(dialog());
    await tick();
    const monday = booking.savePage.mock.calls[0][0].hours[1];
    expect(monday).toHaveLength(2);
    expect(monday[1].start).toBeGreaterThan(monday[0].end);
  });

  it('offers no Add interval once the day has no room for another', async () => {
    openBookingEditor({ booking: makeBooking(), store });
    const end = dialog().querySelector('input[aria-label="Monday end time"]');
    end.value = '23:50';
    end.dispatchEvent(new Event('change', { bubbles: true }));
    // Re-render the row (the toggle is the cheapest way in the DOM).
    const monday = () => [...dialog().querySelectorAll('.bk-day')][1];
    monday().querySelector('.bk-day__add').click();
    expect(monday().querySelector('.bk-day__add')).toBe(null);
  });

  it('refuses to save intervals that overlap instead of silently fusing them', async () => {
    const booking = makeBooking();
    openBookingEditor({ booking, store });
    [...dialog().querySelectorAll('.bk-day')][1].querySelector('.bk-day__add').click();
    // Drag the second block back over the first: 09:00–17:00 + 14:00–19:00
    // used to save as one 09:00–19:00 row.
    const starts = [...dialog().querySelectorAll('input[aria-label="Monday start time"]')];
    starts[1].value = '14:00';
    starts[1].dispatchEvent(new Event('change', { bubbles: true }));

    submit(dialog());
    await tick();
    expect(booking.savePage).not.toHaveBeenCalled();
    expect(dialog().querySelector('.modal__error').textContent).toContain('overlap');

    // Touching blocks are fine — fusing them changes nothing about the hours.
    starts[1].value = '17:00';
    starts[1].dispatchEvent(new Event('change', { bubbles: true }));
    submit(dialog());
    await tick();
    expect(booking.savePage).toHaveBeenCalled();
  });

  it('refuses a duration no weekly interval can hold', async () => {
    const booking = makeBooking();
    openBookingEditor({ booking, store });
    // Monday 09:00–10:00 only, but a two-hour meeting: the slot engine needs
    // the whole meeting inside one interval, so this page could never offer a
    // time — and nothing would say so until a guest opened the link.
    const end = dialog().querySelector('input[aria-label="Monday end time"]');
    end.value = '10:00';
    end.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 2; i < 7; i++) {
      const toggle = [...dialog().querySelectorAll('.bk-day')][i].querySelector('input[type="checkbox"]');
      if (toggle.checked) toggle.click();
    }
    const duration = dialog().querySelector('select[aria-label="Duration"]');
    duration.value = '120';
    duration.dispatchEvent(new Event('change', { bubbles: true }));

    submit(dialog());
    await tick();
    expect(booking.savePage).not.toHaveBeenCalled();
    expect(dialog().querySelector('.modal__error').textContent).toContain('2 hours');
    expect(dialog().querySelector('.modal__error').textContent).toContain('1 hour');

    // Widen the interval and it saves.
    end.value = '12:00';
    end.dispatchEvent(new Event('change', { bubbles: true }));
    submit(dialog());
    await tick();
    expect(booking.savePage).toHaveBeenCalled();
  });

  it('refuses to save with no weekly intervals at all', async () => {
    const booking = makeBooking();
    openBookingEditor({ booking, store });
    // Turn every enabled day off.
    for (let i = 0; i < 7; i++) {
      const toggle = [...dialog().querySelectorAll('.bk-day')][i].querySelector('input[type="checkbox"]');
      if (toggle.checked) toggle.click();
    }
    submit(dialog());
    await tick();
    expect(booking.savePage).not.toHaveBeenCalled();
    expect(dialog().querySelector('.modal__error').textContent).toContain('at least one weekly interval');
  });

  it('refuses an interval whose end is not after its start', async () => {
    const booking = makeBooking();
    openBookingEditor({ booking, store });
    const monday = [...dialog().querySelectorAll('.bk-day')][1];
    const [startInput, endInput] = monday.querySelectorAll('.time-field .input');
    startInput.value = '15:00';
    startInput.dispatchEvent(new Event('change'));
    endInput.value = '09:00';
    endInput.dispatchEvent(new Event('change'));
    submit(dialog());
    await tick();
    expect(booking.savePage).not.toHaveBeenCalled();
    expect(dialog().querySelector('.modal__error').textContent).toContain('Monday');
  });

  it('a double-clicked save fires one savePage, not two pages (regression)', async () => {
    let resolveSave;
    const booking = makeBooking({
      savePage: vi.fn(
        (input) => new Promise((resolve) => (resolveSave = () => resolve(normalizePage(input)))),
      ),
    });
    openBookingEditor({ booking, store });
    const form = dialog();
    submit(form);
    submit(form); // the second click of a double-click, save still in flight
    expect(booking.savePage).toHaveBeenCalledTimes(1);
    // The whole footer is disabled while the save is in flight.
    expect([...form.querySelectorAll('.modal__foot button')].every((b) => b.disabled)).toBe(true);
    resolveSave();
    await tick();
    expect(dialog()).toBe(null); // closed once the save lands
  });

  it('a failed save re-enables the form so it can be retried', async () => {
    const booking = makeBooking({
      savePage: vi
        .fn()
        .mockRejectedValueOnce(new Error('Could not save the booking link. Please try again.'))
        .mockImplementation(async (input) => normalizePage(input)),
    });
    openBookingEditor({ booking, store });
    submit(dialog());
    await tick();
    expect(dialog()).toBeTruthy(); // still open after the failure
    expect([...dialog().querySelectorAll('.modal__foot button')].some((b) => b.disabled)).toBe(false);
    submit(dialog());
    await tick();
    expect(booking.savePage).toHaveBeenCalledTimes(2);
    expect(dialog()).toBe(null);
  });

  it('shows the share link for an existing page, and a pending note before it exists', () => {
    const page = normalizePage({ id: 'ab12cd34ef', title: 'Office hours' });
    openBookingEditor({
      booking: makeBooking({ linkFor: () => 'https://cal-rsvp-x.puter.work/book/ab12cd34ef' }),
      store,
      page,
    });
    expect(dialog().querySelector('.bk-share__url').value).toBe(
      'https://cal-rsvp-x.puter.work/book/ab12cd34ef',
    );
    document.querySelectorAll('.modal-scrim').forEach((n) => n.remove());

    openBookingEditor({ booking: makeBooking({ linkFor: () => null }), store, page });
    expect(dialog().querySelector('.bk-share__pending').textContent).toContain('being prepared');
  });

  it('the pending share note resolves to the URL while the dialog is open', () => {
    // The link often doesn't exist yet when the editor opens (worker deploy
    // still propagating); the note promises it "will appear here in a moment"
    // — which only a live re-render can honor.
    let url = null;
    const listeners = new Set();
    const booking = makeBooking({
      linkFor: vi.fn(() => url),
      onUpdate: vi.fn((cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      }),
    });
    const page = normalizePage({ id: 'ab12cd34ef', title: 'Office hours' });
    openBookingEditor({ booking, store, page });
    expect(dialog().querySelector('.bk-share__pending')).toBeTruthy();

    url = 'https://cal-rsvp-x.puter.work/book/ab12cd34ef';
    listeners.forEach((cb) => cb());
    expect(dialog().querySelector('.bk-share__pending')).toBeNull();
    expect(dialog().querySelector('.bk-share__url').value).toBe(url);

    // Closing the dialog releases the subscription.
    dialog().querySelector('[aria-label="Close"]').click();
    expect(listeners.size).toBe(0);
  });

  it('deleting an existing page confirms first and cites upcoming bookings', async () => {
    const page = normalizePage({ id: 'ab12cd34ef', title: 'Office hours' });
    const booking = makeBooking({ upcomingCount: vi.fn(() => 2) });
    openBookingEditor({ booking, store, page });

    // The footer Delete opens a nested confirm.
    [...dialog().querySelectorAll('.modal__foot button')].find((b) => b.textContent.includes('Delete')).click();
    const confirm = document.getElementById('bk-del-title').closest('form');
    expect(confirm.textContent).toContain('2 upcoming bookings stay');
    submit(confirm);
    await tick();
    expect(booking.deletePage).toHaveBeenCalledWith('ab12cd34ef');
    expect(dialog()).toBe(null);
  });

  it('prefills an existing page and keeps its custom values on save', async () => {
    const page = normalizePage({
      id: 'ab12cd34ef',
      title: 'Deep dive',
      durationMin: 90,
      minNoticeMin: 1440,
      maxAdvanceDays: 14,
      bufferAfterMin: 15,
      maxPerDay: 3,
      enabled: false,
      hours: { 2: [{ start: 600, end: 720 }] },
    });
    const booking = makeBooking();
    openBookingEditor({ booking, store, page });
    expect(dialog().querySelector('.input--title').value).toBe('Deep dive');
    submit(dialog());
    await tick();
    const payload = booking.savePage.mock.calls[0][0];
    expect(payload.id).toBe('ab12cd34ef');
    expect(payload.durationMin).toBe(90);
    expect(payload.minNoticeMin).toBe(1440);
    expect(payload.maxAdvanceDays).toBe(14);
    expect(payload.bufferAfterMin).toBe(15);
    expect(payload.maxPerDay).toBe(3);
    expect(payload.enabled).toBe(false);
    expect(payload.hours[2]).toEqual([{ start: 600, end: 720 }]);
  });

  it('offers the Puter Meetings toggle — on for new pages, honoring the page when editing', async () => {
    const findToggle = () =>
      [...dialog().querySelectorAll('.inline-field')]
        .find((row) => row.textContent.includes('Puter Meetings'))
        .querySelector('input[type="checkbox"]');

    // New page: on by default, and saved as such.
    const booking = makeBooking();
    openBookingEditor({ booking, store });
    expect(findToggle().checked).toBe(true);
    submit(dialog());
    await tick();
    expect(booking.savePage.mock.calls[0][0].meet).toBe(true);

    // Turned off in the editor: saved off, and prefilled off next time.
    const second = makeBooking();
    openBookingEditor({ booking: second, store });
    findToggle().click();
    submit(dialog());
    await tick();
    expect(second.savePage.mock.calls[0][0].meet).toBe(false);

    const third = makeBooking();
    openBookingEditor({ booking: third, store, page: normalizePage({ id: 'ab12cd34ef', meet: false }) });
    expect(findToggle().checked).toBe(false);
  });
});

describe('booking editor — time fields', () => {
  it('gives every interval edge a 15-minute list that opens on its own time', () => {
    openBookingEditor({ booking: makeBooking(), store });
    const form = dialog();

    // The old <input type="time"> + <datalist> always opened on 00:00; the
    // combobox opens with the field's own slot highlighted.
    const timeInputs = [...form.querySelectorAll('.time-field .input')];
    expect(timeInputs.length).toBeGreaterThan(0);
    for (const input of timeInputs) expect(input.getAttribute('role')).toBe('combobox');

    const end = form.querySelector('input[aria-label="Monday end time"]');
    expect(end.value).toBe('5:00 PM');
    end.dispatchEvent(new Event('focus'));
    const list = form.querySelector('#' + end.getAttribute('aria-controls'));
    expect(list.hidden).toBe(false);
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(96);
    expect(list.querySelector('[aria-selected="true"]').dataset.min).toBe(String(17 * 60));
  });

  it('puts the interval back on screen when a time field is cleared', async () => {
    const booking = makeBooking();
    openBookingEditor({ booking, store });
    const start = dialog().querySelector('input[aria-label="Monday start time"]');
    expect(timeOf(start)).toBe('09:00');

    // A native time input commits '' for a cleared (or half-typed) value. The
    // interval keeps 09:00 either way — the field must say so rather than sit
    // blank while the page saves a time the host can no longer see.
    start.value = '';
    start.dispatchEvent(new Event('change', { bubbles: true }));
    expect(timeOf(start)).toBe('09:00');

    // A real edit still lands.
    start.value = '10:30';
    start.dispatchEvent(new Event('change', { bubbles: true }));
    submit(dialog());
    await Promise.resolve();
    expect(booking.savePage).toHaveBeenCalled();
    expect(booking.savePage.mock.calls[0][0].hours[1]).toEqual([{ start: 630, end: 1020 }]);
  });

  it('keeps the 23:59 midnight-end rendering valid for native form validation', () => {
    // A day ending at midnight is stored as 1440 and rendered as 23:59 — off
    // any 5- or 15-minute grid. With a step attribute that would be a
    // stepMismatch and the browser would swallow the submit with a bubble.
    openBookingEditor({
      booking: makeBooking(),
      store,
      page: normalizePage({ id: 'ab12cd34ef', hours: { 1: [{ start: 540, end: 1440 }] } }),
    });
    const end = dialog().querySelector('input[aria-label="Monday end time"]');
    expect(timeOf(end)).toBe('23:59');
    expect(end.validity.valid).toBe(true);
  });
});

describe("booking editor: the host's profile picture", () => {
  const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const found = async () => ({ state: 'found', picture: PIC });

  function row(form) {
    return form.querySelector('.bk-avatar-row');
  }
  function toggle(form) {
    return row(form).querySelector('input[type="checkbox"]');
  }

  it('is on for a new page, and off for one saved before the switch existed', async () => {
    const booking = makeBooking();
    openBookingEditor({ booking, store, readPicture: found });
    expect(toggle(dialog()).checked).toBe(true);
    submit(dialog());
    await tick();
    expect(booking.savePage.mock.calls[0][0].avatar).toBe(true);

    // A page whose link is already out there keeps what its host left it as —
    // normalizePage reads an absent field as off.
    const old = normalizePage({ title: 'Intro call' });
    expect(old.avatar).toBe(false);
    openBookingEditor({ booking, store, page: old, readPicture: found });
    expect(toggle(dialog()).checked).toBe(false);
  });

  it('carries the switch into the saved page, both ways', async () => {
    const booking = makeBooking();
    const page = normalizePage({ title: 'Intro call', avatar: true });
    openBookingEditor({ booking, store, page, readPicture: found });
    expect(toggle(dialog()).checked).toBe(true);
    toggle(dialog()).click();
    submit(dialog());
    await tick();
    expect(booking.savePage.mock.calls[0][0].avatar).toBe(false);
  });

  it('previews the picture guests would get', async () => {
    openBookingEditor({ booking: makeBooking(), store, user: { username: 'alice' }, readPicture: found });
    await tick();
    const img = row(dialog()).querySelector('.bk-avatar__img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(PIC);
    expect(img.alt).toBe(''); // decorative: the switch beside it says what it is
    expect(row(dialog()).querySelector('.bk-hint').textContent).toBe('');
  });

  it('removes a broken preview without changing the publishing choice', async () => {
    openBookingEditor({ booking: makeBooking(), store, user: { username: 'alice' }, readPicture: found });
    await tick();
    row(dialog()).querySelector('.bk-avatar__img').dispatchEvent(new Event('error'));
    expect(row(dialog()).querySelector('.bk-avatar__img')).toBe(null);
    expect(toggle(dialog()).checked).toBe(true);
  });

  it('says so when the account has no picture', async () => {
    const readPicture = async () => ({ state: 'none' });
    openBookingEditor({ booking: makeBooking(), store, readPicture });
    await tick();
    expect(row(dialog()).querySelector('.bk-hint').textContent).toMatch(/no picture/i);
    expect(row(dialog()).querySelector('.bk-avatar__img')).toBe(null);
    // The switch still works — the host may be about to add one.
    expect(toggle(dialog()).disabled).toBe(false);
  });

  it('claims nothing when it could not tell, and survives a read that fails', async () => {
    for (const readPicture of [async () => ({ state: 'unknown' }), async () => { throw new Error('offline'); }]) {
      openBookingEditor({ booking: makeBooking(), store, readPicture });
      await tick();
      const form = dialog();
      expect(form.querySelector('.bk-hint').textContent).toBe('');
      expect(form.querySelector('.bk-avatar__img')).toBe(null);
      expect(toggle(form).checked).toBe(true); // the switch is unaffected
      form.querySelector('.modal__foot .btn').click(); // Cancel, for the next round
    }
  });

  it('does not touch a dialog the host has already closed', async () => {
    let settle;
    const readPicture = () => new Promise((r) => (settle = r));
    openBookingEditor({ booking: makeBooking(), store, readPicture });
    const form = dialog();
    await tick(); // the read is in flight
    form.querySelector('.modal__foot .btn').click(); // Cancel, mid-read
    settle({ state: 'none' });
    await tick();
    expect(form.querySelector('.bk-hint').textContent).toBe('');
  });
});

describe("booking editor dialog — the host's name", () => {
  it('shows the name guests currently see, with the username as the fallback', () => {
    const booking = makeBooking({ displayName: () => 'Nariman Jelveh' });
    openBookingEditor({ booking, store, user: { username: 'nariman' } });
    const input = dialog().querySelector('.bk-name');
    expect(input.value).toBe('Nariman Jelveh');
    expect(input.placeholder).toBe('nariman');
    expect(input.getAttribute('maxlength')).toBe('80');
    expect(dialog().textContent).toContain('all your booking links');
    expect(dialog().textContent).toContain('Leave blank to use your username, nariman.');
  });

  it('saves the name only when it was edited — an untouched name is no settings write', async () => {
    const booking = makeBooking();
    openBookingEditor({ booking, store, user: { username: 'nariman' } });
    const form = dialog();
    form.querySelector('.input--title').value = 'Coffee chat';
    submit(form);
    await tick();
    expect(booking.savePage).toHaveBeenCalledTimes(1);
    expect(booking.setDisplayName).not.toHaveBeenCalled();
    expect(dialog()).toBe(null);

    const again = makeBooking();
    openBookingEditor({ booking: again, store, user: { username: 'nariman' } });
    const form2 = dialog();
    form2.querySelector('.input--title').value = 'Coffee chat';
    form2.querySelector('.bk-name').value = '  Nariman Jelveh ';
    submit(form2);
    await tick();
    expect(again.savePage).toHaveBeenCalledTimes(1);
    expect(again.setDisplayName).toHaveBeenCalledTimes(1);
    expect(again.setDisplayName).toHaveBeenCalledWith('  Nariman Jelveh ');
    expect(dialog()).toBe(null);
  });

  it('clearing the field is a change too — back to the username', async () => {
    const booking = makeBooking({ displayName: () => 'Nariman Jelveh' });
    openBookingEditor({ booking, store, user: { username: 'nariman' } });
    const form = dialog();
    form.querySelector('.input--title').value = 'Coffee chat';
    form.querySelector('.bk-name').value = '';
    submit(form);
    await tick();
    expect(booking.setDisplayName).toHaveBeenCalledWith('');
  });

  it('a name that fails to save is its own message — the page save stands', async () => {
    const booking = makeBooking({
      setDisplayName: vi.fn(async () => {
        throw new Error("You're offline — reconnect to change your name.");
      }),
    });
    openBookingEditor({ booking, store, user: { username: 'nariman' } });
    const form = dialog();
    form.querySelector('.input--title').value = 'Coffee chat';
    form.querySelector('.bk-name').value = 'Someone Else';
    submit(form);
    await tick();
    await tick();
    expect(booking.savePage).toHaveBeenCalledTimes(1);
    expect(dialog()).toBe(null); // closed: the page itself was saved
    expect(document.body.textContent).toContain('reconnect to change your name');
  });

  it('a booking module without the name API simply has no field', () => {
    const booking = makeBooking({ displayName: undefined, setDisplayName: undefined });
    openBookingEditor({ booking, store });
    expect(dialog()).toBeTruthy();
    expect(dialog().querySelector('.bk-name')).toBe(null);
  });
});

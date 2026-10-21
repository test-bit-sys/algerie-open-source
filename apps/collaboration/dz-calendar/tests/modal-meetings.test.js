import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEventModal } from '../src/js/modal.js';
import { DEFAULT_SETTINGS } from '../src/js/store.js';

/** Minimal store stand-in — the meeting row only needs settings and a save. */
function makeStore() {
  const saved = [];
  return {
    saved,
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    getEvent: () => null,
    getTask: () => null,
    saveEvent: async (e) => {
      saved.push(e);
      return e;
    },
    saveTask: async (t) => t,
    deleteTask: async () => {},
    applyOutOfOffice: async () => ({ declined: [], undo() {} }),
  };
}

const LINK = { code: 'abcd-efgh-ijkl', url: 'https://meetings.puter.com/#/m/abcd-efgh-ijkl' };

/** A stand-in for the meetings module: minting is local and synchronous. */
function makeMeetings({ available = true, link = LINK } = {}) {
  return {
    available: () => available,
    mintLink: vi.fn(() => ({ ...link })),
  };
}

const $ = (sel) => document.querySelector('.modal-scrim ' + sel);
const $$ = (sel) => [...document.querySelectorAll('.modal-scrim ' + sel)];
const fire = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));

const addButton = () => $$('.meeting__add').find((b) => /Add Puter Meetings link/.test(b.textContent));
const meetingRow = () => $('.meeting__row');
const meetingField = () => $('.meeting')?.closest('.field');
const removeButton = () => $('.meeting__row [aria-label="Remove meeting link"]');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('event modal — Puter Meetings link', () => {
  it('offers the button, mints a link on click, and saves it with the event', async () => {
    const store = makeStore();
    const meetings = makeMeetings();
    const modal = createEventModal({ store, meetings });
    modal.openNew({});

    const btn = addButton();
    expect(btn).toBeTruthy();
    btn.click();

    // Minting is stateless and local — the link appears synchronously.
    expect(meetings.mintLink).toHaveBeenCalledTimes(1);
    expect(meetingRow().textContent).toContain(LINK.url);
    expect(meetingRow().querySelector('a').href).toBe(LINK.url);

    fire($('form.modal'), 'submit');
    await flush();
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0].meeting).toEqual({ url: LINK.url, code: LINK.code });
  });

  it('hands keyboard focus to the link row on mint, and back to the offer on remove', () => {
    const modal = createEventModal({ store: makeStore(), meetings: makeMeetings() });
    modal.openNew({});
    addButton().click();
    // The clicked button is gone — focus lands on the row's first action.
    expect(document.activeElement).toBe($('.meeting__row [aria-label="Copy meeting link"]'));
    removeButton().click();
    expect(document.activeElement).toBe(addButton());
  });

  it('a link removed before saving simply never was — the offer returns, nothing saves', async () => {
    const store = makeStore();
    const meetings = makeMeetings();
    const modal = createEventModal({ store, meetings });
    modal.openNew({});
    addButton().click();

    removeButton().click();
    expect(meetingRow()).toBeFalsy();
    expect(addButton()).toBeTruthy();

    fire($('form.modal'), 'submit');
    await flush();
    expect(store.saved[0].meeting).toBeNull();
  });

  it('can mint again after a removal (each mint is a fresh code)', () => {
    const meetings = makeMeetings();
    const modal = createEventModal({ store: makeStore(), meetings });
    modal.openNew({});
    addButton().click();
    removeButton().click();
    addButton().click();
    expect(meetings.mintLink).toHaveBeenCalledTimes(2);
    expect(meetingRow().textContent).toContain(LINK.url);
  });

  it('shows an existing event link and detaches (never touches) it on remove', async () => {
    const store = makeStore();
    const meetings = makeMeetings();
    const modal = createEventModal({ store, meetings });
    const event = {
      id: 'e1',
      title: 'Standup',
      start: Date.parse('2031-05-05T09:00'),
      end: Date.parse('2031-05-05T09:30'),
      allDay: false,
      meeting: { url: LINK.url, code: LINK.code },
    };
    modal.openEdit(event);

    expect(meetingRow().textContent).toContain(LINK.url);
    removeButton().click();
    expect(meetingRow()).toBeFalsy();

    fire($('form.modal'), 'submit');
    await flush();
    expect(store.saved[0].meeting).toBeNull();
  });

  it('still shows (and can remove) a link when the meetings module is absent', () => {
    const modal = createEventModal({ store: makeStore(), meetings: null });
    const event = {
      id: 'e1',
      title: 'Standup',
      start: Date.parse('2031-05-05T09:00'),
      end: Date.parse('2031-05-05T09:30'),
      allDay: false,
      meeting: { url: LINK.url },
    };
    modal.openEdit(event);
    expect(meetingRow().textContent).toContain(LINK.url);
    expect(removeButton()).toBeTruthy();
  });

  it('hides the row entirely when there is no link and nothing to offer', () => {
    const modal = createEventModal({ store: makeStore(), meetings: null });
    modal.openNew({});
    expect(meetingField().style.display).toBe('none');

    const noCrypto = createEventModal({
      store: makeStore(),
      meetings: makeMeetings({ available: false }),
    });
    noCrypto.close();
    noCrypto.openNew({});
    expect(meetingField().style.display).toBe('none');
  });

  it('keeps the row out of out-of-office and task modes', async () => {
    const meetings = makeMeetings();
    const modal = createEventModal({ store: makeStore(), meetings });
    modal.openNew({});
    expect(meetingField().style.display).toBe('');

    document.querySelector('.modal__mode [data-mode="ooo"]').click();
    expect(meetingField().style.display).toBe('none');
    document.querySelector('.modal__mode [data-mode="task"]').click();
    expect(meetingField().style.display).toBe('none');
    document.querySelector('.modal__mode [data-mode="event"]').click();
    expect(meetingField().style.display).toBe('');
  });
});

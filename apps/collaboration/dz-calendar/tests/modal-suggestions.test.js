import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEventModal } from '../src/js/modal.js';
import { DEFAULT_SETTINGS } from '../src/js/store.js';

/**
 * The details card's guest-suggestion block: what a pending suggestion looks
 * like to the host, and what Approve / Dismiss actually do. rsvp and invites
 * are stubbed — the round-trip itself is covered in rsvp-links.test.js.
 */

const HOST = 'host@example.com';
const HOUR = 3_600_000;

function makeEvent(overrides = {}) {
  const start = Date.now() + 24 * HOUR;
  return {
    id: 'e1',
    title: 'Team offsite',
    start,
    end: start + HOUR,
    organizer: { email: HOST },
    guests: [
      { email: HOST, status: 'accepted' },
      { email: 'ada@example.com', status: 'accepted' },
    ],
    reminders: [],
    ...overrides,
  };
}

function makeStore(event) {
  const saved = [];
  return {
    saved,
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    getEvent: (id) => (id === event.id ? event : null),
    getTask: () => null,
    saveEvent: vi.fn(async (e) => {
      // The real store normalizes and CAPS the guest list; stay honest about
      // the cap so the "list full" path can be exercised.
      const next = { ...event, ...e, guests: (e.guests || []).slice(0, 200) };
      Object.assign(event, next);
      saved.push(next);
      return next;
    }),
    saveTask: async (t) => t,
    deleteTask: async () => {},
    applyOutOfOffice: async () => ({ declined: [], undo() {} }),
  };
}

function makeRsvp(suggestions) {
  return {
    isHosted: () => true,
    linkableGuests: (ev) => ev.guests.filter((g) => g.email !== HOST),
    linksFor: () => ({}),
    refreshEvent: vi.fn(),
    onUpdate: vi.fn(() => () => {}),
    suggestionsFor: vi.fn(() => suggestions.map((s) => ({ ...s }))),
    dismissSuggestion: vi.fn(async (eventId, email) => {
      const i = suggestions.findIndex((s) => s.email === email);
      if (i !== -1) suggestions.splice(i, 1);
    }),
  };
}

function open({
  suggestions = [{ email: 'sara@example.com', name: 'Sara', by: 'ada@example.com', at: 1 }],
  invitesAvailable = true,
  event = makeEvent(),
} = {}) {
  const store = makeStore(event);
  const rsvp = makeRsvp(suggestions);
  const invites = {
    available: () => invitesAvailable,
    planFor: () => ({ eventId: '', ready: [], pending: [], waiting: 0, lastSentAt: 0 }),
    sendWhenReady: vi.fn(),
    send: vi.fn(),
  };
  const modal = createEventModal({
    store,
    user: { email: HOST },
    rsvp,
    invites,
    requestEmail: async () => HOST,
  });
  modal.openView(event);
  return { modal, store, rsvp, invites, event, suggestions };
}

const card = () => document.querySelector('.modal-scrim');
const block = () => card().querySelector('.view__suggestions');
const rowButton = (label) =>
  [...(block() ? block().querySelectorAll('button') : [])].find(
    (b) => b.textContent.trim() === label,
  );
const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('details card: guest suggestions', () => {
  const reset = () => {
    for (const node of document.querySelectorAll('.modal-scrim, .toast')) node.remove();
  };
  beforeEach(reset);
  afterEach(reset);

  it('shows who was suggested, by whom, with Approve and Dismiss', () => {
    open();
    expect(block()).toBeTruthy();
    expect(block().textContent).toContain('Guests suggested adding');
    expect(block().textContent).toContain('Sara — sara@example.com');
    expect(block().textContent).toContain('Suggested by ada@example.com');
    expect(rowButton('Add & invite')).toBeTruthy();
    expect(rowButton('Dismiss')).toBeTruthy();
  });

  it('renders nothing when there is nothing pending — and survives an rsvp stub without the method', () => {
    open({ suggestions: [] });
    expect(block()).toBeNull();
    reset();

    // Older fakes (and any consumer built before v11) lack suggestionsFor.
    const event = makeEvent();
    const rsvp = makeRsvp([]);
    delete rsvp.suggestionsFor;
    const modal = createEventModal({
      store: makeStore(event),
      user: { email: HOST },
      rsvp,
      requestEmail: async () => HOST,
    });
    modal.openView(event); // must not throw
    expect(block()).toBeNull();
  });

  it('never shows suggestions to a non-host (an invitation TO me)', () => {
    const event = makeEvent({
      organizer: { email: 'someone-else@example.com' },
      guests: [
        { email: 'someone-else@example.com', status: 'accepted' },
        { email: HOST, status: 'needs-action' },
      ],
    });
    const { rsvp } = open({ event });
    expect(block()).toBeNull();
    expect(rsvp.suggestionsFor).not.toHaveBeenCalled();
  });

  it('Approve adds the guest (name kept, needs-action) and hands off to sendWhenReady', async () => {
    const { store, invites, event } = open();
    rowButton('Add & invite').click();
    await flush();

    expect(store.saveEvent).toHaveBeenCalledTimes(1);
    const saved = store.saveEvent.mock.calls[0][0];
    expect(saved.guests.at(-1)).toEqual({
      email: 'sara@example.com',
      name: 'Sara',
      status: 'needs-action',
    });
    expect(invites.sendWhenReady).toHaveBeenCalledWith({ id: event.id });
  });

  it('labels the approval honestly when no email can be sent', () => {
    open({ invitesAvailable: false });
    expect(rowButton('Add guest')).toBeTruthy();
    expect(rowButton('Add & invite')).toBeUndefined();
  });

  it('a full guest list fails loudly instead of silently dropping the add', async () => {
    const event = makeEvent({
      guests: Array.from({ length: 200 }, (_, i) => ({
        email: `g${i}@example.com`,
        status: 'needs-action',
      })),
    });
    const { invites } = open({ event });
    rowButton('Add & invite').click();
    await flush();

    expect(invites.sendWhenReady).not.toHaveBeenCalled();
    const toasts = [...document.querySelectorAll('.toast')];
    expect(toasts.at(-1).textContent).toContain('guest list is full');
    expect(rowButton('Add & invite').disabled).toBe(false); // usable again
  });

  it('Dismiss settles through rsvp.dismissSuggestion and clears the row', async () => {
    const { rsvp, event } = open();
    rowButton('Dismiss').click();
    await flush();

    expect(rsvp.dismissSuggestion).toHaveBeenCalledWith(event.id, 'sara@example.com');
    expect(block()).toBeNull(); // card rebuilt without the block
  });

  it('a failed dismiss re-enables the row and says why', async () => {
    const { rsvp } = open();
    rsvp.dismissSuggestion.mockRejectedValueOnce(new Error('rsvp: /admin failed (502)'));
    rowButton('Dismiss').click();
    await flush();

    expect(rowButton('Dismiss').disabled).toBe(false);
    expect(rowButton('Add & invite').disabled).toBe(false);
    const toasts = [...document.querySelectorAll('.toast')];
    expect(toasts.at(-1).textContent).toContain('rsvp: /admin failed (502)');
  });

  it('never rebuilds the card underneath a nested dialog (focus trap stays intact)', async () => {
    let release;
    const { rsvp } = open();
    rsvp.dismissSuggestion.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    rowButton('Dismiss').click();
    const dialog = document.createElement('div');
    dialog.className = 'dialog-scrim';
    document.body.append(dialog);
    release();
    await flush();
    expect(block()).toBeTruthy(); // untouched — the settled row clears on next open
    dialog.remove();
  });

  it('freezes both buttons while a settle is in flight (no double-fire)', async () => {
    let release;
    const { rsvp } = open();
    rsvp.dismissSuggestion.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    rowButton('Dismiss').click();
    expect(rowButton('Dismiss').disabled).toBe(true);
    expect(rowButton('Add & invite').disabled).toBe(true);
    release();
    await flush();
  });
});

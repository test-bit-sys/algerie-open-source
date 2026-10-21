import { describe, it, expect, afterEach } from 'vitest';
import { createEventModal } from '../src/js/modal.js';
import { DEFAULT_SETTINGS } from '../src/js/store.js';

/**
 * The details card's guest header must describe exactly the rows under it.
 * An organizer who isn't on the guest list — Google emits that shape, and so
 * does an .ics import — gets a row of their own, so they have to be counted.
 */

const HOUR = 3_600_000;

function open(event) {
  const store = {
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    getEvent: (id) => (id === event.id ? event : null),
    getTask: () => null,
    saveEvent: async (e) => e,
    saveTask: async (t) => t,
    deleteTask: async () => {},
    applyOutOfOffice: async () => ({ declined: [], undo() {} }),
  };
  const modal = createEventModal({ store, user: { email: 'me@example.com' }, requestEmail: async () => '' });
  modal.openView(event);
  return modal;
}

function makeEvent({ organizer, guests }) {
  const start = Date.now() + 24 * HOUR;
  return { id: 'e1', title: 'Kickoff', start, end: start + HOUR, organizer, guests, reminders: [] };
}

/** The guests row of the card (the one holding the guest list). */
const guestBlock = () => document.querySelector('.view__guests').closest('.view__row-main');
const guestRows = () => [...guestBlock().querySelectorAll('.view__guest:not(.view__suggestion)')];
const header = () => guestBlock().firstElementChild.textContent;
const summary = () => guestBlock().querySelector(':scope > .view__muted').textContent;

describe('details card: guest count', () => {
  afterEach(() => {
    document.querySelectorAll('.modal-scrim').forEach((n) => n.remove());
  });

  it('counts an organizer it lists but who is not on the guest list', () => {
    open(
      makeEvent({
        organizer: { email: 'jane@corp.com', name: 'Jane' },
        guests: [
          { email: 'ada@x.com', status: 'accepted' },
          { email: 'bob@x.com', status: 'needs-action' },
        ],
      }),
    );
    // Three rows on screen: Jane (organizer, implicitly attending) + two guests.
    expect(guestRows()).toHaveLength(3);
    expect(header()).toBe('3 guests');
    expect(summary()).toBe('2 yes, 1 awaiting');
  });

  it('counts an organizer already on the guest list exactly once', () => {
    open(
      makeEvent({
        organizer: { email: 'jane@corp.com' },
        guests: [
          { email: 'jane@corp.com', status: 'accepted' },
          { email: 'ada@x.com', status: 'declined' },
        ],
      }),
    );
    expect(guestRows()).toHaveLength(2);
    expect(header()).toBe('2 guests');
    expect(summary()).toBe('1 yes, 1 no');
  });

  it('counts the organizer toward the row cap', () => {
    open(
      makeEvent({
        organizer: { email: 'jane@corp.com' },
        guests: Array.from({ length: 8 }, (_, i) => ({ email: `g${i}@x.com`, status: 'needs-action' })),
      }),
    );
    // 9 attendees, 8 rows shown, and the overflow line accounts for the rest.
    expect(header()).toBe('9 guests');
    expect(guestRows()).toHaveLength(8);
    expect(document.querySelector('.view__guests').lastElementChild.textContent).toBe('+ 1 more');
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEventModal } from '../src/js/modal.js';
import { DEFAULT_SETTINGS } from '../src/js/store.js';

/** Minimal store stand-in — the guest field only needs settings and a save. */
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

const PEOPLE = [
  { contactId: 'c1', name: 'Ada Lovelace', email: 'ada@analytical.co', label: 'Work', company: 'Analytical Engines', favorite: true },
  { contactId: 'c2', name: 'Alan Turing', email: 'alan@bletchley.uk', label: 'Work', company: 'Bletchley Park', favorite: false },
  { contactId: 'c3', name: 'Grace Hopper', email: 'grace@navy.mil', label: 'Work', company: 'US Navy', favorite: false },
];

/** A stand-in for the contacts client: local, synchronous, no Puter needed.
 *  `ready` is what the guest field gates on; `available` (can Contacts be
 *  launched right now?) is deliberately separate, so a test can have one without
 *  the other. */
function makeContacts({ people = PEOPLE, ready = true, available = ready } = {}) {
  const listeners = new Set();
  let used = false;
  return {
    available: () => available,
    ready: () => ready,
    inUse: () => used,
    warm: vi.fn(async () => undefined),
    revalidate: vi.fn(async () => undefined),
    settle: vi.fn(),
    noteTyped: vi.fn(),
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Stand in for a directory read landing: swap the book and announce it,
     *  exactly as the real client does after a background refresh. */
    push(next) {
      people = next;
      for (const fn of [...listeners]) fn();
    },
    suggest: vi.fn((query, limit = 6) => {
      used = true;
      const q = String(query || '').toLowerCase();
      return people
        .filter((p) => `${p.name} ${p.email} ${p.company}`.toLowerCase().includes(q))
        .slice(0, limit);
    }),
  };
}

const $ = (sel) => document.querySelector('.modal-scrim ' + sel);
const $$ = (sel) => [...document.querySelectorAll('.modal-scrim ' + sel)];
const fire = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true }));
/** Type into a field the way a user would: focused, then an input event. */
const type = (input, value) => {
  input.focus();
  input.value = value;
  fire(input, 'input');
};
/** A keypress on the focused field. It bubbles, so the editor's document-level
 *  capture handler sees it first — exactly the order a real key follows. */
const key = (k, opts = {}) =>
  (document.activeElement || document).dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }),
  );

const guestInput = () => $('input[aria-label="Add guest by name or email"]');
const options = () => $$('.guests__suggestion');
const rows = () => $$('.guests__row .guests__email').map((n) => n.textContent);

/** jsdom has no layout, so nothing to scroll. */
beforeEach(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('event modal — guest suggestions from Contacts', () => {
  let modal;
  let contacts;

  beforeEach(() => {
    contacts = makeContacts();
    modal = createEventModal({ store: makeStore(), contacts });
    modal.openNew({});
  });
  afterEach(() => {
    modal.close();
    document.body.innerHTML = '';
  });

  it('marks the field as a combobox and re-reads a stale address book on focus', () => {
    const input = guestInput();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    fire(input, 'focus');
    // Focus on an empty field is the last safe moment before typing: re-read if
    // what we hold has aged (`revalidate` decides; it is a no-op when fresh).
    expect(contacts.revalidate).toHaveBeenCalled();
  });

  it('does not launch anything on a focus that lands on half-typed text', () => {
    const input = guestInput();
    type(input, 'ad');
    contacts.revalidate.mockClear();
    contacts.warm.mockClear();
    fire(input, 'focus');
    expect(contacts.revalidate).not.toHaveBeenCalled();
    expect(contacts.warm).toHaveBeenCalled();
  });

  it('shows matches as the user types, and nothing for an empty field', () => {
    const input = guestInput();
    type(input, 'ada');
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining('Ada Lovelace'),
    ]);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    // Both the company and the address are shown under the name.
    expect(options()[0].textContent).toContain('Analytical Engines');
    expect(options()[0].textContent).toContain('ada@analytical.co');

    type(input, '');
    expect(options()).toHaveLength(0);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('preselects nothing, so Enter still commits a typed-out address', () => {
    const input = guestInput();
    type(input, 'grace@navy.mil');
    expect(options()).toHaveLength(1); // it matches a contact too
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    key('Enter');
    expect(rows()).toEqual(['grace@navy.mil']);
    expect(options()).toHaveLength(0);
  });

  it('walks the list with the arrow keys and adds the highlighted contact on Enter', () => {
    const input = guestInput();
    type(input, 'a');
    expect(options().length).toBeGreaterThan(1);

    key('ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe('guest-opt-0');
    expect(options()[0].getAttribute('aria-selected')).toBe('true');

    key('ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe('guest-opt-1');

    key('ArrowUp');
    expect(input.getAttribute('aria-activedescendant')).toBe('guest-opt-0');
    // Up from the top hands the field back to what was typed.
    key('ArrowUp');
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);

    key('ArrowDown');
    key('Enter');
    expect(rows()).toEqual(['Ada Lovelace — ada@analytical.co']);
    expect(input.value).toBe('');
  });

  it('saves a picked contact with their name alongside the address', async () => {
    const store = makeStore();
    modal.close();
    // A resolved email stands in for the Puter permission prompt the organizer
    // stamp needs, so the save doesn't park waiting on it.
    modal = createEventModal({ store, contacts, requestEmail: async () => 'me@example.com' });
    modal.openNew({});
    $('input[aria-label="Event title"]').value = 'Design review';
    const input = guestInput();
    type(input, 'grace');
    key('ArrowDown');
    key('Enter');
    fire($('form'), 'submit');
    await flush();
    // The organizer joins their own event's list (existing behaviour); the
    // picked contact keeps the name that came from the address book.
    expect(store.saved[0].guests).toEqual([
      { email: 'me@example.com', status: 'accepted' },
      { email: 'grace@navy.mil', name: 'Grace Hopper', status: 'needs-action' },
    ]);
  });

  it('adds a contact on click without the blur-commit stealing it', () => {
    const input = guestInput();
    type(input, 'alan');
    const option = options()[0];
    // The press keeps focus in the field (its default would blur it); the
    // click that ends a tap is what picks.
    const ev = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    option.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(rows()).toEqual([]); // a swipe that starts on the row adds nobody
    option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(rows()).toEqual(['Alan Turing — alan@bletchley.uk']);
    expect(input.value).toBe('');
  });

  it('leaves out people who are already on the guest list', () => {
    const input = guestInput();
    type(input, 'ada');
    key('ArrowDown');
    key('Enter');
    expect(rows()).toEqual(['Ada Lovelace — ada@analytical.co']);
    type(input, 'ada');
    expect(options()).toHaveLength(0);
  });

  it('still suggests fresh people when the best matches are already invited', () => {
    const people = Array.from({ length: 7 }, (_, i) => ({
      contactId: `g${i}`,
      name: `Guest ${i}`,
      email: `guest${i}@example.com`,
      label: 'Work',
      company: '',
      favorite: false,
    }));
    modal.close();
    contacts = makeContacts({ people });
    modal = createEventModal({ store: makeStore(), contacts });
    modal.openNew({});
    const input = guestInput();
    for (let i = 0; i < 6; i++) {
      type(input, `guest${i}@example.com`);
      key('Enter');
    }
    expect(rows()).toHaveLength(6);
    // The seventh matches too. The six already invited must not crowd the
    // window shut — a blank list here reads as "no such contact".
    type(input, 'guest');
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining('guest6@example.com'),
    ]);
  });

  it('nudges a newly opened list into view, once, not on every keystroke', () => {
    const list = $('.guests__suggest');
    list.scrollIntoView = vi.fn();
    const input = guestInput();
    // The list floats inside the modal body, which scrolls: opened near its
    // bottom edge it would sit below the fold, indistinguishable from "no
    // matches".
    type(input, 'a');
    expect(list.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(list.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    type(input, 'ad'); // already open: the user's own scrolling is theirs
    expect(list.scrollIntoView).toHaveBeenCalledTimes(1);
    type(input, '');
    type(input, 'ada'); // reopened: one more nudge
    expect(list.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('closes the list on Escape without closing the editor', () => {
    const input = guestInput();
    type(input, 'ada');
    expect(options()).toHaveLength(1);
    key('Escape');
    expect(options()).toHaveLength(0);
    expect(modal.isOpen()).toBe(true);
    // A second Escape, with no list open, closes the editor as it always did.
    key('Escape');
    expect(modal.isOpen()).toBe(false);
  });

  it('leaves the arrow keys and Enter alone while an IME is composing', () => {
    const input = guestInput();
    type(input, 'ada');
    key('ArrowDown', { isComposing: true });
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('leaves the Enter that commits an IME composition to the input method', () => {
    // A Japanese name being typed is settled by Enter, not added as a guest —
    // and certainly not flagged as "not an address" mid-word.
    const input = guestInput();
    type(input, 'ada');
    key('Enter', { isComposing: true });
    expect(input.value).toBe('ada');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    key('Enter', { keyCode: 229 });
    expect(input.value).toBe('ada');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    // The real Enter still commits (and, for a non-address, complains).
    key('Enter');
    expect(input.hasAttribute('aria-invalid')).toBe(true);
  });

  it('closes the list when the field loses focus, committing valid text', () => {
    const input = guestInput();
    type(input, 'grace@navy.mil');
    fire(input, 'blur');
    expect(options()).toHaveLength(0);
    expect(rows()).toEqual(['grace@navy.mil']);
  });

  it('never reaches out to Contacts while the user is typing', () => {
    const input = guestInput();
    // Focusing may re-read the snapshot once (see above); what must never happen
    // is a read per keystroke.
    input.focus();
    contacts.warm.mockClear();
    contacts.revalidate.mockClear();
    // Suggestions come off the snapshot; a keystroke must not trigger a read,
    // because reading means launching an app and disturbing this very field.
    type(input, 'a');
    type(input, 'ad');
    type(input, 'nobody-by-that-name');
    expect(contacts.warm).not.toHaveBeenCalled();
    expect(contacts.revalidate).not.toHaveBeenCalled();
    expect(contacts.settle).not.toHaveBeenCalled();
    // Leaving the field is when a stale snapshot may be re-read.
    fire(input, 'blur');
    expect(contacts.settle).toHaveBeenCalled();
  });

  it('shows a read that lands while the user is already typing', () => {
    const input = guestInput();
    type(input, 'nadia');
    expect(options()).toHaveLength(0); // not in the book we started with
    // A background read finishes and brings her in. Without this the list stays
    // empty until the next keystroke, which reads as "no such contact".
    contacts.push([
      ...PEOPLE,
      { contactId: 'c4', name: 'Nadia Khan', email: 'nadia@example.com', company: '' },
    ]);
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining('Nadia Khan'),
    ]);
  });

  it('ignores a read that lands when the field is no longer being used', () => {
    const input = guestInput();
    type(input, 'nadia');
    input.blur(); // really moves focus, unlike a synthetic blur event
    expect(() =>
      contacts.push([{ contactId: 'c4', name: 'Nadia Khan', email: 'nadia@example.com', company: '' }]),
    ).not.toThrow();
    expect(options()).toHaveLength(0);
  });

  it('offers whatever address is typed as a row of its own, click included', () => {
    const input = guestInput();
    type(input, 'nobody@elsewhere.test');
    // Nobody in the book matches, but the address itself is pickable — no Enter
    // required, which is what the list is for.
    expect(options()).toHaveLength(1);
    expect(options()[0].textContent).toContain('nobody@elsewhere.test');
    expect(options()[0].textContent).toContain('Add as guest');
    // Marked as the typed row, so it doesn't read as a contact we know.
    expect(options()[0].classList.contains('guests__suggestion--typed')).toBe(true);
    const ev = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    options()[0].dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    options()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(rows()).toEqual(['nobody@elsewhere.test']);
    expect(input.value).toBe('');
    expect(options()).toHaveLength(0);
    // Picking the row is a commit like any other: the address book still hears
    // about an address it has never seen.
    expect(contacts.noteTyped).toHaveBeenCalledWith('nobody@elsewhere.test');
  });

  it('adds the typed row from the keyboard as well as the mouse', () => {
    const input = guestInput();
    type(input, 'nobody@elsewhere.test');
    key('ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe('guest-opt-0');
    key('Enter');
    expect(rows()).toEqual(['nobody@elsewhere.test']);
  });

  it('offers nothing for text that is not yet an address', () => {
    const input = guestInput();
    for (const half of ['nobody', 'nobody@', 'nobody@elsewhere', 'a@b.c d@e.f']) {
      type(input, half);
      expect(options()).toHaveLength(0);
    }
  });

  it('normalizes the typed row the way a commit does', () => {
    const input = guestInput();
    // Trailing comma and stray case: what the row shows must be exactly what
    // gets added, or clicking and pressing Enter would disagree.
    type(input, '  NoBody@Elsewhere.test, ');
    expect(options()[0].textContent).toContain('nobody@elsewhere.test');
    options()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(rows()).toEqual(['nobody@elsewhere.test']);
  });

  it('never shows the typed address twice — as itself and as a contact', () => {
    const input = guestInput();
    type(input, 'grace@navy.mil');
    // Grace is in the book: one row, hers, with her name on it.
    expect(options()).toHaveLength(1);
    expect(options()[0].textContent).toContain('Grace Hopper');
  });

  it('lists contact matches above the typed address', () => {
    modal.close();
    contacts = makeContacts({
      people: [{ contactId: 'c9', name: 'Team', email: 'team@example.com', company: '' }],
    });
    modal = createEventModal({ store: makeStore(), contacts });
    modal.openNew({});
    const input = guestInput();
    // A valid address that is also a prefix of a known one: the contact leads
    // (it carries a name), the literal address follows.
    type(input, 'team@example.co');
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining('Team'),
      expect.stringContaining('Add as guest'),
    ]);
    key('ArrowDown');
    key('ArrowDown');
    key('Enter');
    expect(rows()).toEqual(['team@example.co']);
  });

  it('never offers someone already on the list, whatever the case', () => {
    const input = guestInput();
    type(input, 'ada@analytical.co');
    key('Enter');
    expect(rows()).toEqual(['ada@analytical.co']);
    type(input, 'ADA@Analytical.CO');
    expect(options()).toHaveLength(0);
  });

  it('offers the typed address even while the address book is broken', () => {
    modal.close();
    modal = createEventModal({
      store: makeStore(),
      contacts: {
        ready: () => true,
        available: () => true,
        warm: () => Promise.resolve(),
        suggest: () => {
          throw new Error('boom');
        },
      },
    });
    modal.openNew({});
    const input = guestInput();
    type(input, 'nobody@elsewhere.test');
    expect(options()).toHaveLength(1);
    options()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(rows()).toEqual(['nobody@elsewhere.test']);
  });

  it('reports an address typed in by hand that the address book has never seen', () => {
    const input = guestInput();
    type(input, 'someone-new@example.com');
    key('Enter');
    expect(rows()).toEqual(['someone-new@example.com']);
    // Evidence that our copy of the book is behind. Contacts decides what to do
    // with it, after typing stops.
    expect(contacts.noteTyped).toHaveBeenCalledWith('someone-new@example.com');
  });

  it('re-reads a stale address book when the editor is reopened, once it is in use', () => {
    modal.close();
    contacts.revalidate.mockClear();
    // Nothing has asked for a suggestion yet: opening the editor must not launch
    // Contacts for someone who never invites anyone.
    modal.openNew({});
    expect(contacts.revalidate).not.toHaveBeenCalled();
    type(guestInput(), 'ada');
    modal.close();
    modal.openNew({});
    expect(contacts.revalidate).toHaveBeenCalled();
  });

  it('settles the address book when the editor is closed outright', () => {
    type(guestInput(), 'nobody');
    contacts.settle.mockClear();
    modal.close();
    expect(contacts.settle).toHaveBeenCalled();
  });

  it('starts each open with no list, even after one was left showing', () => {
    type(guestInput(), 'ada');
    expect(options()).toHaveLength(1);
    modal.openNew({});
    expect(options()).toHaveLength(0);
    expect(guestInput().getAttribute('aria-expanded')).toBe('false');
  });

  it('still suggests from the snapshot while Contacts itself is unreachable', () => {
    modal.close();
    // A failed launch (or a backoff after one) must not cost the user their
    // combobox: matching is a local scan of a snapshot we already hold.
    modal = createEventModal({
      store: makeStore(),
      contacts: makeContacts({ ready: true, available: false }),
    });
    modal.openNew({});
    const input = guestInput();
    expect(input).toBeTruthy();
    type(input, 'ada');
    expect(options()).toHaveLength(1);
  });

  it('survives a contacts client that throws', () => {
    modal.close();
    const broken = {
      ready: () => true,
      available: () => true,
      warm: () => Promise.resolve(),
      suggest: () => {
        throw new Error('boom');
      },
    };
    modal = createEventModal({ store: makeStore(), contacts: broken });
    modal.openNew({});
    const input = guestInput();
    expect(() => type(input, 'ada')).not.toThrow();
    expect(options()).toHaveLength(0);
    // Typing an address by hand still works.
    type(input, 'someone@example.com');
    key('Enter');
    expect(rows()).toEqual(['someone@example.com']);
  });
});

describe('event modal — guest field without Contacts', () => {
  let modal;

  afterEach(() => {
    modal.close();
    document.body.innerHTML = '';
  });

  /** No address book to match names against, but the typed address is still a
   *  row you can click — that is the whole affordance for someone who invites
   *  people the Contacts app has never heard of. */
  it('still offers the typed address as a clickable row with no address book', () => {
    modal = createEventModal({ store: makeStore(), contacts: makeContacts({ ready: false }) });
    modal.openNew({});
    const input = $('input[aria-label="Add guest by email"]');
    expect(input).toBeTruthy();
    // The field promises no name matching, but it is still a combobox.
    expect(input.placeholder).toBe('Add guests');
    expect(input.getAttribute('role')).toBe('combobox');
    type(input, 'ada@analytical.co');
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining('ada@analytical.co'),
    ]);
    options()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(rows()).toEqual(['ada@analytical.co']);
    expect(input.value).toBe('');
    expect(options()).toHaveLength(0);
  });

  it('behaves the same with no contacts client at all', () => {
    modal = createEventModal({ store: makeStore() });
    modal.openNew({});
    const input = $('input[aria-label="Add guest by email"]');
    type(input, 'not-an-email');
    expect(options()).toHaveLength(0); // nothing to offer for a non-address
    key('Enter');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(rows()).toEqual([]);
    // A real address gets its row here too, address book or not.
    type(input, 'ada@analytical.co');
    expect(options()).toHaveLength(1);
    key('ArrowDown');
    key('Enter');
    expect(rows()).toEqual(['ada@analytical.co']);
  });
});
